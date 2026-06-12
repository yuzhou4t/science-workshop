import pytest
from fastapi.testclient import TestClient

from app.core.config import reset_settings_cache
from app.models.job import WorkflowType


@pytest.fixture()
def client_with_proxy_secret(tmp_path, monkeypatch):
    monkeypatch.setenv("WORKFLOW_STORAGE_DIR", str(tmp_path / "workflow_jobs"))
    monkeypatch.setenv("WORKFLOW_RETENTION_DAYS", "7")
    monkeypatch.setenv("WORKFLOW_USE_MOCKS", "true")
    monkeypatch.setenv("SCIENCE_WORKSHOP_PROXY_SECRET", "proxy-secret")
    reset_settings_cache()
    from app.main import create_app

    app = create_app()
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        reset_settings_cache()


def test_health_stays_public_when_proxy_secret_is_configured(client_with_proxy_secret: TestClient) -> None:
    response = client_with_proxy_secret.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_workflow_job_routes_require_proxy_secret(client_with_proxy_secret: TestClient) -> None:
    store = client_with_proxy_secret.app.state.job_store
    job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading")

    missing_secret = client_with_proxy_secret.get(f"/api/jobs/{job.job_id}")
    wrong_secret = client_with_proxy_secret.get(f"/api/jobs/{job.job_id}", headers={"X-Science-Workshop-Proxy-Secret": "wrong"})
    valid_secret = client_with_proxy_secret.get(f"/api/jobs/{job.job_id}", headers={"X-Science-Workshop-Proxy-Secret": "proxy-secret"})

    assert missing_secret.status_code == 401
    assert wrong_secret.status_code == 401
    assert valid_secret.status_code == 200
    assert valid_secret.json()["job_id"] == job.job_id
