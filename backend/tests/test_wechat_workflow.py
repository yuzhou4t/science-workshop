import asyncio
import json

import pytest

from app.models.job import JobStatus, NodeStatus, WorkflowType
from app.services.deepseek_client import DeepSeekClient
from app.services.docx_exporter import DocxExporter
from app.storage.job_store import JobStore
from app.workflows.events import EventBroker
from app.workflows.wechat_writing import WeChatWritingWorkflow


class CancellingDeepSeekClient:
    async def generate(self, node_id: str, prompt: str) -> str:
        raise asyncio.CancelledError()


@pytest.mark.asyncio
async def test_mock_wechat_workflow_creates_article_artifacts(tmp_path) -> None:
    store = JobStore(tmp_path / "jobs", retention_days=7)
    job = store.create_job(WorkflowType.WECHAT_WRITING, template_id="africa-reading")
    store.write_text_artifact(
        job,
        "input/source_bundle.json",
        json.dumps({"source_text": "这是一篇论文精读材料。"}, ensure_ascii=False),
        media_type="application/json",
    )
    workflow = WeChatWritingWorkflow(
        store=store,
        events=EventBroker(),
        deepseek=DeepSeekClient(api_key="", base_url="https://example.invalid", model="mock", use_mock=True),
        docx_exporter=DocxExporter(),
    )

    completed = await workflow.run(job.job_id)

    job_dir = store.job_dir(job.job_id)
    assert completed.status == JobStatus.COMPLETED
    assert (job_dir / "nodes" / "angle.md").exists()
    assert (job_dir / "nodes" / "article_final.md").exists()
    assert (job_dir / "nodes" / "final.md").exists()
    assert (job_dir / "exports" / "final.docx").exists()


@pytest.mark.asyncio
async def test_wechat_workflow_marks_cancelled_node_failed(tmp_path) -> None:
    store = JobStore(tmp_path / "jobs", retention_days=7)
    job = store.create_job(WorkflowType.WECHAT_WRITING, template_id="africa-reading")
    store.write_text_artifact(
        job,
        "input/source_bundle.json",
        json.dumps({"source_text": "会触发取消的材料。"}, ensure_ascii=False),
        media_type="application/json",
    )
    workflow = WeChatWritingWorkflow(
        store=store,
        events=EventBroker(),
        deepseek=CancellingDeepSeekClient(),
        docx_exporter=DocxExporter(),
    )

    with pytest.raises(asyncio.CancelledError):
        await workflow.run(job.job_id)

    reloaded = store.load_job(job.job_id)
    assert reloaded.status == JobStatus.FAILED
    assert reloaded.nodes["angle"].status == NodeStatus.FAILED
    assert "cancelled" in reloaded.nodes["angle"].error.lower()
