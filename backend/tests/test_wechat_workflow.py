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


def _workflow(tmp_path) -> WeChatWritingWorkflow:
    return WeChatWritingWorkflow(
        store=JobStore(tmp_path / "jobs", retention_days=7),
        events=EventBroker(),
        deepseek=DeepSeekClient(api_key="", base_url="https://example.invalid", model="mock", use_mock=True),
        docx_exporter=DocxExporter(),
    )


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


def test_wechat_angle_prompt_extracts_reference_article_plan(tmp_path) -> None:
    workflow = _workflow(tmp_path)

    prompt = workflow._angle_prompt({"source_text": "论文材料"})

    assert "目标读者" in prompt
    assert "核心主张" in prompt
    assert "必须出现的数据、公式或图表" in prompt
    assert "PART结构" in prompt
    assert "不确定信息" in prompt


def test_wechat_draft_prompt_uses_reference_public_account_structure(tmp_path) -> None:
    workflow = _workflow(tmp_path)

    prompt = workflow._draft_prompt({"source_text": "论文材料"}, "写作角度")

    assert "PART01 研究背景" in prompt
    assert "PART02 核心发现" in prompt
    assert "PART03 进一步讨论" in prompt
    assert "PART04 研究框架与方法" in prompt
    assert "PART05 核心数据" in prompt
    assert "4个主要结论" in prompt
    assert "◆" in prompt
    assert "图表" in prompt
    assert "公式" in prompt
    assert "引用格式" in prompt
    assert "结语" in prompt


def test_wechat_final_prompt_preserves_structure_without_new_claims(tmp_path) -> None:
    workflow = _workflow(tmp_path)

    prompt = workflow._final_prompt("公众号初稿")

    assert "保留 PART01-PART05" in prompt
    assert "不得新增材料外事实" in prompt
    assert "删除提示词痕迹" in prompt
