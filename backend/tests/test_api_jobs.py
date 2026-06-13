import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
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


def test_create_paper_reading_job_accepts_chunked_pdf_upload(client: TestClient) -> None:
    pdf_bytes = b"%PDF-1.4 first chunk second chunk"
    init_response = client.post(
        "/api/workflows/paper-reading/file-uploads",
        json={
            "filename": "paper.pdf",
            "media_type": "application/pdf",
            "size_bytes": len(pdf_bytes),
            "total_chunks": 2,
        },
    )
    assert init_response.status_code == 200
    upload_id = init_response.json()["upload_id"]

    chunk_1 = client.put(
        f"/api/workflows/paper-reading/file-uploads/{upload_id}/chunks/0",
        content=pdf_bytes[:14],
    )
    chunk_2 = client.put(
        f"/api/workflows/paper-reading/file-uploads/{upload_id}/chunks/1",
        content=pdf_bytes[14:],
    )

    assert chunk_1.status_code == 200
    assert chunk_2.status_code == 200
    assert chunk_2.json()["complete"] is True

    response = client.post(
        "/api/workflows/paper-reading/jobs",
        data={"template_id": "africa-reading", "file_upload_id": upload_id},
    )

    assert response.status_code == 200
    body = response.json()
    store = client.app.state.job_store
    assert body["workflow_type"] == "paper_reading"
    assert body["artifacts"]["input.pdf"]["relative_path"] == "input/input.pdf"
    assert (store.job_dir(body["job_id"]) / "input" / "input.pdf").read_bytes() == pdf_bytes
    assert not (store.root / "_uploads" / "paper-reading" / upload_id).exists()


