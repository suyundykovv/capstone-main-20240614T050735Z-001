from __future__ import annotations

import asyncio
import json
import os
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr, Field, ValidationError

from .ml_model import disease_model, get_model_status, yield_model
from .services import build_dashboard_metrics, list_data_assets, yield_history_payload


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


APP_DIR = Path(__file__).resolve().parent
BACKEND_DIR = APP_DIR.parent
ROOT_DIR = BACKEND_DIR.parent
DATA_DIR = ROOT_DIR / "data"
BACKEND_DATA_DIR = BACKEND_DIR / "data" / "kz"
UPLOAD_DIR = ROOT_DIR / "uploads"
ARTIFACTS_DIR = BACKEND_DIR / "artifacts"
MODELS_DIR = APP_DIR / "models"
DATA_DIR.mkdir(parents=True, exist_ok=True)
BACKEND_DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
DATA_SOURCES = [DATA_DIR, BACKEND_DATA_DIR]

MAX_FILE_SIZE = 8 * 1024 * 1024  # 8 MB
SUPPORTED_LANGS = {"en", "ru"}


class YieldFeaturePayload(BaseModel):
    crop_type: str = Field(..., description="Crop identifier, e.g. wheat")
    region: Optional[str] = Field(default=None, description="Region or oblast name")
    year: int = Field(..., ge=1960, le=2100)
    area_harvested_ha: float = Field(..., gt=0)
    production_t: float = Field(..., gt=0)
    production_per_area: Optional[float] = Field(
        default=None, description="Derived productivity, t per ha"
    )
    area_change_rate: Optional[float] = None
    yield_change_rate: Optional[float] = None
    temperature: Optional[float] = Field(default=None, description="°C during season")
    rainfall: Optional[float] = Field(default=None, description="Seasonal rainfall mm")
    ndvi: Optional[float] = Field(default=None, description="Mean NDVI 0-1")
    fertilizer_amount: Optional[float] = Field(
        default=None, description="Fertilizer rate kg/ha"
    )


