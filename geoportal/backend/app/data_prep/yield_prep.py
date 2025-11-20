from __future__ import annotations

import argparse
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Tuple

import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import OneHotEncoder

LOGGER = logging.getLogger("yield_prep")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


BACKEND_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BACKEND_DIR / "data" / "kz"
ARTIFACTS_DIR = BACKEND_DIR / "artifacts"
MODELS_DIR = BACKEND_DIR / "app" / "models"
TARGET_COLUMN = "yield_kg_per_ha"


@dataclass
class YieldDataset:
    train: pd.DataFrame
    val: pd.DataFrame
    test: pd.DataFrame
    target_column: str
    numeric_features: List[str]
    categorical_features: List[str]
    run_id: str
    artifacts_dir: Path


def _snake_case(value: str) -> str:
    return (
        value.strip()
        .lower()
        .replace("/", "_")
        .replace("-", "_")
        .replace(" ", "_")
    )


def load_raw_frames(data_dir: Path) -> pd.DataFrame:
    csv_paths = sorted(data_dir.glob("*.csv"))
    if not csv_paths:
        raise FileNotFoundError(
            f"No CSV files found under {data_dir}. "
            "Place Kazakhstan agro CSVs before running the prep script."
        )
    frames: List[pd.DataFrame] = []
    for path in csv_paths:
        LOGGER.info("Loading %s", path.name)
        frames.append(pd.read_csv(path))
    data = pd.concat(frames, ignore_index=True)
    LOGGER.info("Combined %s rows from %s files", len(data), len(csv_paths))
    return data


def tidy_dataframe(raw_df: pd.DataFrame) -> Tuple[pd.DataFrame, List[str], List[str]]:
    df = raw_df.copy()
    df.columns = [_snake_case(col) for col in df.columns]
    expected_columns = {
        "area",
        "element",
        "item",
        "unit",
        "value",
        "year",
    }
    missing = expected_columns - set(df.columns)
    if missing:
        raise ValueError(f"Missing expected columns in dataset: {missing}")

    df["year"] = pd.to_numeric(df["year"], errors="coerce").astype("Int64")
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df["element"] = df["element"].apply(_snake_case)
    df["item"] = df["item"].fillna("Unknown crop").str.strip()
    df["crop_type"] = df["item"].str.lower().str.replace(" ", "_")

    pivot = (
        df.pivot_table(
            values="value",
            index=["year", "crop_type"],
            columns="element",
            aggfunc="mean",
        )
        .reset_index()
        .rename_axis(None, axis=1)
    )

    rename_map = {
        "yield": TARGET_COLUMN,
        "area_harvested": "area_harvested_ha",
        "production": "production_t",
    }
    pivot = pivot.rename(columns=rename_map)

    if TARGET_COLUMN not in pivot:
        raise ValueError(
            "Pivoted dataframe does not contain yield values. "
            "Ensure CSV includes rows with Element='Yield'."
        )

    pivot["year"] = pivot["year"].astype(int)
    pivot = pivot.sort_values(["crop_type", "year"]).reset_index(drop=True)
    pivot["production_per_area"] = pivot["production_t"] / pivot["area_harvested_ha"].replace(
        {0: pd.NA}
    )
    pivot["area_change_rate"] = pivot.groupby("crop_type")["area_harvested_ha"].pct_change(
        fill_method=None
    )
    pivot["yield_change_rate"] = pivot.groupby("crop_type")[TARGET_COLUMN].pct_change(
        fill_method=None
    )
    pivot = pivot.ffill().bfill()
    pivot = pivot.dropna(subset=[TARGET_COLUMN])

    feature_columns = [
        col
        for col in pivot.columns
        if col not in {"crop_type", TARGET_COLUMN}
    ]
    numeric_features = [col for col in feature_columns if pivot[col].dtype != "object"]
    categorical_features = ["crop_type"]

    LOGGER.info(
        "Prepared dataframe with %s rows, %s numeric features and %s categorical features",
        len(pivot),
        len(numeric_features),
        len(categorical_features),
    )
    return pivot, numeric_features, categorical_features


