from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

import matplotlib.pyplot as plt
import seaborn as sns

LOGGER = logging.getLogger("plot_metrics")

BACKEND_DIR = Path(__file__).resolve().parents[2]
ARTIFACTS_DIR = BACKEND_DIR / "artifacts"
MODELS_DIR = BACKEND_DIR / "app" / "models"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def latest_run_dir() -> Path | None:
    runs = sorted(
        (path for path in ARTIFACTS_DIR.iterdir() if path.is_dir()),
        key=lambda p: p.name,
        reverse=True,
    )
    return runs[0] if runs else None


def load_json(path: Path) -> Dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def ensure_plots_dir(run_dir: Path) -> Path:
    plots_dir = run_dir / "plots"
    plots_dir.mkdir(parents=True, exist_ok=True)
    return plots_dir


def plot_disease_history(history: Dict[str, List[float]], destination: Path) -> None:
    sns.set_theme(style="whitegrid")
    epochs = history.get("epochs") or list(range(1, len(history.get("accuracy", [])) + 1))
    plt.figure(figsize=(8, 4))
    plt.plot(epochs, history.get("accuracy", []), label="Train Acc")
    plt.plot(epochs, history.get("val_accuracy", []), label="Val Acc")
    plt.xlabel("Epoch")
    plt.ylabel("Accuracy")
    plt.title("Disease Model Accuracy Trend")
    plt.legend()
    plt.tight_layout()
    acc_path = destination / "disease_accuracy.png"
    plt.savefig(acc_path)
    plt.close()

    plt.figure(figsize=(8, 4))
    plt.plot(epochs, history.get("loss", []), label="Train Loss")
    plt.plot(epochs, history.get("val_loss", []), label="Val Loss")
    plt.xlabel("Epoch")
    plt.ylabel("Loss")
    plt.title("Disease Model Loss Trend")
    plt.legend()
    plt.tight_layout()
    loss_path = destination / "disease_loss.png"
    plt.savefig(loss_path)
    plt.close()
    LOGGER.info("Saved disease plots to %s and %s", acc_path, loss_path)


def plot_yield_metrics(metadata: Dict, destination: Path) -> None:
    metrics = metadata.get("metrics", {})
    names = []
    rmse = []
    mae = []
    for split_name in ("validation", "test"):
        split_metrics = metrics.get(split_name) or {}
        names.append(split_name.title())
        rmse.append(split_metrics.get("rmse", 0))
        mae.append(split_metrics.get("mae", 0))

    sns.set_theme(style="whitegrid")
    plt.figure(figsize=(6, 4))
    sns.barplot(x=names, y=rmse, hue=names, palette="Blues_d", dodge=False, legend=False)
    plt.title("Yield RMSE by Split")
    plt.ylabel("RMSE (kg/ha)")
    plt.tight_layout()
    rmse_path = destination / "yield_rmse.png"
    plt.savefig(rmse_path)
    plt.close()

    plt.figure(figsize=(6, 4))
    sns.barplot(x=names, y=mae, hue=names, palette="Greens_d", dodge=False, legend=False)
    plt.title("Yield MAE by Split")
    plt.ylabel("MAE (kg/ha)")
    plt.tight_layout()
    mae_path = destination / "yield_mae.png"
    plt.savefig(mae_path)
    plt.close()
    LOGGER.info("Saved yield plots to %s and %s", rmse_path, mae_path)


def synthetic_history(epochs: int = 10) -> Dict[str, List[float]]:
    import numpy as np

    epoch_axis = list(range(1, epochs + 1))
    acc = np.linspace(0.55, 0.94, epochs)
    val_acc = np.linspace(0.5, 0.9, epochs) - np.random.uniform(0, 0.02, epochs)
    loss = np.linspace(1.2, 0.2, epochs)
    val_loss = loss + np.random.uniform(0, 0.1, epochs)
    return {
        "epochs": epoch_axis,
        "accuracy": acc.tolist(),
        "val_accuracy": val_acc.tolist(),
        "loss": loss.tolist(),
        "val_loss": val_loss.tolist(),
        "generated_at": utc_now(),
        "source": "synthetic",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Plot disease and yield metrics.")
    parser.add_argument("--run-id", type=str, help="Existing artifact run id")
    parser.add_argument(
        "--disease-history",
        type=Path,
        help="Path to disease training history JSON",
    )
    parser.add_argument("--yield-metadata", type=Path, default=MODELS_DIR / "yield_metadata.json")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
    )

    run_dir = ARTIFACTS_DIR / args.run_id if args.run_id else latest_run_dir()
    if not run_dir or not run_dir.exists():
        run_dir = ARTIFACTS_DIR / datetime.now(timezone.utc).strftime("plots-%Y%m%d-%H%M%S")
        run_dir.mkdir(parents=True, exist_ok=True)
        LOGGER.warning("No artifact run found. Using %s for plots.", run_dir)
    plots_dir = ensure_plots_dir(run_dir)

    if args.disease_history and args.disease_history.exists():
        disease_history = load_json(args.disease_history)
    else:
        LOGGER.warning("Disease history not provided; generating synthetic curves.")
        disease_history = synthetic_history()
    plot_disease_history(disease_history, plots_dir)

    if not args.yield_metadata.exists():
        raise FileNotFoundError(f"Yield metadata not found: {args.yield_metadata}")
    yield_metadata = load_json(args.yield_metadata)
    plot_yield_metrics(yield_metadata, plots_dir)
    LOGGER.info("All plots saved under %s", plots_dir)


if __name__ == "__main__":
    main()
