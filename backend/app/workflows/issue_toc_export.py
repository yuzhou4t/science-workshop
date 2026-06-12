import asyncio
import json
from collections import OrderedDict
from typing import Any

from app.models.job import Artifact, JobStatus, NodeStatus, WorkflowJob
from app.services.docx_exporter import DocxExporter
from app.storage.job_store import JobStore
from app.workflows.events import EventBroker


def render_issue_toc_markdown(issue: dict[str, Any]) -> str:
    journal_name = _required_text(issue, "journal_name")
    issue_label = _issue_label(issue)
    articles = _articles(issue)
    article_count = str(issue.get("article_count") or len(articles))
    columns = _text_list(issue.get("columns"))
    online_note = str(issue.get("online_note") or "").strip()

    intro = f"《{journal_name}》{issue_label}最新刊出研究论文{article_count}篇"
    if columns:
        intro += f"，包括{_join_quoted_columns(columns)}{len(columns)}个栏目"
    intro += "。"
    if online_note:
        intro += f"{online_note}，目次及论文摘要附上以飨读者。"
    else:
        intro += "目次及论文摘要附上以飨读者。"

    lines = [f"# 《{journal_name}》{issue_label}目录导出", "", intro, "", "## 目次", ""]
    for section, section_articles in _group_articles_by_section(articles).items():
        lines.append(f"### {section}")
        for index, article in enumerate(section_articles, start=1):
            lines.append(f"{index}. {_required_text(article, 'title')}")
        lines.append("")

    for section, section_articles in _group_articles_by_section(articles).items():
        lines.append(f"## {section}")
        lines.append("")
        for index, article in enumerate(section_articles, start=1):
            lines.extend(_render_article(index, article))
            lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def _required_text(data: dict[str, Any], key: str) -> str:
    value = str(data.get(key, "")).strip()
    if not value:
        raise ValueError(f"{key} is required")
    return value


def _issue_label(issue: dict[str, Any]) -> str:
    label = str(issue.get("issue_label") or "").strip()
    if label:
        return label
    year = _required_text(issue, "year")
    volume = _required_text(issue, "volume")
    issue_no = _required_text(issue, "issue")
    return f"{year}年{volume}卷第{issue_no}期"


def _articles(issue: dict[str, Any]) -> list[dict[str, Any]]:
    value = issue.get("articles")
    if not isinstance(value, list) or not value:
        raise ValueError("articles are required")
    articles = [article for article in value if isinstance(article, dict)]
    if not articles:
        raise ValueError("articles are required")
    return articles


def _text_list(value: Any) -> list[str]:
    if isinstance(value, str):
        return [item.strip() for item in value.replace("、", "；").split("；") if item.strip()]
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def _join_quoted_columns(columns: list[str]) -> str:
    quoted = [f"“{column}”" for column in columns]
    if len(quoted) == 1:
        return quoted[0]
    return "".join(quoted[:-1]) + "和" + quoted[-1]


def _group_articles_by_section(articles: list[dict[str, Any]]) -> OrderedDict[str, list[dict[str, Any]]]:
    groups: OrderedDict[str, list[dict[str, Any]]] = OrderedDict()
    for article in articles:
        section = str(article.get("section") or "新文推介").strip()
        groups.setdefault(section, []).append(article)
    return groups


def _render_article(index: int, article: dict[str, Any]) -> list[str]:
    lines = [f"### {index}", "", f"#### {_required_text(article, 'title')}"]
    authors = str(article.get("authors") or "").strip()
    abstract = str(article.get("abstract") or "").strip()
    keywords = _text_list(article.get("keywords"))
    if authors:
        lines.extend(["", authors])
    if abstract:
        lines.extend(["", f"摘要：{abstract}"])
    if keywords:
        lines.extend(["", f"关键词：{'；'.join(keywords)}"])
    return lines


class IssueTocExportWorkflow:
    def __init__(
        self,
        store: JobStore,
        events: EventBroker,
        docx_exporter: DocxExporter,
    ) -> None:
        self.store = store
        self.events = events
        self.docx_exporter = docx_exporter

    async def run(self, job_id: str) -> WorkflowJob:
        job = self.store.load_job(job_id)
        job.status = JobStatus.RUNNING
        self.store.save_job(job)

        try:
            await self.events.publish(job.job_id, "progress", "catalog_render", "期刊目录正在整理", 35, {})
            final_markdown = render_issue_toc_markdown(self._read_issue(job))
            self.store.write_text_artifact(job, "nodes/final.md", final_markdown)
            self.store.set_node_status(job, "catalog_render", NodeStatus.COMPLETED, ["final.md"], progress=70)
            self._export_docx(job, final_markdown)
            job.status = JobStatus.COMPLETED
            self.store.save_job(job)
            await self.events.publish(job.job_id, "completed", "workflow", "期刊目录导出完成", 100, {})
            return job
        except asyncio.CancelledError:
            job.status = JobStatus.FAILED
            self.store.save_job(job)
            await self.events.publish(job.job_id, "failed", "workflow", "Workflow cancelled", 100, {})
            raise
        except Exception as exc:
            job.status = JobStatus.FAILED
            self.store.save_job(job)
            await self.events.publish(job.job_id, "failed", "workflow", str(exc), 100, {})
            raise

    def _read_issue(self, job: WorkflowJob) -> dict[str, Any]:
        path = self.store.job_dir(job.job_id) / "input" / "issue_toc.json"
        return json.loads(path.read_text(encoding="utf-8"))

    def _export_docx(self, job: WorkflowJob, final_markdown: str) -> None:
        self.store.set_node_status(job, "docx_export", NodeStatus.RUNNING, message="Word 正在导出", progress=90)
        try:
            output_path = self.store.job_dir(job.job_id) / "exports" / "final.docx"
            self.docx_exporter.export_markdown(final_markdown, output_path)
            job.artifacts["final.docx"] = Artifact(
                name="final.docx",
                relative_path="exports/final.docx",
                media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
            self.store.set_node_status(job, "docx_export", NodeStatus.COMPLETED, ["final.docx"], progress=100)
        except Exception as exc:
            self.store.set_node_status(job, "docx_export", NodeStatus.FAILED, error=str(exc))
            raise
