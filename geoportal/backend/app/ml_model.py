from __future__ import annotations

import io
import json
import logging
import random
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import joblib
import numpy as np
import pandas as pd
from PIL import Image

LOGGER = logging.getLogger("geoportal.ml_model")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


APP_DIR = Path(__file__).resolve().parent
BACKEND_DIR = APP_DIR.parent
MODELS_DIR = APP_DIR / "models"
ML_MODEL_DIR = BACKEND_DIR / "ml_model"

FERTILIZER_BOOK = {
    "potato": [
        "Apply Calcium nitrate pre-tuber initiation",
        "Rotate with legumes to rebuild soil nitrogen",
    ],
    "tomato": [
        "Foliar spray Ca + B during flowering",
        "Use NPK 12-12-36 for fruit bulking",
    ],
    "wheat": [
        "Topdress with urea at tillering",
        "Add zinc sulfate in deficient soils",
    ],
    "rice": [
        "DAP 18-46-0 at transplanting",
        "Silica foliar spray to harden leaves",
    ],
    "default": [
        "Incorporate composted manure",
        "Apply balanced NPK 15-15-15",
    ],
}


def _normalize_label(value: str) -> str:
    value = value.replace("__", " ").replace("_", " ")
    return " ".join(word.capitalize() for word in value.split())


def _fertilizer_for_crop(crop: str) -> str:
    options = FERTILIZER_BOOK.get(crop.lower(), FERTILIZER_BOOK["default"])
    random.seed(hash(crop) % 10_000)
    return random.choice(options)


@dataclass
class DiseaseModel:
    model_path: Path
    labels_path: Path
    image_size: tuple[int, int] = (128, 128)
    _model: Any | None = None
    labels: List[str] | None = None
    loaded_at: Optional[str] = None

    def load(self) -> None:
        if self._model:
            return
        if not self.model_path.exists():
            LOGGER.warning("Disease model %s not found", self.model_path)
            return
        try:
            from tensorflow.keras.models import load_model  # type: ignore
        except ImportError as exc:  # pragma: no cover - depends on env
            LOGGER.error("TensorFlow is required for disease inference: %s", exc)
            return
        self._model = load_model(self.model_path)
        self.labels = self._load_labels()
        self.loaded_at = utc_now()
        LOGGER.info("Loaded disease model from %s", self.model_path)

    def _load_labels(self) -> List[str]:
        if not self.labels_path.exists():
            raise FileNotFoundError(f"Disease labels file not found: {self.labels_path}")
        with self.labels_path.open("r", encoding="utf-8") as handle:
            labels = json.load(handle)
        if not isinstance(labels, list):
            raise ValueError("Disease labels JSON must contain a list")
        return labels

    def _preprocess(self, image_bytes: bytes) -> np.ndarray:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        image = image.resize(self.image_size)
        array = np.asarray(image, dtype=np.float32) / 255.0
        return np.expand_dims(array, axis=0)

    def predict_from_bytes(self, image_bytes: bytes) -> Dict[str, Any]:
        if not image_bytes:
            raise ValueError("Empty image provided")
        try:
            if self._model is None:
                self.load()
            if self._model is None or not self.labels:
                raise RuntimeError("Disease model unavailable")
            tensor = self._preprocess(image_bytes)
            probabilities = self._model.predict(tensor)[0]
            index = int(np.argmax(probabilities))
            confidence = float(probabilities[index])
            label = self.labels[index] if index < len(self.labels) else "unknown"
            crop, disease = self._parse_label(label)
            suggestion = _fertilizer_for_crop(crop)
            return {
                "mode": "disease",
                "crop": crop,
                "disease": disease,
                "confidence": round(confidence, 4),
                "fertilizer_suggestion": suggestion,
                "inference_engine": "plant-disease-v1",
                "model_version": self._model_version(),
                "predicted_at": utc_now(),
            }
        except Exception as exc:  # pragma: no cover - fall back to stub
            LOGGER.exception("Disease prediction failed, using stub: %s", exc)
            return self._stub_prediction(image_bytes)

    def _parse_label(self, label: str) -> tuple[str, str]:
        if "___" in label:
            crop_raw, disease_raw = label.split("___", 1)
        else:
            crop_raw, disease_raw = label, "unknown"
        return _normalize_label(crop_raw), _normalize_label(disease_raw)

    def _stub_prediction(self, image_bytes: bytes) -> Dict[str, Any]:
        seed = len(image_bytes) or int(datetime.now(timezone.utc).timestamp())
        random.seed(seed)
        fallback_crop = random.choice(["Potato", "Tomato", "Wheat", "Rice"])
        fallback_disease = random.choice(
            ["Leaf spot", "Rust", "Blight", "Healthy"]
        )
        return {
            "mode": "disease",
            "crop": fallback_crop,
            "disease": fallback_disease,
            "confidence": 0.42,
            "fertilizer_suggestion": _fertilizer_for_crop(fallback_crop),
            "inference_engine": "geoportal-disease-stub",
            "model_version": "stub",
            "predicted_at": utc_now(),
        }

    def _model_version(self) -> str:
        if self.model_path.exists():
            return self.model_path.stat().st_mtime_ns.__str__()
        return "unknown"

    def status(self) -> Dict[str, Any]:
        return {
            "name": "disease",
            "loaded": self._model is not None,
            "labels_available": len(self.labels or []),
            "model_path": str(self.model_path),
            "last_loaded": self.loaded_at,
            "version": self._model_version(),
        }


