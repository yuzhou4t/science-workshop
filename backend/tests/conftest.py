from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient

from app.core.config import reset_settings_cache


@pytest.fixture()
def client(tmp_path, monkeypatch) -> Generator[TestClient, None, None]:
    monkeypatch.setenv("WORKFLOW_STORAGE_DIR", str(tmp_path / "workflow_jobs"))
    monkeypatch.setenv("WORKFLOW_RETENTION_DAYS", "7")
    monkeypatch.setenv("WORKFLOW_USE_MOCKS", "true")
    monkeypatch.setenv("WORKFLOW_ALLOW_INSECURE_DIRECT_ACCESS", "true")
    monkeypatch.setenv("SCIENCE_WORKSHOP_RUNTIME_SOURCES_PATH", str(tmp_path / "community-sources.json"))
    reset_settings_cache()
    from app.main import create_app

    app = create_app()
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        reset_settings_cache()
