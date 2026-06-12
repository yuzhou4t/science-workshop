import json

import pytest

from app.models.job import JobStatus, WorkflowType
from app.services.docx_exporter import DocxExporter
from app.storage.job_store import JobStore
from app.workflows.events import EventBroker
from app.workflows.issue_toc_export import IssueTocExportWorkflow, render_issue_toc_markdown


SAMPLE_ISSUE = {
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
        },
        {
            "section": "新文推介",
            "title": "中国黑碳污染暴露风险的时空分异特征及驱动机制",
            "authors": "李若熙，方凤满，林跃胜",
            "abstract": "系统评估大气BC暴露的归因健康负担及其驱动机制。",
            "keywords": "大气黑碳（BC）；健康负担；县域尺度",
        },
    ],
}


def test_render_issue_toc_markdown_uses_public_account_catalog_shape() -> None:
    markdown = render_issue_toc_markdown(SAMPLE_ISSUE)

    assert "《地理研究》2026年45卷第5期最新刊出研究论文17篇" in markdown
    assert "包括“气候演化与环境健康”“城市地理”“人口高质量发展”和“旅游地理”4个栏目" in markdown
    assert "全文已在知网上线，目次及论文摘要附上以飨读者。" in markdown
    assert "## 目次" in markdown
    assert "## 新文推介" in markdown
    assert "1. 4.2 ka BP气候恶化事件对汾河流域史前遗址时空分布的影响及其社会响应" in markdown
    assert "摘要：基于ArcGIS软件运用核密度估计与最近邻指数等方法" in markdown
    assert "关键词：汾河流域；史前遗址；4.2 ka BP气候恶化事件" in markdown


def test_render_issue_toc_markdown_accepts_crawled_issue_articles_without_abstracts() -> None:
    markdown = render_issue_toc_markdown(
        {
            "journal_name": "管理科学学报",
            "issue_label": "2026年5月",
            "articles": [
                {
                    "section": "本期目录",
                    "title": "地方政府显性环境目标约束与企业绿色发展",
                    "authors": "蔡贵龙, 张亚楠, 卢锐, 柳建华",
                },
                {
                    "section": "本期目录",
                    "title": "价格调控对碳市场效率和稳定性的影响研究",
                    "authors": "黄丽清, 朱帮助, 王平, 江民星",
                },
            ],
        }
    )

    assert "《管理科学学报》2026年5月最新刊出研究论文2篇" in markdown
    assert "## 目次" in markdown
    assert "1. 地方政府显性环境目标约束与企业绿色发展" in markdown
    assert "蔡贵龙, 张亚楠, 卢锐, 柳建华" in markdown
    assert "摘要：" not in markdown
    assert "关键词：" not in markdown


@pytest.mark.asyncio
async def test_issue_toc_export_workflow_creates_markdown_and_docx(tmp_path) -> None:
    store = JobStore(tmp_path / "jobs", retention_days=7)
    job = store.create_job(WorkflowType.ISSUE_TOC_EXPORT, template_id="issue-toc")
    store.write_text_artifact(
        job,
        "input/issue_toc.json",
        json.dumps(SAMPLE_ISSUE, ensure_ascii=False),
        media_type="application/json",
    )
    workflow = IssueTocExportWorkflow(store=store, events=EventBroker(), docx_exporter=DocxExporter())

    completed = await workflow.run(job.job_id)

    job_dir = store.job_dir(job.job_id)
    assert completed.status == JobStatus.COMPLETED
    assert (job_dir / "nodes" / "final.md").exists()
    assert (job_dir / "exports" / "final.docx").exists()
    assert "final.md" in completed.artifacts
    assert "final.docx" in completed.artifacts
