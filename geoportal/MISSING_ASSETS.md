# Missing / Optional Assets

| Asset | Location | Notes |
| --- | --- | --- |
| Disease training history JSON | `backend/artifacts/<run_id>/disease_history.json` | Not included in repo. The visualization script will generate synthetic accuracy/loss curves unless a real history file is added here. |
| Additional disease images for testing | `uploads/` | Provide JPG/PNG samples if you want to showcase new crops beyond the canned dataset. |
| Updated FAOSTAT exports | `backend/data/kz/` | The repo ships with three CSVs. Drop the latest downloads here before re-training to keep the regressor fresh. |
