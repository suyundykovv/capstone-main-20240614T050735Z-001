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
- `frontend/pages/main.html` – multilingual landing with corporate hero, capability cards, trust metrics, and contact form
- `frontend/pages/dashboard.html` – interactive dashboard with Chart.js line/bar/pie charts, dataset catalog, and filter controls
- `frontend/pages/crop_lab.html` – drag & drop Crop Lab for disease detection with confidence bar and fertilizer guidance
- `frontend/pages/calculator.html` – yield scenario form with autofill from history, result card, and history chart
- `frontend/pages/learn_more/*.html` – localized articles with Leaflet maps for NDVI/yield overlays

All pages share the same navigation bar, Tailwind CSS styling, and Inter font. The global browser logic lives in `frontend/js/app.js`, which powers i18n, form submissions, dataset tables, charts, Leaflet overlays, and ML interactions. Language packs are defined under `frontend/i18n/en.json` and `frontend/i18n/ru.json`.

## Backend API (FastAPI)
| Endpoint | Description |
| --- | --- |
| `GET /api/hello` | Lightweight ping with timestamp |
| `POST /api/hello` | Contact form intake, logged to artifacts |
| `POST /api/upload` | Stores multipart uploads in `/uploads` (8 MB limit) |
| `POST /api/predict?lang=en|ru` | `multipart/form-data` → disease inference, `application/json` → yield regression (language-aware recommendations + rate limiting) |
| `GET /api/models/status` | Disease/yield model metadata, load status, versions |
| `GET /api/files?ext=csv&ext=xlsx` | Lists CSV/XLSX assets from `/data` and `backend/data/kz` |
| `GET /api/files/{filename}` | Streams the requested dataset with correct mime type |
| `GET /api/dashboard/metrics` | Aggregated metrics, line/bar/pie data, fertilizer mix, and table rows |
| `GET /api/yield/history` | Historical yield slices plus autofill suggestions (supports `crop_type`, `region`, `limit`) |

The backend loads TensorFlow `plant_model.h5` for disease detection (with a stub fallback) and the trained RandomForest regressor for yield forecasts. All predictions are logged under `backend/artifacts/<run_id>/logs/predictions.log`, and the `/api/predict` endpoint enforces an 8 MB payload limit plus a per-IP rate limiter.

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
Open `http://localhost:5500/pages/main.html`. Language detection auto-selects `ru`/`en` based on the browser, and you can switch via the header dropdown without refreshing.

### 3. Demo script
1. Landing (`main.html`): switch languages, inspect stats, send the contact form (`POST /api/hello`).
2. Dashboard (`dashboard.html`): adjust crop/region/year filters, watch Chart.js widgets update, and download CSV/XLSX assets (served via `/api/files/*`).
3. Crop Lab (`crop_lab.html`): drag a JPG/PNG into the drop zone and run inference (`POST /api/predict?lang=...`).
4. Calculator (`calculator.html`): select crop/region, click **Autofill from history** (`GET /api/yield/history`), tweak inputs, and submit to `/api/predict`.
5. Articles (`learn_more/*.html`): view localized copy plus Leaflet NDVI/yield overlays.

## Docker Compose
```bash
docker-compose up --build
```
Services:
- `backend` – FastAPI + ML pipeline on port `8000`
- `db` – PostgreSQL 14 (placeholder for future persistence)
- `frontend` – nginx serving the static Tailwind app on port `8080`

Volumes:
- `./backend:/app/backend` (hot reload + trained models)
- `./uploads:/app/uploads`
- `./data:/app/data`
- `pgdata` for Postgres data

## Environment
No secrets are required. Optional: set `DATABASE_URL` if you plan to use Postgres (a default is injected via Compose).

## Testing the API Quickly
```bash
# health + contact
curl http://localhost:8000/api/hello
curl -X POST -H "Content-Type: application/json" \
     -d '{"name":"Test User","email":"user@example.com","message":"Need demo."}' \
     http://localhost:8000/api/hello

# disease inference
curl -F "file=@frontend/images/hero-fields.svg" \
     "http://localhost:8000/api/predict?lang=en"

# yield prediction
curl -H "Content-Type: application/json" \
     -d '{"crop_type":"wheat","year":2024,"area_harvested_ha":1500,"production_t":900}' \
     "http://localhost:8000/api/predict?lang=ru"

# dashboards & history
curl http://localhost:8000/api/dashboard/metrics
curl "http://localhost:8000/api/yield/history?crop_type=Wheat&limit=8"

# status + datasets
curl http://localhost:8000/api/models/status
curl http://localhost:8000/api/files
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
