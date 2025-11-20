from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

import joblib
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GridSearchCV
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from app.data_prep.yield_prep import TARGET_COLUMN, prepare_dataset, write_json

try:  # sklearn >=1.4
    from sklearn.metrics import root_mean_squared_error as _rmse_fn
except ImportError:  # pragma: no cover - compatibility
    _rmse_fn = None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


LOGGER = logging.getLogger("train_yield_regressor")

BACKEND_DIR = Path(__file__).resolve().parents[2]
MODELS_DIR = BACKEND_DIR / "app" / "models"


def build_pipeline(
    numeric_features: List[str],
    categorical_features: List[str],
) -> Pipeline:
    transformers = []
    if numeric_features:
        transformers.append(
            (
                "numeric",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="median")),
                        ("scaler", StandardScaler()),
                    ]
                ),
                numeric_features,
            )
        )
    if categorical_features:
        transformers.append(
            (
                "categorical",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        (
                            "encoder",
                            OneHotEncoder(handle_unknown="ignore", sparse_output=False),
                        ),
                    ]
                ),
                categorical_features,
            )
        )

    preprocessor = ColumnTransformer(transformers=transformers)
    regressor = RandomForestRegressor(
        n_estimators=200,
        max_depth=10,
        random_state=42,
        n_jobs=-1,
    )
    return Pipeline(
        steps=[
            ("preprocessor", preprocessor),
            ("regressor", regressor),
        ]
    )


def evaluate(model: Pipeline, features, target) -> Dict[str, float | None]:
    try:
        predictions = model.predict(features)
    except Exception as exc:  # pragma: no cover - defensive
        LOGGER.exception("Failed to generate predictions: %s", exc)
        return {"rmse": None, "mae": None, "r2": None}

    metrics = {}
    try:
        if _rmse_fn:
            metrics["rmse"] = float(_rmse_fn(target, predictions))
        else:
            metrics["rmse"] = float(mean_squared_error(target, predictions, squared=False))
    except ValueError:
        metrics["rmse"] = None
    try:
        metrics["mae"] = float(mean_absolute_error(target, predictions))
    except ValueError:
        metrics["mae"] = None
    try:
        metrics["r2"] = float(r2_score(target, predictions))
    except ValueError:
        metrics["r2"] = None
    return metrics


def run_grid_search(
    pipeline: Pipeline,
    features,
    target,
    param_grid: Dict[str, list],
    cv_folds: int,
) -> GridSearchCV:
    LOGGER.info("Running grid search with %s folds", cv_folds)
    grid = GridSearchCV(
        estimator=pipeline,
        param_grid=param_grid,
        scoring="neg_root_mean_squared_error",
        cv=cv_folds,
        n_jobs=-1,
        verbose=1,
    )
    try:
        grid.fit(features, target)
        return grid
    except MemoryError:
        LOGGER.warning("OOM encountered. Retrying with lighter hyperparameter grid.")
        lite_grid = {
            "regressor__n_estimators": [100, 150],
            "regressor__max_depth": [8, 10],
            "regressor__min_samples_split": [2, 4],
        }
        lite = GridSearchCV(
            estimator=pipeline,
            param_grid=lite_grid,
            scoring="neg_root_mean_squared_error",
            cv=max(2, cv_folds),
            n_jobs=1,
            verbose=1,
        )
        lite.fit(features, target)
        return lite


def persist_model_artifacts(
    run_dir: Path,
    pipeline: Pipeline,
    metadata: Dict[str, Any],
    feature_names: List[str],
) -> None:
    model_path = run_dir / "yield_model.pkl"
    joblib.dump(pipeline, model_path)
    write_json(run_dir / "yield_metadata.json", metadata)
    write_json(run_dir / "yield_features.json", feature_names)

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(pipeline, MODELS_DIR / "yield_model.pkl")
    write_json(MODELS_DIR / "yield_features.json", feature_names)
    write_json(MODELS_DIR / "yield_metadata.json", metadata)
    LOGGER.info("Persisted trained model and metadata to %s and %s", run_dir, MODELS_DIR)


def train(run_id: str | None = None, verbose: bool = False) -> Dict[str, Any]:
    dataset = prepare_dataset(run_id=run_id)
    run_dir = dataset.artifacts_dir
    configure_logging(run_dir, verbose=verbose)

    X_train = dataset.train.drop(columns=[TARGET_COLUMN])
    y_train = dataset.train[TARGET_COLUMN]
    X_val = dataset.val.drop(columns=[TARGET_COLUMN])
    y_val = dataset.val[TARGET_COLUMN]
    X_test = dataset.test.drop(columns=[TARGET_COLUMN])
    y_test = dataset.test[TARGET_COLUMN]

    pipeline = build_pipeline(dataset.numeric_features, dataset.categorical_features)

    param_grid = {
        "regressor__n_estimators": [150, 200, 250],
        "regressor__max_depth": [8, 10, 12],
        "regressor__min_samples_split": [2, 4, 6],
    }
    cv_folds = min(3, len(dataset.train))
    if cv_folds < 2:
        raise ValueError("Not enough samples to run 3-fold CV. Please add more data.")

    grid = run_grid_search(pipeline, X_train, y_train, param_grid, cv_folds)
    best_pipeline = grid.best_estimator_
    feature_names = (
        best_pipeline.named_steps["preprocessor"]
        .get_feature_names_out()
        .tolist()
    )

    val_metrics = evaluate(best_pipeline, X_val, y_val)
    test_metrics = evaluate(best_pipeline, X_test, y_test)

    metadata = {
        "run_id": dataset.run_id,
        "generated_at": utc_now(),
        "model_class": "RandomForestRegressor",
        "best_params": grid.best_params_,
        "param_grid": param_grid,
        "metrics": {
            "validation": val_metrics,
            "test": test_metrics,
        },
        "data": {
            "train_rows": len(dataset.train),
            "val_rows": len(dataset.val),
            "test_rows": len(dataset.test),
            "target_column": TARGET_COLUMN,
            "numeric_features": dataset.numeric_features,
            "categorical_features": dataset.categorical_features,
        },
    }

    persist_model_artifacts(run_dir, best_pipeline, metadata, feature_names)
    LOGGER.info("Training run %s complete", dataset.run_id)
    return metadata


def configure_logging(run_dir: Path, verbose: bool = False) -> None:
    log_dir = run_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    handlers = [logging.StreamHandler(), logging.FileHandler(log_dir / "train.log")]
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        handlers=handlers,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train the Kazakhstan yield regressor.")
    parser.add_argument("--run-id", type=str, default=None, help="Reuse an existing run id")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logs")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    metadata = train(run_id=args.run_id, verbose=args.verbose)
    LOGGER.info("Stored metadata: %s", json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
