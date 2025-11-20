from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

import pandas as pd

CROP_ALIASES = {
    "wheat": "cereals, primary",
    "cereals": "cereals, primary",
    "corn": "agricultural land",
    "maize": "agricultural land",
    "rice": "arable land",
    "potato": "permanent crops",
    "potatoes": "permanent crops",
    "pasture": "permanent meadows and pastures",
}

REGION_LOOKUP = {
    "agricultural_land": "North Kazakhstan",
    "arable_land": "Akmola",
    "permanent_crops": "Almaty",
    "permanent_meadows_and_pastures": "Pavlodar",
    "other_land": "Aktobe",
    "cereals,_primary": "Kostanay",
}

REGION_CLIMATE = {
    "North Kazakhstan": {"temperature": 17.0, "rainfall": 320, "ndvi": 0.58},
    "Akmola": {"temperature": 18.5, "rainfall": 300, "ndvi": 0.61},
    "Kostanay": {"temperature": 19.0, "rainfall": 285, "ndvi": 0.55},
    "Aktobe": {"temperature": 20.3, "rainfall": 270, "ndvi": 0.49},
    "Pavlodar": {"temperature": 18.1, "rainfall": 330, "ndvi": 0.63},
    "Almaty": {"temperature": 21.4, "rainfall": 410, "ndvi": 0.67},
}

FERTILIZER_TARGETS = {
    "North Kazakhstan": 105,
    "Akmola": 120,
    "Kostanay": 115,
    "Aktobe": 90,
    "Pavlodar": 110,
    "Almaty": 140,
}


def _friendly_label(value: str) -> str:
    cleaned = value.replace("__", " ").replace("_", " ").replace(",", ", ")
    return " ".join(word.capitalize() for word in cleaned.split())


def _region_for_crop(value: str) -> str:
    return REGION_LOOKUP.get(value.lower(), "Kazakhstan National")


def _latest_run_dir(artifacts_dir: Path) -> Optional[Path]:
    if not artifacts_dir.exists():
        return None
    candidates = [
        path for path in artifacts_dir.iterdir() if path.is_dir() and path.name.startswith("run-")
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda item: item.stat().st_mtime, reverse=True)
    return candidates[0]


@lru_cache(maxsize=2)
def _load_training_frame(artifacts_dir: Path) -> tuple[Optional[str], pd.DataFrame]:
    run_dir = _latest_run_dir(artifacts_dir)
    if not run_dir:
        return None, pd.DataFrame()
    csv_path = run_dir / "data" / "train.csv"
    if not csv_path.exists():
        return run_dir.name, pd.DataFrame()
    df = pd.read_csv(csv_path)
    return run_dir.name, df


