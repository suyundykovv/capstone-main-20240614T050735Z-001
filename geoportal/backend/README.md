# GeoPortal Backend

This directory contains the FastAPI app, ML assets, data-prep utilities, tests, Docker build context, and CI artifacts required to run the GeoPortal backend.

## Structure
```
backend/
├─ app/
│  ├─ main.py                # FastAPI entrypoint
│  ├─ ml_model.py            # Disease + yield model orchestration
│  ├─ data_prep/yield_prep.py
│  ├─ models/train_yield_regressor.py
│  ├─ models/*.json|.pkl     # Inference-ready assets
│  └─ visualization/plot_metrics.py
├─ data/kz/*.csv             # Kazakhstan FAOSTAT extracts used for training
├─ ml_model/plant_model.h5   # TensorFlow disease network
├─ artifacts/<run_id>/...    # Training logs, splits, plots
├─ tests/                    # pytest suite + smoke test script
├─ Dockerfile
├─ requirements.txt
└─ README.md (this file)
```

## Data preparation & training
1. **Place CSVs** under `backend/data/kz/`. Every file is concatenated, so you can drop multiple FAOSTAT exports.
2. **Run the training pipeline** (data prep is called automatically):
   ```bash
   cd backend
   python -m app.models.train_yield_regressor          # grid-search RandomForestRegressor
   python -m app.visualization.plot_metrics --run-id <run_id>
   ```
3. **Artifacts** live under `backend/artifacts/<run_id>/`:
   - `data/` – cleaned train/val/test CSVs
   - `yield_model.pkl`, `yield_features.json`, `yield_metadata.json`
   - `logs/`, `plots/`
   - Copies of the latest model + metadata are synced to `app/models/` so FastAPI can load them on startup.

If training exhausts memory, the script retries with a lighter hyperparameter grid and records the degradation in `yield_metadata.json`.

## Running the API
```bash
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
Key environment folders:
- `geoportal/data/` (served via `/api/files`)
- `geoportal/uploads/` (created automatically)
- `backend/ml_model/plant_model.h5` (disease inference)

## Tests & smoke check
```bash
cd backend
flake8 app tests
pytest
./tests/smoke_test.sh        # launches uvicorn on port 8010 and hits /api endpoints
```

`tests/test_api.py` provides unit coverage for `/api/models/status`, `/api/predict` (disease + yield modes), and `/api/files`. The smoke script is also executed in CI to verify the built service exposes the expected JSON keys.

## Docker & Compose
`Dockerfile` installs system deps (`build-essential`, `libgl1`), Python requirements, copies the backend into `/app/backend`, and starts FastAPI via `uvicorn app.main:app`.  
`docker-compose.yml` mounts:
- `./backend:/app/backend` (source + artifacts)
- `./uploads:/app/uploads`
- `./data:/app/data`

## CI
`.github/workflows/ci.yml` runs on every push/PR:
1. Checkout
2. Setup Python 3.12
3. `pip install -r backend/requirements.txt`
4. `flake8 app tests`
5. `pytest`
6. `./tests/smoke_test.sh`

## Artifacts for demos
- Disease labels: `app/models/disease_labels.json`
- Disease model: `backend/ml_model/plant_model.h5`
- Latest yield model bundle: `app/models/yield_model.pkl`, `yield_metadata.json`, `yield_features.json`
- Historical runs: `backend/artifacts/run-*/`

If you need to reference missing media or datasets, list them in `../MISSING_ASSETS.md`.