def test_create_paper_reading_job_accepts_cos_pdf_object_key(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api import paper_reading

    async def copy_cos_pdf_to_temp(request, cos_object_key, storage_dir, max_bytes):
        assert cos_object_key == "papers/existing.pdf"
        temp_path = storage_dir / "_uploads" / "cos-existing.pdf"
        temp_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path.write_bytes(b"%PDF-1.4 existing cos pdf")
        return temp_path

    monkeypatch.setattr(
        paper_reading,
        "_copy_cos_pdf_to_temp",
        copy_cos_pdf_to_temp,
        raising=False,
    )

    response = client.post(
        "/api/workflows/paper-reading/jobs",
        data={"template_id": "africa-reading", "cos_object_key": "papers/existing.pdf"},
    )

    assert response.status_code == 200
    body = response.json()
    store = client.app.state.job_store
    assert body["workflow_type"] == "paper_reading"
    assert body["artifacts"]["input.pdf"]["relative_path"] == "input/input.pdf"
    assert (store.job_dir(body["job_id"]) / "input" / "input.pdf").read_bytes() == b"%PDF-1.4 existing cos pdf"


def test_cos_pdf_reference_accepts_configured_bucket_url() -> None:
    from app.api.paper_reading import _cos_object_key_from_reference

    settings = SimpleNamespace(tencent_cos_bucket="bucket-123", tencent_cos_region="ap-guangzhou")

    object_key = _cos_object_key_from_reference(
        "https://bucket-123.cos.ap-guangzhou.myqcloud.com/papers/existing.pdf?sign=abc",
        settings,
    )

    assert object_key == "papers/existing.pdf"


def test_cos_pdf_reference_rejects_external_url() -> None:
    from app.api.paper_reading import _cos_object_key_from_reference

    settings = SimpleNamespace(tencent_cos_bucket="bucket-123", tencent_cos_region="ap-guangzhou")

    with pytest.raises(HTTPException):
        _cos_object_key_from_reference("https://example.com/papers/existing.pdf", settings)


def test_create_wechat_writing_job_with_source_text_completes_in_mock_mode(client: TestClient) -> None:
    response = client.post(
        "/api/workflows/wechat-writing/jobs",
        data={
            "source_text": "论文精读材料正文",
            "article_id": "article-1",
            "template_id": "africa-reading",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["workflow_type"] == "wechat_writing"
    assert body["status"] == "completed"
    assert body["job_id"]
    assert body["artifacts"]["source_bundle.json"]["relative_path"] == "input/source_bundle.json"


def test_create_issue_toc_export_job_completes_with_structured_issue(client: TestClient) -> None:
    response = client.post(
        "/api/workflows/issue-toc-export/jobs",
        json={
            "journal_name": "地理研究",
            "year": 2026,
            "volume": 45,
            "issue": 5,
            "article_count": 17,
            "columns": ["气候演化与环境健康", "城市地理", "人口高质量发展", "旅游地理"],
            "online_note": "全文已在知网上线",
            "articles": [
                {
                    "section": "新文推介",
                    "title": "4.2 ka BP气候恶化事件对汾河流域史前遗址时空分布的影响及其社会响应",
                    "authors": "张洁琼，田庆春，张仲伍，高江涛",
                    "abstract": "基于ArcGIS软件运用核密度估计与最近邻指数等方法，探究气候事件影响。",
                    "keywords": ["汾河流域", "史前遗址", "4.2 ka BP气候恶化事件"],
                }
            ],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["workflow_type"] == "issue_toc_export"
    assert body["status"] == "completed"
    assert body["artifacts"]["issue_toc.json"]["relative_path"] == "input/issue_toc.json"
    assert body["artifacts"]["final.md"]["relative_path"] == "nodes/final.md"


def test_create_wechat_writing_job_accepts_uploaded_material_file(client: TestClient) -> None:
    response = client.post(
        "/api/workflows/wechat-writing/jobs",
        data={"template_id": "africa-reading"},
        files={"materials": ("补充材料.md", "上传材料正文".encode("utf-8"), "text/markdown")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["workflow_type"] == "wechat_writing"
    assert body["status"] == "completed"

    store = client.app.state.job_store
    source_bundle_path = store.job_dir(body["job_id"]) / "input" / "source_bundle.json"
    source_bundle = json.loads(source_bundle_path.read_text(encoding="utf-8"))
    assert source_bundle["uploaded_materials"][0]["filename"] == "补充材料.md"
    assert source_bundle["uploaded_materials"][0]["content"] == "上传材料正文"
    assert body["artifacts"]["补充材料.md"]["relative_path"] == "input/materials/补充材料.md"


def test_create_wechat_writing_job_accepts_chunked_material_upload(client: TestClient) -> None:
    init_response = client.post(
        "/api/workflows/wechat-writing/material-uploads",
        json={
            "filename": "长材料.md",
            "media_type": "text/markdown",
            "size_bytes": len("第一段材料第二段材料".encode("utf-8")),
            "total_chunks": 2,
        },
    )
    assert init_response.status_code == 200
    upload_id = init_response.json()["upload_id"]

    chunk_1 = client.put(
        f"/api/workflows/wechat-writing/material-uploads/{upload_id}/chunks/0",
        content="第一段材料".encode("utf-8"),
    )
    chunk_2 = client.put(
        f"/api/workflows/wechat-writing/material-uploads/{upload_id}/chunks/1",
        content="第二段材料".encode("utf-8"),
    )

    assert chunk_1.status_code == 200
    assert chunk_2.status_code == 200
    assert chunk_2.json()["complete"] is True

    response = client.post(
        "/api/workflows/wechat-writing/jobs",
        data={
            "template_id": "africa-reading",
            "material_upload_ids": json.dumps([upload_id]),
        },
    )

    assert response.status_code == 200
    body = response.json()
    store = client.app.state.job_store
    source_bundle_path = store.job_dir(body["job_id"]) / "input" / "source_bundle.json"
    source_bundle = json.loads(source_bundle_path.read_text(encoding="utf-8"))
    assert source_bundle["uploaded_materials"][0]["filename"] == "长材料.md"
    assert source_bundle["uploaded_materials"][0]["content"] == "第一段材料第二段材料"
    assert body["artifacts"]["长材料.md"]["relative_path"] == "input/materials/长材料.md"
    assert not (store.root / "_uploads" / "wechat-materials" / upload_id).exists()


def test_create_wechat_writing_job_extracts_uploaded_pdf_material_content(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_extract(path, media_type, chunks):
        assert path.name == "paper.pdf"
        assert media_type == "application/pdf"
        assert chunks == []
        return "PDF 提取出的正文"

    monkeypatch.setattr("app.api.wechat_writing._extract_stored_material_content", fake_extract, raising=False)

    response = client.post(
        "/api/workflows/wechat-writing/jobs",
        data={"template_id": "africa-reading"},
        files={"materials": ("paper.pdf", b"%PDF-1.4 mock", "application/pdf")},
    )

    assert response.status_code == 200
    body = response.json()
    store = client.app.state.job_store
    source_bundle_path = store.job_dir(body["job_id"]) / "input" / "source_bundle.json"
    source_bundle = json.loads(source_bundle_path.read_text(encoding="utf-8"))
    assert source_bundle["uploaded_materials"][0]["filename"] == "paper.pdf"
    assert source_bundle["uploaded_materials"][0]["content"] == "PDF 提取出的正文"


def test_create_wechat_writing_job_can_use_paper_reading_job_evidence_without_source_text(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = client.app.state.job_store
    paper_job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading")
    store.write_text_artifact(paper_job, "nodes/final.md", "# Referenced final\n\nFinal evidence content")
    store.write_text_artifact(paper_job, "nodes/basic_info.md", "Basic evidence content")
    store.write_text_artifact(paper_job, "extraction/extracted.md", "Extracted evidence content")
    captured_prompts: list[tuple[str, str]] = []

    class CapturingDeepSeekClient:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def generate(self, node_id: str, prompt: str) -> str:
            captured_prompts.append((node_id, prompt))
            return f"# {node_id}\n\nCaptured prompt length {len(prompt)}"

    monkeypatch.setattr("app.api.wechat_writing.DeepSeekClient", CapturingDeepSeekClient)

    response = client.post(
        "/api/workflows/wechat-writing/jobs",
        data={"paper_reading_job_id": paper_job.job_id, "template_id": "africa-reading"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["workflow_type"] == "wechat_writing"
    assert body["status"] == "completed"
    source_bundle_path = store.job_dir(body["job_id"]) / "input" / "source_bundle.json"
    source_bundle = json.loads(source_bundle_path.read_text(encoding="utf-8"))
    assert "Final evidence content" in json.dumps(source_bundle, ensure_ascii=False)
    assert "Extracted evidence content" in json.dumps(source_bundle, ensure_ascii=False)
    assert any("Final evidence content" in prompt for _node_id, prompt in captured_prompts)


def test_create_wechat_writing_job_rejects_missing_paper_reading_job(client: TestClient) -> None:
    response = client.post(
        "/api/workflows/wechat-writing/jobs",
        data={"paper_reading_job_id": "missing"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Referenced paper-reading job not found"


def test_create_wechat_writing_job_rejects_empty_source(client: TestClient) -> None:
    response = client.post("/api/workflows/wechat-writing/jobs", data={})

    assert response.status_code == 400
    assert response.json()["detail"] == "source_text, paper_reading_job_id with evidence, or uploaded materials are required"


def test_patch_job_node_updates_safe_artifact_and_returns_rerun_plan(client: TestClient) -> None:
    store = client.app.state.job_store
    job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading")

    response = client.patch(
        f"/api/jobs/{job.job_id}/nodes/formula_metrics",
        json={"content": "# revised metrics"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "job_id": job.job_id,
        "node_id": "formula_metrics",
        "rerun_required": ["draft", "final", "docx_export"],
    }
    assert (store.job_dir(job.job_id) / "nodes" / "formula_metrics.md").read_text(encoding="utf-8") == "# revised metrics"
    reloaded = store.load_job(job.job_id)
    assert reloaded.nodes["formula_metrics"].output_artifacts == ["formula_metrics.md"]


@pytest.mark.parametrize("node_id", ["unknown", "..%2Fescape"])
def test_patch_job_node_rejects_invalid_or_unsafe_node_ids(client: TestClient, node_id: str) -> None:
    store = client.app.state.job_store
    job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading")

    response = client.patch(
        f"/api/jobs/{job.job_id}/nodes/{node_id}",
        json={"content": "should not write"},
    )

    assert response.status_code in {400, 404}
    assert not (store.job_dir(job.job_id) / "nodes" / "unknown.md").exists()
    assert not (store.job_dir(job.job_id) / "escape.md").exists()


def test_rerun_returns_downstream_plan_for_valid_node(client: TestClient) -> None:
    store = client.app.state.job_store
    job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading")

    response = client.post(f"/api/jobs/{job.job_id}/rerun", json={"from_node": "formula_metrics"})

    assert response.status_code == 200
    assert response.json() == {
        "job_id": job.job_id,
        "from_node": "formula_metrics",
        "will_rerun": ["draft", "final", "docx_export"],
    }


def test_rerun_rejects_invalid_node(client: TestClient) -> None:
    store = client.app.state.job_store
    job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading")

    response = client.post(f"/api/jobs/{job.job_id}/rerun", json={"from_node": "../final"})

    assert response.status_code == 400


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
