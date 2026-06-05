import pytest
from fastapi.testclient import TestClient

from app.core.config import reset_settings_cache
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


def test_docx_export_creates_downloadable_docx_artifact(client: TestClient) -> None:
    store = client.app.state.job_store
    job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading")
    store.write_text_artifact(job, "nodes/final.md", "# 主标题\n\n正文")

    response = client.post(f"/api/jobs/{job.job_id}/export/docx")

    assert response.status_code == 200
    assert response.json() == {"artifact": "final.docx"}

    artifact_response = client.get(f"/api/jobs/{job.job_id}/artifacts/final.docx")

    assert artifact_response.status_code == 200
    assert artifact_response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    assert artifact_response.content.startswith(b"PK")


def test_missing_job_returns_404(client: TestClient) -> None:
    response = client.get("/api/jobs/missing")

    assert response.status_code == 404
    assert response.json()["detail"] == "Job not found"


def test_create_paper_reading_job_uploads_pdf(client: TestClient) -> None:
    response = client.post(
        "/api/workflows/paper-reading/jobs",
        data={"template_id": "africa-reading"},
        files={"file": ("paper.pdf", b"%PDF-1.4 mock", "application/pdf")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["workflow_type"] == "paper_reading"
    assert body["status"] in {"queued", "running", "completed"}
    assert body["job_id"]
    assert body["artifacts"]["input.pdf"] == {
        "name": "input.pdf",
        "relative_path": "input/input.pdf",
        "media_type": "application/pdf",
    }


@pytest.mark.parametrize(
    ("filename", "content", "content_type"),
    [
        ("paper.txt", b"%PDF-1.4 mock", "application/pdf"),
        ("paper.pdf", b"%PDF-1.4 mock", "text/plain"),
        ("paper.pdf", b"not a pdf", "application/pdf"),
    ],
)
def test_create_paper_reading_job_rejects_non_pdf_upload(
    client: TestClient,
    filename: str,
    content: bytes,
    content_type: str,
) -> None:
    response = client.post(
        "/api/workflows/paper-reading/jobs",
        data={"template_id": "africa-reading"},
        files={"file": (filename, content, content_type)},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "PDF upload required"
    assert not list(client.app.state.job_store.root.glob("*/job.json"))


def test_create_paper_reading_job_rejects_oversized_upload(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("WORKFLOW_STORAGE_DIR", str(tmp_path / "workflow_jobs"))
    monkeypatch.setenv("WORKFLOW_RETENTION_DAYS", "7")
    monkeypatch.setenv("WORKFLOW_USE_MOCKS", "true")
    monkeypatch.setenv("PAPER_READING_MAX_UPLOAD_BYTES", "12")
    reset_settings_cache()
    from app.main import create_app

    try:
        with TestClient(create_app()) as limited_client:
            response = limited_client.post(
                "/api/workflows/paper-reading/jobs",
                data={"template_id": "africa-reading"},
                files={"file": ("paper.pdf", b"%PDF-1.4 mock", "application/pdf")},
            )

            assert response.status_code == 413
            assert response.json()["detail"] == "PDF upload is too large"
            assert not list(limited_client.app.state.job_store.root.glob("*/job.json"))
    finally:
        reset_settings_cache()
