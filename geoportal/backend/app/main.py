from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, ValidationError

from .ml_model import disease_model, get_model_status, yield_model


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "data"
UPLOAD_DIR = ROOT_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)

MAX_FILE_SIZE = 8 * 1024 * 1024  # 8 MB


class YieldFeaturePayload(BaseModel):
    crop_type: str = Field(..., description="Crop identifier, e.g. wheat")
    year: int = Field(..., ge=1960, le=2100)
    area_harvested_ha: float = Field(..., gt=0)
    production_t: float = Field(..., gt=0)
    production_per_area: Optional[float] = Field(
        default=None, description="Derived productivity, t per ha"
    )
    area_change_rate: Optional[float] = None
    yield_change_rate: Optional[float] = None


app = FastAPI(title="GeoPortal API", version="2.0.0")

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


@app.post("/api/upload")
async def upload_image(file: UploadFile = File(...)) -> dict:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename missing")
    contents = await file.read()
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
    return {
        "filename": generated_name,
        "original_name": file.filename,
        "uploaded_at": utc_now(),
        "size_bytes": destination.stat().st_size,
    }


@app.post("/api/predict")
async def predict(request: Request, file: UploadFile | None = File(None)) -> dict:
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
        return result

    if "application/json" not in content_type:
        raise HTTPException(
            status_code=415,
            detail="Yield predictions require application/json payloads",
        )
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON body: {exc}") from exc

    try:
        payload = YieldFeaturePayload(**body)
    except ValidationError as err:
        raise HTTPException(status_code=422, detail=json.loads(err.json())) from err
    prediction = yield_model.predict_from_features(payload.model_dump())
    prediction["input_features"] = payload.model_dump()
    return prediction


@app.get("/api/models/status")
async def models_status() -> dict:
    return get_model_status()


@app.get("/api/files")
async def list_files() -> List[dict]:
    files = []
    for path in sorted(DATA_DIR.glob("*.xlsx")):
        stat = path.stat()
        files.append(
            {
                "filename": path.name,
                "display_name": path.stem.replace("_", " ").title(),
                "size_kb": stat.st_size / 1024,
                "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            }
        )
    return files


@app.get("/api/files/{filename}")
async def download_file(filename: str):
    safe_name = Path(filename).name
    file_path = DATA_DIR / safe_name
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        path=file_path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=file_path.name,
    )
