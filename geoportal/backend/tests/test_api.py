from __future__ import annotations

from io import BytesIO

from PIL import Image

from app.main import DATA_DIR, disease_model, yield_model


def test_models_status(client):
    response = client.get("/api/models/status")
    assert response.status_code == 200
    payload = response.json()
    assert "disease" in payload and "yield" in payload
    assert isinstance(payload["disease"]["loaded"], bool)


def test_yield_prediction_endpoint(client, monkeypatch):
    expected = {
        "mode": "yield",
        "predicted_yield": 1500.0,
        "confidence": 0.9,
        "units": "kg/ha",
        "model_version": "test",
        "predicted_at": "now",
    }

    def fake_predict(features):
        assert features["crop_type"] == "wheat"
        return expected | {"input_features": features}

    monkeypatch.setattr(yield_model, "predict_from_features", fake_predict)
    payload = {
        "crop_type": "wheat",
        "year": 2024,
        "area_harvested_ha": 1000,
        "production_t": 500,
    }
    response = client.post("/api/predict?lang=ru", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["lang"] == "ru"
    assert "recommendations" in body
    assert body["input_features"]["crop_type"] == "wheat"


def test_disease_prediction_endpoint(client, monkeypatch):
    expected = {
        "mode": "disease",
        "crop": "Potato",
        "disease": "Late Blight",
        "confidence": 0.88,
        "fertilizer_suggestion": "Test",
        "inference_engine": "stub",
        "model_version": "stub",
        "predicted_at": "now",
    }

    def fake_predict(image_bytes: bytes):
        assert isinstance(image_bytes, (bytes, bytearray))
        return expected

    monkeypatch.setattr(disease_model, "predict_from_bytes", fake_predict)
    image = Image.new("RGB", (16, 16), color=(255, 0, 0))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    buffer.seek(0)
    response = client.post(
        "/api/predict",
        files={"file": ("leaf.png", buffer.read(), "image/png")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "disease"
    assert "recommendations" in body


def test_files_listing(client):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    temp_file = DATA_DIR / "pytest_dataset.xlsx"
    temp_file.write_bytes(b"123")
    try:
        response = client.get("/api/files")
        assert response.status_code == 200
        files = response.json()
        assert any(item["filename"] == temp_file.name for item in files)
        assert all("extension" in item for item in files)
    finally:
        temp_file.unlink(missing_ok=True)


def test_contact_endpoint(client):
    payload = {
        "name": "Agro Lead",
        "email": "lead@example.com",
        "company": "GeoCorp",
        "topic": "Pilot",
        "message": "Need a pilot in Kostanay.",
    }
    response = client.post("/api/hello", json=payload)
    assert response.status_code == 200
    assert response.json()["status"] == "received"


def test_dashboard_metrics_endpoint(client):
    response = client.get("/api/dashboard/metrics")
    assert response.status_code == 200
    body = response.json()
    assert "line_series" in body
    assert "rmse_mae" in body


def test_yield_history_endpoint(client):
    response = client.get("/api/yield/history?limit=10")
    assert response.status_code == 200
    body = response.json()
    assert "history" in body
    assert "suggested_features" in body
