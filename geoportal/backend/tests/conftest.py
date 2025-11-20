from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app, disease_model, yield_model


@pytest.fixture(scope="session")
def client():
    disease_model.load = lambda: None  # type: ignore[assignment]
    yield_model.load = lambda: None  # type: ignore[assignment]
    with TestClient(app) as test_client:
        yield test_client
