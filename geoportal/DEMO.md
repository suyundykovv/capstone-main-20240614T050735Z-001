# GeoPortal Demo Playbook

## 1. Start services
```bash
docker-compose up --build -d
# or locally
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## 2. Quick API walkthrough
### Health check
```bash
curl http://localhost:8000/api/hello | jq
```

### Disease inference
```bash
curl -F "file=@frontend/images/hero-fields.svg" \
     http://localhost:8000/api/predict | jq
```
Expected keys: `mode=disease`, `crop`, `disease`, `confidence`, `fertilizer_suggestion`, `inference_engine`.

### Yield regression
```bash
curl -H "Content-Type: application/json" \
     -d '{"crop_type":"wheat","year":2024,"area_harvested_ha":1800,"production_t":950}' \
     http://localhost:8000/api/predict | jq
```
Response includes `predicted_yield (kg/ha)`, `confidence`, `model_version`, and an echo of the validated input.

### Model status
```bash
curl http://localhost:8000/api/models/status | jq
```
Shows whether TensorFlow and RandomForest assets are loaded plus the last training `run_id`.

### File catalog
```bash
curl http://localhost:8000/api/files | jq '.[] | {filename, size_kb}'
curl -OJ http://localhost:8000/api/files/yield_baseline.xlsx
```

## 3. Training recap (fast forward)
Rebuild the yield regressor for live demos:
```bash
cd backend
python -m app.models.train_yield_regressor
python -m app.visualization.plot_metrics --run-id <printed-run-id>
```
Artifacts + plots appear under `backend/artifacts/<run_id>/`.

## 4. Smoke validation (optional)
```bash
cd backend
./tests/smoke_test.sh
```
This script spins up uvicorn on port `8010`, calls `/api/hello`, `/api/predict (JSON)`, and `/api/models/status`, then shuts down automatically.

## 5. Demo storyline
1. **Context** – highlight Kazakhstan datasets + multi-modal predictions.
2. **Disease flow** – upload any PNG/JPG, point out fertilizer guidance.
3. **Yield flow** – send JSON payload, compare predicted kg/ha to historical values.
4. **Ops view** – show `GET /api/models/status` and the artifacts folder to prove retrainability.
