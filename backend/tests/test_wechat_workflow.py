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
    assert "PART02 发展现状" in prompt
    assert "PART03 进一步研究" in prompt
    assert "PART04 结论与建议" in prompt
    assert "01、02、03" in prompt
    assert "图表" in prompt
    assert "公式" in prompt
    assert "LaTeX" in prompt
    assert "$$" in prompt
    assert "引用格式" in prompt
    assert "结语" in prompt


def test_wechat_draft_prompt_matches_africa_public_account_sample_format(tmp_path) -> None:
    workflow = _workflow(tmp_path)

    prompt = workflow._draft_prompt({"source_text": "报告材料"}, "写作角度")

    assert "【研读非洲｜第X期】" in prompt
    assert "单独一行写“图片”" in prompt
    assert "PART01" in prompt
    assert "研究背景" in prompt
    assert "PART02" in prompt
    assert "发展现状" in prompt
    assert "01" in prompt
    assert "PART03" in prompt
    assert "进一步研究" in prompt
    assert "PART04" in prompt
    assert "结论与建议" in prompt
    assert "引用格式:" in prompt
    assert "数智非洲聚焦大数据、人工智能与非洲研究的有机结合" in prompt


def test_wechat_draft_prompt_rejects_template_placeholders(tmp_path) -> None:
    workflow = _workflow(tmp_path)

    prompt = workflow._draft_prompt({"source_text": "报告材料"}, "写作角度")

    assert "不得输出方括号占位" in prompt
    assert "不要单独输出“导语”" in prompt
    assert "每个 PART 标题、图片占位和分节标题都必须单独成行" in prompt
    assert "不能把示例说明写进正文" in prompt


def test_wechat_final_prompt_preserves_structure_without_new_claims(tmp_path) -> None:
    workflow = _workflow(tmp_path)

    prompt = workflow._final_prompt("公众号初稿")

    assert "保留【研读非洲｜第X期】标题" in prompt
    assert "PART01-PART04" in prompt
    assert "不得新增材料外事实" in prompt
    assert "删除提示词痕迹" in prompt
    assert "保留 LaTeX 公式块" in prompt


def test_wechat_final_prompt_removes_template_placeholders(tmp_path) -> None:
    workflow = _workflow(tmp_path)

    prompt = workflow._final_prompt("公众号初稿")

    assert "删除方括号占位" in prompt
    assert "删除“请根据实际填入”" in prompt
    assert "不要输出未完成模板" in prompt
