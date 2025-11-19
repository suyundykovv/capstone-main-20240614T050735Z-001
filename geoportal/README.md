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
| `POST /api/upload` | Receives `file`, stores it under `/uploads`, returns metadata |
| `POST /api/predict` | Receives `file`, sends bytes to ML stub, returns JSON `{crop, disease, confidence, fertilizer_suggestion}` |
| `GET /api/files` | Lists available `.xlsx` datasets |
| `GET /api/files/{filename}` | Streams the requested dataset with `Content-Disposition` |

The ML stub in `ml_model.py` returns realistic random combinations for demo purposes.

## Running Locally (manual)

### 1. Backend
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

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
- `backend` – FastAPI + ML stub on port `8000`
- `db` – PostgreSQL 14 (ready for future persistence)

Volumes:
- `./uploads:/app/uploads`
- `./data:/app/data`
- `pgdata` for Postgres data

## Environment
No secrets are required. Optional: set `DATABASE_URL` if you plan to use Postgres (a default is injected via Compose).

## Testing the API Quickly
```bash
curl http://localhost:8000/api/hello
curl -F "file=@frontend/images/hero-fields.svg" http://localhost:8000/api/predict
```

## Notes
- Uploaded files land in `/uploads`; clean up as needed.
- Dataset downloads automatically URI-encode filenames.
- All assets use ASCII file names for cross-platform compatibility.

Happy growing! 🌱
