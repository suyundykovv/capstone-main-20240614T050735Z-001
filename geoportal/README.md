# GeoPortal

GeoPortal is a full-stack demo platform for climate-smart agriculture. It combines a Tailwind-powered frontend, a FastAPI backend, a stub ML inference service, agronomic datasets, and Docker orchestration so you can showcase agronomic analytics end to end.

## Project Structure
```
geoportal/
├─ frontend/
│  ├─ pages/ (landing, dashboard, crop labs, learn-more articles)
│  ├─ css/   (shared styles)
│  ├─ js/    (browser logic)
│  └─ images/
├─ backend/
│  ├─ app/main.py      FastAPI application
│  ├─ app/ml_model.py  ML stub
│  ├─ requirements.txt
│  └─ Dockerfile
├─ data/       Sample XLSX datasets served by the API
├─ uploads/    Runtime image uploads (mounted volume)
├─ docker-compose.yml
└─ README.md
```

## Frontend Pages
- `frontend/pages/main.html` – marketing landing with stats and contact form
- `frontend/pages/home.html` – select crop workflows
- `frontend/pages/corn.html` (and potato/rice/wheat) – upload & predict
- `frontend/pages/calculator.html` – Leaflet map, Chart.js line chart, XLSX catalog
- `frontend/pages/learn_more/*.html` – agronomic insights articles

All pages share the same navigation and use Tailwind + custom CSS. JavaScript in `frontend/js/script.js` and `frontend/js/scripte.js` handles map/chart rendering, dataset downloads, uploads, and ML predictions.

## Backend API (FastAPI)
| Endpoint | Description |
| --- | --- |
| `GET /api/hello` | Health probe |
| `POST /api/upload` | Stores multipart uploads in `/uploads` (8 MB limit) |
| `POST /api/predict` | `multipart/form-data` → image disease inference, `application/json` → yield regression |
| `GET /api/files` | Lists available `.xlsx` datasets from `geoportal/data` |
| `GET /api/files/{filename}` | Streams the requested dataset |
| `GET /api/models/status` | Reports disease/yield model metadata, load status, and run ids |

The backend now uses the TensorFlow `plant_model.h5` for disease detection and a trained `RandomForestRegressor` for yield forecasts. Both models expose graceful stubs when assets are missing so demos never break.

### ML Pipeline Overview
* **Data prep** – `python -m app.data_prep.yield_prep` ingests every CSV under `backend/data/kz`, pivots FAOSTAT features, imputes/standardises numerics, one-hot encodes crop types, and produces 70/20/10 splits plus `yield_features.json`.
* **Training** – `python -m app.models.train_yield_regressor` runs a 3-fold grid-search over `n_estimators`, `max_depth`, `min_samples_split`, captures RMSE/MAE/R² on validation/test sets, and saves artifacts under `backend/artifacts/<run_id>/`.
* **Artifacts** – Each run stores:
  - `yield_model.pkl`, `yield_metadata.json`, `yield_features.json`
  - Cleaned splits in `data/`
  - Logs + optional visualisations inside `plots/`
  - A copy of the latest model + metadata is synced to `backend/app/models/` for FastAPI.
* **Disease labels** – `backend/app/models/disease_labels.json` mirrors the original `ml_model/class_labels.json` so the API can map logits to `{crop, disease}` pairs.

Generate comparison charts with:
```bash
cd backend
python -m app.visualization.plot_metrics --run-id <run_id>
```
This writes accuracy/loss curves for the disease network (synthetic if no history JSON is supplied) and RMSE/MAE bars for the regressor inside `backend/artifacts/<run_id>/plots/`.

## Running Locally (manual)

### 1. Backend
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Model training
```bash
cd backend
python -m app.models.train_yield_regressor            # runs data prep + grid-search
python -m app.visualization.plot_metrics --run-id <run_id>
```
Artifacts land in `backend/artifacts/<run_id>/` and the FastAPI server automatically picks up the fresh `yield_model.pkl` / metadata copies under `backend/app/models/`.

### 2. Frontend
Use any static server from `frontend/`.
```bash
cd frontend
python3 -m http.server 5500
```
Open `http://localhost:5500/pages/main.html` in a browser.

### 3. Demo script
1. Open the landing page → submit contact form (calls `/api/hello`).
2. Go to Dashboard → confirm Leaflet map and Chart.js chart render. Click “Quick download” or any dataset row: files flow through `/api/files/*`.
3. Navigate to Crop Lab: pick a crop, upload an image (any JPG/PNG), hit **Upload** then **Predict**. Responses come from `/api/upload` and `/api/predict`.
4. Visit “Learn More” pages for agronomy content.

## Docker Compose
```bash
docker-compose up --build
```
Services:
- `backend` – FastAPI + ML pipeline on port `8000`
- `db` – PostgreSQL 14 (placeholder for future persistence)

Volumes:
- `./backend:/app/backend` (hot reload + trained models)
- `./uploads:/app/uploads`
- `./data:/app/data`
- `pgdata` for Postgres data

## Environment
No secrets are required. Optional: set `DATABASE_URL` if you plan to use Postgres (a default is injected via Compose).

## Testing the API Quickly
```bash
curl http://localhost:8000/api/hello
curl -F "file=@frontend/images/hero-fields.svg" http://localhost:8000/api/predict
curl -H "Content-Type: application/json" \
     -d '{"crop_type":"wheat","year":2024,"area_harvested_ha":1500,"production_t":900}' \
     http://localhost:8000/api/predict
curl http://localhost:8000/api/models/status
```

### Testing & CI
```bash
cd backend
flake8 app tests
pytest
./tests/smoke_test.sh
```
GitHub Actions (`.github/workflows/ci.yml`) runs lint → pytest → smoke test on every push/PR.

## Notes
- Uploaded files land in `/uploads`; clean up as needed.
- Dataset downloads automatically URI-encode filenames.
- Kazakhstan CSVs used for model training should live under `backend/data/kz/`.
- Yield model artifacts + logs are rotated per `run-YYYYMMDD-HHMMSS` inside `backend/artifacts/`.
- All assets use ASCII file names for cross-platform compatibility.

Happy growing! 🌱
