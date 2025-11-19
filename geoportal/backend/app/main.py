from __future__ import annotations

import secrets
import shutil
from datetime import datetime
from pathlib import Path
from typing import List

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .ml_model import predict as ml_predict

ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "data"
UPLOAD_DIR = ROOT_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="GeoPortal API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


@app.get("/api/hello")
async def hello() -> dict:
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat() + "Z"}


@app.post("/api/upload")
async def upload_image(file: UploadFile = File(...)) -> dict:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename missing")
    suffix = Path(file.filename).suffix or ".bin"
    safe_suffix = suffix if len(suffix) <= 10 else suffix[:10]
    generated_name = f"{datetime.utcnow():%Y%m%d_%H%M%S}_{secrets.token_hex(4)}{safe_suffix}"
    destination = UPLOAD_DIR / generated_name
    with destination.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    return {
        "filename": generated_name,
        "original_name": file.filename,
        "uploaded_at": datetime.utcnow().isoformat() + "Z",
        "size_bytes": destination.stat().st_size,
    }


@app.post("/api/predict")
async def predict(file: UploadFile = File(...)) -> dict:
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty file")
    prediction = ml_predict(image_bytes)
    prediction["received_bytes"] = len(image_bytes)
    return prediction


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