class ContactMessage(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    email: EmailStr
    company: Optional[str] = Field(default=None, max_length=120)
    topic: Optional[str] = Field(default=None, max_length=120)
    message: str = Field(..., min_length=8, max_length=2000)


class RateLimiter:
    def __init__(self, limit: int, period_seconds: int) -> None:
        self.limit = limit
        self.period = period_seconds
        self._hits: defaultdict[str, deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    async def consume(self, key: str) -> None:
        now = time.monotonic()
        async with self._lock:
            queue = self._hits[key]
            while queue and now - queue[0] > self.period:
                queue.popleft()
            if len(queue) >= self.limit:
                raise HTTPException(
                    status_code=429, detail="Too many predictions. Please retry shortly."
                )
            queue.append(now)


class EventLogger:
    def __init__(self, artifacts_dir: Path) -> None:
        self.artifacts_dir = artifacts_dir
        self._lock = Lock()

    def _active_run_id(self) -> str:
        metadata = yield_model.metadata or {}
        run_id = metadata.get("run_id") or os.getenv("GEO_ACTIVE_RUN_ID")
        if run_id:
            return str(run_id)
        return f"run-live-{datetime.utcnow():%Y%m%d}"

    def log(self, event_type: str, payload: Dict[str, Any]) -> None:
        run_id = self._active_run_id()
        log_dir = self.artifacts_dir / run_id / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        record = {
            "event": event_type,
            "run_id": run_id,
            "logged_at": utc_now(),
            **payload,
        }
        log_path = log_dir / f"{event_type}.log"
        with self._lock:
            with log_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")


RECOMMENDATIONS = {
    "yield": {
        "en": [
            "Align sowing windows with NDVI anomalies to stabilise biomass.",
            "Benchmark fertilizer intensity vs. neighbors to keep RMSE under 45 kg/ha.",
            "Deploy soil moisture probes in low-NDVI blocks before top-dressing.",
        ],
        "ru": [
            "Согласуйте сроки сева с аномалиями NDVI для стабилизации биомассы.",
            "Сравнивайте интенсивность удобрений с хозяйствами региона, чтобы удерживать RMSE ниже 45 кг/га.",
            "Устанавливайте датчики влажности в участках с низким NDVI перед внесением подкормок.",
        ],
    },
    "disease": {
        "en": [
            "Upload canopy imagery weekly so lesions are detected within 48 hours.",
            "Apply copper or phosphite protectants when humidity exceeds 80 % for 6+ hours.",
            "Rotate systemic and contact fungicides every spray to slow resistance.",
        ],
        "ru": [
            "Загружайте снимки кроны каждую неделю, чтобы выявлять очаги в течение 48 часов.",
            "Используйте медьсодержащие или фосфитные препараты при влажности выше 80 % дольше 6 часов.",
            "Чередуйте системные и контактные фунгициды при каждом опрыскивании, чтобы замедлить резистентность.",
        ],
    },
}

TEXT_TRANSLATIONS = {
    "Apply Calcium nitrate pre-tuber initiation": "Внесите кальциевую селитру до начала клубнеобразования.",
    "Rotate with legumes to rebuild soil nitrogen": "Чередуйте с бобовыми культурами для восстановления азота в почве.",
    "Foliar spray Ca + B during flowering": "Проводите внекорневую подкормку кальцием и бором во время цветения.",
    "Use NPK 12-12-36 for fruit bulking": "Используйте NPK 12-12-36 для наращивания плодов.",
    "Topdress with urea at tillering": "Подкормите мочевиной на фазе кущения.",
    "Add zinc sulfate in deficient soils": "Добавьте сульфат цинка на почвах с дефицитом микроэлементов.",
    "DAP 18-46-0 at transplanting": "Внесите DAP 18-46-0 при пересадке.",
    "Silica foliar spray to harden leaves": "Обработайте листья кремниевым раствором для укрепления тканей.",
    "Incorporate composted manure": "Внесите перепревший навоз в почву.",
    "Apply balanced NPK 15-15-15": "Используйте комплексное удобрение NPK 15-15-15.",
}


def _client_key(request: Request) -> str:
    host = request.client.host if request.client else "anonymous"
    return host or "anonymous"


def _normalize_lang(lang: str | None) -> str:
    if not lang:
        return "en"
    candidate = lang.split("-")[0].lower()
    return candidate if candidate in SUPPORTED_LANGS else "en"


def _translate_text(value: str, lang: str) -> str:
    if lang == "ru":
        return TEXT_TRANSLATIONS.get(value, value)
    return value


def _inject_recommendations(payload: Dict[str, Any], lang: str) -> Dict[str, Any]:
    mode = payload.get("mode")
    payload["lang"] = lang
    recommendations = RECOMMENDATIONS.get(mode or "", {})
    payload["recommendations"] = recommendations.get(lang) or recommendations.get("en") or []
    if "fertilizer_suggestion" in payload:
        payload["fertilizer_suggestion_localized"] = _translate_text(
            payload["fertilizer_suggestion"], lang
        )
    return payload


def _find_data_file(filename: str) -> Optional[Path]:
    safe_name = Path(filename).name
    for directory in DATA_SOURCES:
        candidate = directory / safe_name
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


rate_limiter = RateLimiter(limit=40, period_seconds=60)
event_logger = EventLogger(ARTIFACTS_DIR)

app = FastAPI(title="GeoPortal API", version="2.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _load_models() -> None:
    disease_model.load()
    yield_model.load()


@app.get("/api/hello")
async def hello() -> dict:
    return {"status": "ok", "timestamp": utc_now()}


@app.post("/api/hello")
async def submit_contact(payload: ContactMessage) -> dict:
    event_logger.log(
        "contact",
        {
            "name": payload.name,
            "email": payload.email,
            "company": payload.company,
            "topic": payload.topic,
            "message": payload.message,
        },
    )
    return {"status": "received", "timestamp": utc_now()}


@app.post("/api/upload")
async def upload_image(file: UploadFile = File(...)) -> dict:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename missing")
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File exceeds 8MB limit")
    suffix = Path(file.filename).suffix or ".bin"
    safe_suffix = suffix if len(suffix) <= 10 else suffix[:10]
    generated_name = (
        f"{datetime.utcnow():%Y%m%d_%H%M%S}_{secrets.token_hex(4)}{safe_suffix}"
    )
    destination = UPLOAD_DIR / generated_name
    with destination.open("wb") as buffer:
        buffer.write(contents)
    event_logger.log(
        "upload",
        {"filename": generated_name, "original_name": file.filename, "size_bytes": len(contents)},
    )
    return {
        "filename": generated_name,
        "original_name": file.filename,
        "uploaded_at": utc_now(),
        "size_bytes": destination.stat().st_size,
    }


@app.post("/api/predict")
async def predict(
    request: Request,
    lang: str = Query("en", description="Language code en|ru"),
    file: UploadFile | None = File(None),
) -> dict:
    await rate_limiter.consume(_client_key(request))
    language = _normalize_lang(lang)
    content_type = request.headers.get("content-type", "")
    if file is not None:
        if "multipart/form-data" not in content_type:
            raise HTTPException(
                status_code=415,
                detail="Image predictions require multipart/form-data",
            )
        image_bytes = await file.read()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="Empty file")
        if len(image_bytes) > MAX_FILE_SIZE:
            raise HTTPException(status_code=413, detail="File exceeds 8MB limit")
        result = disease_model.predict_from_bytes(image_bytes)
        result["filename"] = file.filename
        result["received_bytes"] = len(image_bytes)
        _inject_recommendations(result, language)
        event_logger.log(
            "predictions",
            {
                "mode": "disease",
                "filename": file.filename,
                "bytes": len(image_bytes),
                "client": _client_key(request),
                "lang": language,
            },
        )
        return result

    if "application/json" not in content_type:
        raise HTTPException(
            status_code=415,
            detail="Yield predictions require application/json payloads",
        )
    try:
        body = await request.json()
    except Exception as exc:  # pragma: no cover - JSON parsing edge
        raise HTTPException(status_code=400, detail=f"Invalid JSON body: {exc}") from exc

    try:
        payload = YieldFeaturePayload(**body)
    except ValidationError as err:
        raise HTTPException(status_code=422, detail=json.loads(err.json())) from err
    features = payload.model_dump()
    prediction = yield_model.predict_from_features(features)
    prediction["input_features"] = features
    _inject_recommendations(prediction, language)
    event_logger.log(
        "predictions",
        {
            "mode": "yield",
            "client": _client_key(request),
            "lang": language,
            "crop_type": features.get("crop_type"),
            "region": features.get("region"),
            "predicted_yield": prediction.get("predicted_yield"),
        },
    )
    return prediction


@app.get("/api/models/status")
async def models_status() -> dict:
    return get_model_status()


@app.get("/api/files")
async def list_files(extensions: Optional[List[str]] = Query(default=None)) -> List[dict]:
    assets = list_data_assets(DATA_SOURCES, extensions)
    return [
        {
            "filename": asset["filename"],
            "display_name": asset["display_name"],
            "extension": asset["extension"],
            "size_kb": asset["size_kb"],
            "source": asset["source"],
            "download_url": asset["download_url"],
            "modified_at": asset["modified_iso"],
        }
        for asset in assets
    ]


MEDIA_TYPES = {
    ".csv": "text/csv",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


@app.get("/api/files/{filename}")
async def download_file(filename: str):
    file_path = _find_data_file(filename)
    if not file_path:
        raise HTTPException(status_code=404, detail="File not found")
    media_type = MEDIA_TYPES.get(file_path.suffix.lower(), "application/octet-stream")
    return FileResponse(path=file_path, media_type=media_type, filename=file_path.name)


@app.get("/api/dashboard/metrics")
async def dashboard_metrics() -> dict:
    return build_dashboard_metrics(ARTIFACTS_DIR, MODELS_DIR)


@app.get("/api/yield/history")
async def yield_history(
    crop_type: Optional[str] = Query(default=None),
    region: Optional[str] = Query(default=None),
    limit: int = Query(default=24, ge=6, le=120),
) -> dict:
    return yield_history_payload(ARTIFACTS_DIR, crop_type, region, limit)