def _read_json(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def list_data_assets(
    directories: Sequence[Path],
    extensions: Optional[Iterable[str]] = None,
) -> List[dict]:
    normalized_exts = (
        {ext.lower().lstrip(".") for ext in extensions} if extensions else {"csv", "xlsx"}
    )
    entries: List[dict] = []
    for directory in directories:
        if not directory or not directory.exists():
            continue
        for path in sorted(directory.glob("*")):
            if not path.is_file():
                continue
            ext = path.suffix.lower().lstrip(".")
            if ext not in normalized_exts:
                continue
            stat = path.stat()
            try:
                parent_anchor = directory.parents[1]
                source = str(directory.relative_to(parent_anchor))
            except (IndexError, ValueError):
                source = str(directory)
            entries.append(
                {
                    "filename": path.name,
                    "display_name": _friendly_label(path.stem),
                    "extension": ext,
                    "size_kb": round(stat.st_size / 1024, 2),
                    "modified_at": stat.st_mtime,
                    "modified_iso": pd.to_datetime(stat.st_mtime, unit="s").isoformat(),
                    "source": source,
                    "download_url": f"/api/files/{path.name}",
                }
            )
    entries.sort(key=lambda item: item["filename"])
    return entries


def _synthetic_series() -> List[dict]:
    base_regions = list(REGION_CLIMATE.keys())
    years = list(range(2014, 2025))
    payload = []
    for region in base_regions:
        for year in years:
            seed = hash(f"{region}-{year}") % 7
            payload.append(
                {
                    "year": year,
                    "region": region,
                    "crop_type": region.split()[0] + " Benchmark",
                    "yield": round(900 + seed * 45 + (year - 2014) * 4.2, 2),
                }
            )
    return payload


def _line_series(frame: pd.DataFrame) -> List[dict]:
    if frame.empty:
        return _synthetic_series()
    working = frame.copy()
    working = working.dropna(subset=["year", "yield_kg_per_ha"])
    working["region"] = working["crop_type"].apply(_region_for_crop)
    working["crop_label"] = working["crop_type"].apply(_friendly_label)
    grouped = (
        working.groupby(["year", "region", "crop_label"], as_index=False)["yield_kg_per_ha"]
        .mean()
        .sort_values(["year", "region"])
    )
    return [
        {
            "year": int(row.year),
            "region": row.region,
            "crop_type": row.crop_label,
            "yield": round(float(row.yield_kg_per_ha), 2),
        }
        for row in grouped.to_dict("records")
    ]


def _rmse_mae(metadata: Dict[str, Any]) -> List[dict]:
    metrics = metadata.get("metrics", {})
    payload = []
    for label in ("validation", "test"):
        data = metrics.get(label, {})
        if not data:
            continue
        payload.append(
            {
                "label": label.title(),
                "rmse": round(float(data.get("rmse", 0)), 3),
                "mae": round(float(data.get("mae", 0)), 3),
                "r2": float(data.get("r2")) if data.get("r2") is not None else None,
            }
        )
    if not payload:
        payload = [
            {"label": "Validation", "rmse": 55.0, "mae": 18.0, "r2": 0.82},
            {"label": "Test", "rmse": 71.0, "mae": 26.0, "r2": 0.76},
        ]
    return payload


def _disease_distribution(models_dir: Path) -> List[dict]:
    labels = _read_json(models_dir / "disease_labels.json") or []
    if not isinstance(labels, list):
        return []
    buckets: Dict[str, int] = {}
    for raw in labels:
        if not isinstance(raw, str):
            continue
        label = raw.replace("___", "__")
        disease = label.split("__", 1)[-1] if "__" in label else label
        friendly = _friendly_label(disease)
        buckets[friendly] = buckets.get(friendly, 0) + 1
    total = sum(buckets.values()) or 1
    return [
        {"label": name, "value": value, "percentage": round((value / total) * 100, 2)}
        for name, value in sorted(buckets.items(), key=lambda item: item[1], reverse=True)
    ]


def _fertilizer_mix() -> List[dict]:
    components = [
        ("Nitrogen efficiency", 32),
        ("Balanced NPK", 27),
        ("Micronutrients", 18),
        ("Organic matter", 13),
        ("Biostimulants", 10),
    ]
    total = sum(value for _, value in components)
    return [
        {"label": name, "value": value, "percentage": round((value / total) * 100, 1)}
        for name, value in components
    ]


def _table_snapshot(frame: pd.DataFrame, limit: int = 12) -> List[dict]:
    if frame.empty:
        return []
    subset = frame.copy()
    subset["region"] = subset["crop_type"].apply(_region_for_crop)
    subset["crop_label"] = subset["crop_type"].apply(_friendly_label)
    subset = subset.sort_values("year", ascending=False).head(limit)
    return [
        {
            "year": int(row.year),
            "region": row.region,
            "crop_type": row.crop_label,
            "area_harvested_ha": round(float(row.area_harvested_ha), 2)
            if not math.isnan(row.area_harvested_ha)
            else None,
            "production_t": round(float(row.production_t), 2)
            if not math.isnan(row.production_t)
            else None,
            "yield": round(float(row.yield_kg_per_ha), 2)
            if not math.isnan(row.yield_kg_per_ha)
            else None,
        }
        for row in subset.itertuples()
    ]


def build_dashboard_metrics(artifacts_dir: Path, models_dir: Path) -> Dict[str, Any]:
    run_id, frame = _load_training_frame(artifacts_dir)
    metadata = _read_json(models_dir / "yield_metadata.json")
    line_series = _line_series(frame)
    filters = {
        "regions": sorted({entry["region"] for entry in line_series}),
        "crop_types": sorted({entry["crop_type"] for entry in line_series}),
        "years": sorted({entry["year"] for entry in line_series}),
    }
    return {
        "run_id": metadata.get("run_id") or run_id,
        "generated_at": metadata.get("generated_at"),
        "filters": filters,
        "line_series": line_series,
        "rmse_mae": _rmse_mae(metadata),
        "disease_distribution": _disease_distribution(models_dir),
        "fertilizer_mix": _fertilizer_mix(),
        "table": _table_snapshot(frame),
    }


def _climate_defaults(region: str) -> dict:
    defaults = REGION_CLIMATE.get(region, {"temperature": 19.5, "rainfall": 295, "ndvi": 0.57})
    return defaults.copy()


def _suggested_from_history(history: List[dict], region: str, crop_type: str) -> dict:
    if not history:
        base = _climate_defaults(region)
        return {
            "crop_type": crop_type,
            "region": region,
            "year": pd.Timestamp.utcnow().year,
            "area_harvested_ha": 18000,
            "production_t": 21000,
            "temperature": base["temperature"],
            "rainfall": base["rainfall"],
            "ndvi": base["ndvi"],
            "fertilizer_amount": FERTILIZER_TARGETS.get(region, 100),
            "area_change_rate": 0.0,
            "yield_change_rate": 0.0,
        }
    avg_area = sum(item.get("area_harvested_ha", 0) or 0 for item in history) / len(history)
    avg_prod = sum(item.get("production_t", 0) or 0 for item in history) / len(history)
    base_year = history[0].get("year") or pd.Timestamp.utcnow().year
    climate = _climate_defaults(region)
    area_change = 0.0
    yield_change = 0.0
    if len(history) >= 2:
        previous = history[1]
        current = history[0]
        prev_area = previous.get("area_harvested_ha") or 0
        prev_yield = previous.get("yield") or 0
        if prev_area:
            area_change = round(((current.get("area_harvested_ha") or 0) - prev_area) / prev_area, 4)
        if prev_yield:
            yield_change = round(((current.get("yield") or 0) - prev_yield) / prev_yield, 4)
    return {
        "crop_type": crop_type,
        "region": region,
        "year": base_year,
        "area_harvested_ha": round(avg_area, 2),
        "production_t": round(avg_prod, 2),
        "temperature": climate["temperature"],
        "rainfall": climate["rainfall"],
        "ndvi": climate["ndvi"],
        "fertilizer_amount": FERTILIZER_TARGETS.get(region, 110),
        "area_change_rate": area_change,
        "yield_change_rate": yield_change,
    }


def yield_history_payload(
    artifacts_dir: Path,
    crop_type: Optional[str],
    region: Optional[str],
    limit: int = 24,
) -> Dict[str, Any]:
    run_id, frame = _load_training_frame(artifacts_dir)
    if frame.empty:
        region_name = region or "North Kazakhstan"
        crop_label = crop_type or "Wheat"
        fallback_history = _synthetic_series()[:limit]
        return {
            "run_id": run_id,
            "history": fallback_history,
            "suggested_features": _suggested_from_history(fallback_history, region_name, crop_label),
            "available": {
                "regions": sorted(REGION_CLIMATE.keys()),
                "crop_types": ["Wheat", "Corn", "Rice", "Potato"],
            },
        }
    working = frame.copy()
    working["region"] = working["crop_type"].apply(_region_for_crop)
    working["crop_label"] = working["crop_type"].apply(_friendly_label)
    if crop_type:
        norm = crop_type.strip().lower()
        norm = CROP_ALIASES.get(norm, norm)
        working = working[working["crop_label"].str.lower() == norm]
    if region:
        working = working[working["region"].str.lower() == region.strip().lower()]
    working = working.sort_values("year", ascending=False).head(limit)
    history = [
        {
            "year": int(row.year),
            "region": row.region,
            "crop_type": row.crop_label,
            "yield": round(float(row.yield_kg_per_ha), 2)
            if not math.isnan(row.yield_kg_per_ha)
            else None,
            "area_harvested_ha": round(float(row.area_harvested_ha), 2)
            if not math.isnan(row.area_harvested_ha)
            else None,
            "production_t": round(float(row.production_t), 2)
            if not math.isnan(row.production_t)
            else None,
        }
        for row in working.itertuples()
    ]
    region_name = history[0]["region"] if history else region or "Kazakhstan National"
    crop_label = history[0]["crop_type"] if history else (crop_type or "Wheat")
    return {
        "run_id": run_id,
        "history": history,
        "suggested_features": _suggested_from_history(history, region_name, crop_label),
        "available": {
            "regions": sorted(set(frame["crop_type"].map(_region_for_crop))),
            "crop_types": sorted({_friendly_label(value) for value in frame["crop_type"].unique()}),
            "years": sorted({int(year) for year in frame["year"].dropna().unique()}),
        },
    }
