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
    monkeypatch.setenv("WORKFLOW_ALLOW_INSECURE_DIRECT_ACCESS", "false")
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
    job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading", owner_id="alice")

    missing_secret = client_with_proxy_secret.get(f"/api/jobs/{job.job_id}")
    wrong_secret = client_with_proxy_secret.get(f"/api/jobs/{job.job_id}", headers={"X-Science-Workshop-Proxy-Secret": "wrong"})
    missing_user = client_with_proxy_secret.get(
        f"/api/jobs/{job.job_id}",
        headers={"X-Science-Workshop-Proxy-Secret": "proxy-secret"},
    )
    valid_secret = client_with_proxy_secret.get(
        f"/api/jobs/{job.job_id}",
        headers={
            "X-Science-Workshop-Proxy-Secret": "proxy-secret",
            "X-Workshop-User": "alice",
        },
    )

    assert missing_secret.status_code == 401
    assert wrong_secret.status_code == 401
    assert missing_user.status_code == 401
    assert missing_user.json()["detail"] == "Authenticated user is required"
    assert valid_secret.status_code == 200
    assert valid_secret.json()["job_id"] == job.job_id


def test_protected_routes_fail_closed_without_proxy_secret(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("WORKFLOW_STORAGE_DIR", str(tmp_path / "workflow_jobs"))
    monkeypatch.setenv("WORKFLOW_USE_MOCKS", "true")
    monkeypatch.delenv("SCIENCE_WORKSHOP_PROXY_SECRET", raising=False)
    monkeypatch.setenv("WORKFLOW_ALLOW_INSECURE_DIRECT_ACCESS", "false")
    reset_settings_cache()
    from app.main import create_app

    app = create_app()
    try:
        with TestClient(app) as test_client:
            response = test_client.get(
                "/api/source-requests",
                headers={"x-workshop-user": "attacker", "x-workshop-role": "admin"},
            )
            assert response.status_code == 503
            assert response.json()["detail"] == "Protected API proxy secret is not configured"
            assert test_client.get("/api/health").status_code == 200
    finally:
        reset_settings_cache()
