from fastapi.testclient import TestClient

from app.models.job import WorkflowType


def test_health_endpoint(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_job_status_returns_created_job(client: TestClient) -> None:
    store = client.app.state.job_store
    job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading")

    response = client.get(f"/api/jobs/{job.job_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["job_id"] == job.job_id
    assert body["workflow_type"] == "paper_reading"
    assert body["status"] == "queued"


def test_artifact_download_returns_saved_markdown(client: TestClient) -> None:
    store = client.app.state.job_store
    job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading")
    store.write_text_artifact(job, "nodes/final.md", "# 标题\n\n正文")

    response = client.get(f"/api/jobs/{job.job_id}/artifacts/final.md")

    assert response.status_code == 200
    assert "# 标题" in response.text
    assert response.headers["content-type"].startswith("text/markdown")


def test_artifact_download_uses_safe_content_disposition_for_non_ascii_filename(
    client: TestClient,
) -> None:
    store = client.app.state.job_store
    job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading")
    store.write_text_artifact(job, "nodes/终稿.md", "# 终稿\n\n正文")

    response = client.get(f"/api/jobs/{job.job_id}/artifacts/终稿.md")

    assert response.status_code == 200
    assert "# 终稿" in response.text
    content_disposition = response.headers["content-disposition"]
    assert 'filename="download.md"' in content_disposition
    assert "filename*=UTF-8''%E7%BB%88%E7%A8%BF.md" in content_disposition


def test_missing_job_returns_404(client: TestClient) -> None:
    response = client.get("/api/jobs/missing")

    assert response.status_code == 404
    assert response.json()["detail"] == "Job not found"