def split_dataset(
    df: pd.DataFrame, target_column: str
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    if len(df) < 10:
        raise ValueError(
            "Dataset is too small for a 70/20/10 split. "
            f"Need at least 10 rows, received {len(df)}."
        )
    train_df, temp_df = train_test_split(
        df, test_size=0.3, random_state=42, shuffle=True
    )
    val_df, test_df = train_test_split(
        temp_df, test_size=1 / 3, random_state=42, shuffle=True
    )
    LOGGER.info(
        "Split dataset into train=%s, val=%s, test=%s",
        len(train_df),
        len(val_df),
        len(test_df),
    )
    return train_df, val_df, test_df


def compute_feature_manifest(
    train_df: pd.DataFrame,
    numeric_features: List[str],
    categorical_features: List[str],
) -> List[str]:
    feature_names = list(numeric_features)
    if categorical_features:
        encoder = OneHotEncoder(
            handle_unknown="ignore", sparse_output=False
        )
        encoder.fit(train_df[categorical_features])
        cat_names = encoder.get_feature_names_out(categorical_features).tolist()
        feature_names.extend(cat_names)
    return feature_names


def save_splits(
    run_dir: Path,
    train_df: pd.DataFrame,
    val_df: pd.DataFrame,
    test_df: pd.DataFrame,
) -> None:
    data_dir = run_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    train_df.to_csv(data_dir / "train.csv", index=False)
    val_df.to_csv(data_dir / "val.csv", index=False)
    test_df.to_csv(data_dir / "test.csv", index=False)
    LOGGER.info("Persisted cleaned splits to %s", data_dir)


def write_json(path: Path, payload: dict | list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
    LOGGER.info("Wrote %s", path)


def prepare_dataset(run_id: str | None = None) -> YieldDataset:
    run_identifier = run_id or datetime.now(timezone.utc).strftime("run-%Y%m%d-%H%M%S")
    run_dir = ARTIFACTS_DIR / run_identifier
    run_dir.mkdir(parents=True, exist_ok=True)

    raw_df = load_raw_frames(DATA_DIR)
    pivot, numeric_features, categorical_features = tidy_dataframe(raw_df)
    train_df, val_df, test_df = split_dataset(pivot, TARGET_COLUMN)

    feature_manifest = compute_feature_manifest(train_df, numeric_features, categorical_features)
    write_json(run_dir / "yield_features.json", feature_manifest)
    write_json(
        run_dir / "data_summary.json",
        {
            "run_id": run_identifier,
            "generated_at": utc_now(),
            "rows": len(pivot),
            "train_rows": len(train_df),
            "val_rows": len(val_df),
            "test_rows": len(test_df),
            "target_column": TARGET_COLUMN,
            "numeric_features": numeric_features,
            "categorical_features": categorical_features,
        },
    )
    save_splits(run_dir, train_df, val_df, test_df)

    # Keep a copy of features next to the models folder for FastAPI usage
    write_json(MODELS_DIR / "yield_features.json", feature_manifest)

    return YieldDataset(
        train=train_df,
        val=val_df,
        test=test_df,
        target_column=TARGET_COLUMN,
        numeric_features=numeric_features,
        categorical_features=categorical_features,
        run_id=run_identifier,
        artifacts_dir=run_dir,
    )


def configure_logging(run_dir: Path | None = None, verbose: bool = False) -> None:
    handlers = [logging.StreamHandler()]
    if run_dir:
        log_path = run_dir / "logs" / "yield_prep.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        handlers.append(logging.FileHandler(log_path))
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        handlers=handlers,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare Kazakhstan yield datasets.")
    parser.add_argument("--run-id", type=str, default=None, help="Custom run identifier")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    provisional_run_id = args.run_id or datetime.now(timezone.utc).strftime("run-%Y%m%d-%H%M%S")
    configure_logging(ARTIFACTS_DIR / provisional_run_id, verbose=args.verbose)
    dataset = prepare_dataset(run_id=provisional_run_id)
    LOGGER.info(
        "Data preparation complete. Artifacts stored under %s",
        dataset.artifacts_dir,
    )


if __name__ == "__main__":
    main()