@dataclass
class YieldModel:
    model_path: Path
    metadata_path: Path
    features_path: Path
    _pipeline: Any | None = None
    metadata: Dict[str, Any] | None = None

    def load(self) -> None:
        if self._pipeline:
            return
        if not self.model_path.exists():
            LOGGER.warning("Yield model %s not found", self.model_path)
            return
        self._pipeline = joblib.load(self.model_path)
        self.metadata = self._load_metadata()
        LOGGER.info("Loaded yield model from %s", self.model_path)

    def _load_metadata(self) -> Dict[str, Any]:
        if not self.metadata_path.exists():
            LOGGER.warning("Yield metadata missing: %s", self.metadata_path)
            return {}
        with self.metadata_path.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    def _base_features(self) -> List[str]:
        if not self.metadata:
            return []
        data = self.metadata.get("data", {})
        return list(data.get("numeric_features", [])) + list(
            data.get("categorical_features", [])
        )

    def predict_from_features(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            if self._pipeline is None:
                self.load()
            if self._pipeline is None:
                raise RuntimeError("Yield model unavailable")
            df = self._build_frame(payload)
            prediction = float(self._pipeline.predict(df)[0])
            confidence = self._confidence(prediction)
            return {
                "mode": "yield",
                "predicted_yield": round(prediction, 2),
                "confidence": round(confidence, 4),
                "units": "kg/ha",
                "model_version": self.metadata.get("run_id") if self.metadata else None,
                "predicted_at": utc_now(),
            }
        except Exception as exc:  # pragma: no cover - fallback path
            LOGGER.exception("Yield prediction failed, using stub: %s", exc)
            return self._stub_prediction(payload)

    def _build_frame(self, payload: Dict[str, Any]) -> pd.DataFrame:
        base_features = self._base_features()
        row = {feature: payload.get(feature) for feature in base_features}
        # allow friendly aliases
        aliases = {
            "area_harvested": "area_harvested_ha",
            "production": "production_t",
            "crop": "crop_type",
        }
        for alias, canonical in aliases.items():
            if canonical in row and row[canonical] is not None:
                continue
            if alias in payload:
                row[canonical] = payload[alias]
        if "crop_type" in row and isinstance(row["crop_type"], str):
            row["crop_type"] = row["crop_type"].lower().replace(" ", "_")
        return pd.DataFrame([row])

    def _confidence(self, prediction: float) -> float:
        if not self.metadata:
            return 0.5
        rmse = self.metadata.get("metrics", {}).get("validation", {}).get("rmse")
        if rmse in (None, 0):
            rmse = 500.0
        scale = abs(prediction) + rmse + 1e-6
        score = 1 - (rmse / scale)
        return max(0.05, min(0.99, score))

    def _stub_prediction(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        base = payload.get("area_harvested_ha") or 1_500
        seed = int(base) % 10_000
        random.seed(seed)
        guess = random.uniform(1_000, 3_000)
        return {
            "mode": "yield",
            "predicted_yield": round(guess, 2),
            "confidence": 0.25,
            "units": "kg/ha",
            "model_version": "stub",
            "predicted_at": utc_now(),
        }

    def status(self) -> Dict[str, Any]:
        return {
            "name": "yield",
            "loaded": self._pipeline is not None,
            "model_path": str(self.model_path),
            "metadata_path": str(self.metadata_path),
            "last_trained": (self.metadata or {}).get("generated_at"),
            "run_id": (self.metadata or {}).get("run_id"),
        }


disease_model = DiseaseModel(
    model_path=ML_MODEL_DIR / "plant_model.h5",
    labels_path=MODELS_DIR / "disease_labels.json",
)

yield_model = YieldModel(
    model_path=MODELS_DIR / "yield_model.pkl",
    metadata_path=MODELS_DIR / "yield_metadata.json",
    features_path=MODELS_DIR / "yield_features.json",
)


def get_model_status() -> Dict[str, Any]:
    return {
        "disease": disease_model.status(),
        "yield": yield_model.status(),
    }
