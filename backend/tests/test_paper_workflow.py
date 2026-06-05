import zipfile

import httpx
import pytest

from app.models.job import JobStatus, NodeStatus, WorkflowType
from app.services.deepseek_client import DeepSeekClient, _extract_message_content
from app.services.docx_exporter import DocxExporter
from app.services.mineru_client import MineruClient, MineruResult, _extract_mineru_zip, _extract_progress_message, _extract_task_id
from app.storage.job_store import JobStore
from app.workflows.events import EventBroker
from app.workflows.paper_reading import PaperReadingWorkflow


class FailingDeepSeekClient:
    def __init__(self, failed_node_id: str, message: str) -> None:
        self.failed_node_id = failed_node_id
        self.message = message

    async def generate(self, node_id: str, prompt: str) -> str:
        if node_id == self.failed_node_id:
            raise RuntimeError(self.message)
        return f"# {node_id}\n\nMock output for prompt length {len(prompt)}."


class FailingMineruClient:
    async def parse_pdf_to_markdown(self, pdf_path, progress_callback=None) -> None:
        raise RuntimeError("mineru boom")


class ProgressMineruClient:
    async def parse_pdf_to_markdown(self, pdf_path, progress_callback=None) -> MineruResult:
        if progress_callback is not None:
            await progress_callback(
                "document_extraction",
                57.5,
                "MinerU 正在解析第 8/23 页",
                {"extracted_pages": 8, "total_pages": 23},
            )
        return MineruResult(markdown="# Extracted\n\nGrounded content.", assets=[])


class FallbackUploadMineruClient(MineruClient):
    def __init__(self) -> None:
        super().__init__(api_key="key", base_url="https://mineru.example.test")
        self.task_url = ""
        self.used_fallback_upload = False

    async def _upload_to_cos(self, pdf_path):
        raise RuntimeError("cos upload timed out")

    async def _upload_to_mineru_file(self, pdf_path):
        self.used_fallback_upload = True
        from app.services.mineru_client import CosUpload

        return CosUpload(file_url="https://mineru.example.test/uploaded.pdf", object_key="")

    async def _create_task(self, file_url: str) -> str:
        self.task_url = file_url
        return "task-1"

    async def _wait_for_completion(self, task_id: str, progress_callback=None, max_wait: int = 300) -> str:
        return "https://mineru.example.test/result.zip"

    async def _download_and_extract(self, zip_url: str, asset_dir) -> MineruResult:
        return MineruResult(markdown="# Extracted by fallback upload", assets=[])


class CapturingDeepSeekClient:
    def __init__(self) -> None:
        self.prompts: dict[str, str] = {}

    async def generate(self, node_id: str, prompt: str) -> str:
        self.prompts[node_id] = prompt
        return f"# {node_id}\n\nGrounded output."


class RecordingEvents:
    def __init__(self) -> None:
        self.items = []

    async def publish(self, job_id: str, event: str, node_id: str, message: str, progress: float, data=None):
        self.items.append(
            {
                "job_id": job_id,
                "event": event,
                "node_id": node_id,
                "message": message,
                "progress": progress,
                "data": data or {},
            }
        )


@pytest.mark.asyncio
async def test_mock_mineru_returns_markdown(tmp_path) -> None:
    pdf = tmp_path / "paper.pdf"
    pdf.write_bytes(b"%PDF-1.4 mock")
    client = MineruClient(use_mock=True)

    result = await client.parse_pdf_to_markdown(pdf)

    assert "# Mock Extracted Paper" in result.markdown
    assert result.assets == []


@pytest.mark.asyncio
async def test_mock_deepseek_returns_node_text() -> None:
    client = DeepSeekClient(api_key="", base_url="https://example.invalid", model="mock", use_mock=True)

    result = await client.generate("basic_info", "Extract basic info")

    assert result.startswith("# basic_info")


def test_deepseek_malformed_response_raises_runtime_error() -> None:
    with pytest.raises(RuntimeError, match="DeepSeek response missing message content"):
        _extract_message_content({"choices": []})


@pytest.mark.asyncio
async def test_deepseek_retries_transient_connection_errors(monkeypatch) -> None:
    class FlakyAsyncClient:
        calls = 0

        def __init__(self, timeout: float) -> None:
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback) -> None:
            return None

        async def post(self, url, headers, json):
            FlakyAsyncClient.calls += 1
            request = httpx.Request("POST", url)
            if FlakyAsyncClient.calls == 1:
                raise httpx.ConnectError("", request=request)
            return httpx.Response(
                200,
                json={"choices": [{"message": {"content": "retry ok"}}]},
                request=request,
            )

    monkeypatch.setattr("app.services.deepseek_client.httpx.AsyncClient", FlakyAsyncClient)
    monkeypatch.setattr("app.services.deepseek_client.DEEPSEEK_RETRY_DELAY_SECONDS", 0, raising=False)
    client = DeepSeekClient(api_key="key", base_url="https://api.example.test", model="deepseek")

    result = await client.generate("draft", "test")

    assert result == "retry ok"
    assert FlakyAsyncClient.calls == 2


@pytest.mark.asyncio
async def test_deepseek_connection_errors_are_readable(monkeypatch) -> None:
    class FailingAsyncClient:
        def __init__(self, timeout: float) -> None:
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback) -> None:
            return None

        async def post(self, url, headers, json):
            request = httpx.Request("POST", url)
            raise httpx.ConnectError("", request=request)

    monkeypatch.setattr("app.services.deepseek_client.httpx.AsyncClient", FailingAsyncClient)
    monkeypatch.setattr("app.services.deepseek_client.DEEPSEEK_RETRY_DELAY_SECONDS", 0, raising=False)
    client = DeepSeekClient(api_key="key", base_url="https://api.example.test", model="deepseek")

    with pytest.raises(RuntimeError, match="DeepSeek request failed: ConnectError"):
        await client.generate("draft", "test")


def test_mineru_task_creation_missing_task_id_raises_runtime_error() -> None:
    with pytest.raises(RuntimeError, match="MinerU task response missing task_id"):
        _extract_task_id({"code": 0, "data": {}})


def test_mineru_extract_progress_message_reports_page_count() -> None:
    progress = _extract_progress_message(
        {
            "code": 0,
            "data": {
                "state": "running",
                "extract_progress": {"extracted_pages": 8, "total_pages": 23},
            },
        }
    )

    assert progress == (
        50.7,
        "MinerU 正在解析第 8/23 页",
        {"extracted_pages": 8, "total_pages": 23},
    )


@pytest.mark.asyncio
async def test_mineru_create_task_retries_transient_connection_errors(monkeypatch) -> None:
    class FlakyAsyncClient:
        calls = 0

        def __init__(self, timeout: float) -> None:
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback) -> None:
            return None

        async def post(self, url, headers, json):
            FlakyAsyncClient.calls += 1
            request = httpx.Request("POST", url)
            if FlakyAsyncClient.calls == 1:
                raise httpx.ConnectError("", request=request)
            return httpx.Response(200, json={"code": 0, "data": {"task_id": "task-1"}}, request=request)

    monkeypatch.setattr("app.services.mineru_client.httpx.AsyncClient", FlakyAsyncClient)
    monkeypatch.setattr("app.services.mineru_client.MINERU_RETRY_DELAY_SECONDS", 0, raising=False)
    client = MineruClient(api_key="key", base_url="https://mineru.example.test")

    task_id = await client._create_task("https://cos.example.test/paper.pdf")

    assert task_id == "task-1"
    assert FlakyAsyncClient.calls == 2


@pytest.mark.asyncio
async def test_mineru_connection_errors_are_readable(monkeypatch) -> None:
    class FailingAsyncClient:
        def __init__(self, timeout: float) -> None:
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback) -> None:
            return None

        async def post(self, url, headers, json):
            request = httpx.Request("POST", url)
            raise httpx.ConnectError("", request=request)

    monkeypatch.setattr("app.services.mineru_client.httpx.AsyncClient", FailingAsyncClient)
    monkeypatch.setattr("app.services.mineru_client.MINERU_RETRY_DELAY_SECONDS", 0, raising=False)
    client = MineruClient(api_key="key", base_url="https://mineru.example.test")

    with pytest.raises(RuntimeError, match="MinerU request failed: ConnectError"):
        await client._create_task("https://cos.example.test/paper.pdf")


@pytest.mark.parametrize("body", [None, []])
def test_mineru_task_creation_non_object_response_raises_runtime_error(body) -> None:
    with pytest.raises(RuntimeError, match="MinerU task response missing task_id"):
        _extract_task_id(body)


def test_mineru_done_response_missing_result_url_raises_runtime_error() -> None:
    from app.services.mineru_client import _parse_task_state

    with pytest.raises(RuntimeError, match="MinerU task response missing result URL"):
        _parse_task_state({"code": 0, "data": {"state": "done"}})


def test_mineru_zip_extraction_rejects_too_many_files_without_writing(tmp_path) -> None:
    zip_path = tmp_path / "too_many.zip"
    with zipfile.ZipFile(zip_path, "w") as archive:
        archive.writestr("one.md", "1")
        archive.writestr("two.md", "2")
        archive.writestr("three.md", "3")

    extract_dir = tmp_path / "extracted"
    with pytest.raises(RuntimeError, match="MinerU zip contains too many files"):
        _extract_mineru_zip(zip_path, extract_dir, max_files=2, max_uncompressed_bytes=1024)

    assert not any(extract_dir.rglob("*"))


def test_mineru_zip_extraction_rejects_too_large_total_without_writing(tmp_path) -> None:
    zip_path = tmp_path / "too_large.zip"
    with zipfile.ZipFile(zip_path, "w") as archive:
        archive.writestr("paper.md", "x" * 12)

    extract_dir = tmp_path / "extracted"
    with pytest.raises(RuntimeError, match="MinerU zip is too large"):
        _extract_mineru_zip(zip_path, extract_dir, max_files=10, max_uncompressed_bytes=10)

    assert not any(extract_dir.rglob("*"))


def test_mineru_zip_extraction_rejects_traversal_without_writing(tmp_path) -> None:
    zip_path = tmp_path / "traversal.zip"
    with zipfile.ZipFile(zip_path, "w") as archive:
        archive.writestr("../escape.md", "nope")

    extract_dir = tmp_path / "extracted"
    with pytest.raises(RuntimeError, match="MinerU zip contains unsafe path"):
        _extract_mineru_zip(zip_path, extract_dir, max_files=10, max_uncompressed_bytes=1024)

    assert not (tmp_path / "escape.md").exists()
    assert not any(extract_dir.rglob("*"))


def test_mineru_zip_extraction_allows_safe_directory_entries(tmp_path) -> None:
    zip_path = tmp_path / "with_directory.zip"
    with zipfile.ZipFile(zip_path, "w") as archive:
        archive.writestr("images/", "")
        archive.writestr("images/fig.png", b"image bytes")

    extract_dir = tmp_path / "extracted"
    _extract_mineru_zip(zip_path, extract_dir, max_files=10, max_uncompressed_bytes=1024)

    assert (extract_dir / "images" / "fig.png").read_bytes() == b"image bytes"


def test_mineru_cos_object_key_does_not_include_original_filename(tmp_path) -> None:
    pdf = tmp_path / "Sensitive Paper 2026.pdf"

    object_key = MineruClient()._cos_object_key(pdf)

    assert object_key.startswith("mineru/")
    assert object_key.endswith(".pdf")
    assert pdf.name not in object_key
    assert "Sensitive" not in object_key


@pytest.mark.asyncio
async def test_mineru_cos_upload_retries_transient_errors(tmp_path, monkeypatch) -> None:
    pdf = tmp_path / "paper.pdf"
    pdf.write_bytes(b"%PDF-1.4 mock")

    class FlakyCosClient:
        def __init__(self) -> None:
            self.put_calls = 0

        def put_object(self, **kwargs):
            self.put_calls += 1
            if self.put_calls == 1:
                raise RuntimeError("write operation timed out")
            return {"ETag": "ok"}

        def get_presigned_url(self, **kwargs):
            return "https://cos.example.test/paper.pdf"

    cos_client = FlakyCosClient()
    monkeypatch.setattr("app.services.mineru_client.COS_UPLOAD_RETRY_DELAY_SECONDS", 0, raising=False)
    client = MineruClient(
        cos_secret_id="secret-id",
        cos_secret_key="secret-key",
        cos_bucket="bucket-123",
    )
    monkeypatch.setattr(client, "_cos_client", lambda: cos_client)

    upload = await client._upload_to_cos(pdf)

    assert upload.file_url == "https://cos.example.test/paper.pdf"
    assert cos_client.put_calls == 2


@pytest.mark.asyncio
async def test_mineru_parse_falls_back_to_builtin_upload_when_cos_fails(tmp_path) -> None:
    pdf = tmp_path / "paper.pdf"
    pdf.write_bytes(b"%PDF-1.4 mock")
    client = FallbackUploadMineruClient()

    result = await client.parse_pdf_to_markdown(pdf)

    assert result.markdown == "# Extracted by fallback upload"
    assert client.used_fallback_upload is True
    assert client.task_url == "https://mineru.example.test/uploaded.pdf"


@pytest.mark.asyncio
async def test_paper_workflow_creates_evidence_chain(tmp_path) -> None:
    store = JobStore(tmp_path / "jobs", retention_days=7)
    job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading")
    pdf_path = store.job_dir(job.job_id) / "input" / "input.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 mock")

    workflow = PaperReadingWorkflow(
        store=store,
        events=EventBroker(),
        mineru=MineruClient(use_mock=True),
        deepseek=DeepSeekClient(api_key="", base_url="https://example.invalid", model="mock", use_mock=True),
        docx_exporter=DocxExporter(),
    )

    completed = await workflow.run(job.job_id, pdf_path)

    assert completed.status == JobStatus.COMPLETED
    assert (store.job_dir(job.job_id) / "extraction" / "extracted.md").exists()
    assert (store.job_dir(job.job_id) / "nodes" / "basic_info.md").exists()
    assert (store.job_dir(job.job_id) / "nodes" / "basic_info.json").exists()
    assert (store.job_dir(job.job_id) / "nodes" / "method_data_figures.md").exists()
    assert (store.job_dir(job.job_id) / "nodes" / "method_data_figures.json").exists()
    assert (store.job_dir(job.job_id) / "nodes" / "formula_metrics.md").exists()
    assert (store.job_dir(job.job_id) / "nodes" / "formula_metrics.json").exists()
    assert (store.job_dir(job.job_id) / "nodes" / "draft.md").exists()
    assert (store.job_dir(job.job_id) / "nodes" / "final.md").exists()
    assert (store.job_dir(job.job_id) / "exports" / "final.docx").exists()


@pytest.mark.asyncio
async def test_paper_workflow_publishes_mineru_page_progress(tmp_path) -> None:
    store = JobStore(tmp_path / "jobs", retention_days=7)
    job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading")
    pdf_path = store.job_dir(job.job_id) / "input" / "input.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 mock")
    events = RecordingEvents()
    workflow = PaperReadingWorkflow(
        store=store,
        events=events,
        mineru=ProgressMineruClient(),
        deepseek=DeepSeekClient(api_key="", base_url="https://example.invalid", model="mock", use_mock=True),
        docx_exporter=DocxExporter(),
    )

    await workflow.run(job.job_id, pdf_path)

    reloaded = store.load_job(job.job_id)
    document_node = reloaded.nodes["document_extraction"]
    assert document_node.message == "MinerU 提取完成"
    assert document_node.progress == 25
    assert any(
        item["node_id"] == "document_extraction"
        and item["message"] == "MinerU 正在解析第 8/23 页"
        and item["data"] == {"extracted_pages": 8, "total_pages": 23}
        for item in events.items
    )


@pytest.mark.asyncio
async def test_paper_workflow_draft_prompt_is_source_locked(tmp_path) -> None:
    store = JobStore(tmp_path / "jobs", retention_days=7)
    job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading")
    deepseek = CapturingDeepSeekClient()
    workflow = PaperReadingWorkflow(
        store=store,
        events=EventBroker(),
        mineru=MineruClient(use_mock=True),
        deepseek=deepseek,
        docx_exporter=DocxExporter(),
    )

    await workflow._draft(job, "basic evidence", "method evidence", "formula evidence")

    prompt = deepseek.prompts["draft"]
    assert "必须严格依据下方三份上游证据材料" in prompt
    assert "不得引入材料外事实" in prompt
    assert "材料中未明确说明" in prompt
    assert "不要写“颠覆认知”“手术刀”“悲情叙事”等材料外修辞" in prompt
    assert "PART01 研究背景" in prompt
    assert "PART02 核心发现" in prompt
    assert "PART03 进一步讨论" in prompt
    assert "PART04 研究框架与方法" in prompt
    assert "PART05 核心数据" in prompt
    assert "研究范式" in prompt
    assert "公式" in prompt
    assert "图表逐图解读" in prompt
    assert "LaTeX" in prompt
    assert "$$" in prompt


@pytest.mark.asyncio
async def test_paper_workflow_final_prompt_prevents_new_claims(tmp_path) -> None:
    store = JobStore(tmp_path / "jobs", retention_days=7)
    job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading")
    deepseek = CapturingDeepSeekClient()
    workflow = PaperReadingWorkflow(
        store=store,
        events=EventBroker(),
        mineru=MineruClient(use_mock=True),
        deepseek=deepseek,
        docx_exporter=DocxExporter(),
    )

    await workflow._finalize(job, "draft evidence")

    prompt = deepseek.prompts["final"]
    assert "不得新增草稿中没有的作者机构、数字、案例、判断或延伸问题" in prompt
    assert "删除材料外修辞" in prompt
    assert "保留 PART01-PART05" in prompt
    assert "保留 LaTeX 公式块" in prompt


def test_paper_workflow_basic_prompt_asks_for_reader_first_explanation(tmp_path) -> None:
    workflow = PaperReadingWorkflow(
        store=JobStore(tmp_path / "jobs", retention_days=7),
        events=EventBroker(),
        mineru=MineruClient(use_mock=True),
        deepseek=DeepSeekClient(api_key="", base_url="https://example.invalid", model="mock", use_mock=True),
        docx_exporter=DocxExporter(),
    )

    prompt = workflow._basic_prompt("# Paper")

    assert "论文主线" in prompt
    assert "研究贡献" in prompt
    assert "读者要先理解什么" in prompt


def test_paper_workflow_method_prompt_requires_paradigm_and_figure_reading(tmp_path) -> None:
    workflow = PaperReadingWorkflow(
        store=JobStore(tmp_path / "jobs", retention_days=7),
        events=EventBroker(),
        mineru=MineruClient(use_mock=True),
        deepseek=DeepSeekClient(api_key="", base_url="https://example.invalid", model="mock", use_mock=True),
        docx_exporter=DocxExporter(),
    )

    prompt = workflow._method_prompt("# Paper")

    assert "研究范式识别" in prompt
    assert "为什么这个范式适合本文问题" in prompt
    assert "范式的局限" in prompt
    assert "图表逐图解读" in prompt
    assert "图号" in prompt
    assert "变量" in prompt
    assert "读图方法" in prompt


def test_paper_workflow_formula_prompt_requires_symbol_and_logic_explanation(tmp_path) -> None:
    workflow = PaperReadingWorkflow(
        store=JobStore(tmp_path / "jobs", retention_days=7),
        events=EventBroker(),
        mineru=MineruClient(use_mock=True),
        deepseek=DeepSeekClient(api_key="", base_url="https://example.invalid", model="mock", use_mock=True),
        docx_exporter=DocxExporter(),
    )

    prompt = workflow._formula_prompt("# Paper")

    assert "每个符号" in prompt
    assert "计算步骤" in prompt
    assert "白话解释" in prompt
    assert "这个公式回答什么问题" in prompt
    assert "假设与局限" in prompt
    assert "LaTeX" in prompt
    assert "$$" in prompt
    assert "不要把公式写成一串普通文字" in prompt


@pytest.mark.asyncio
async def test_paper_workflow_marks_document_extraction_failed_on_error(tmp_path) -> None:
    store = JobStore(tmp_path / "jobs", retention_days=7)
    job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading")
    pdf_path = store.job_dir(job.job_id) / "input" / "input.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 mock")
    workflow = PaperReadingWorkflow(
        store=store,
        events=EventBroker(),
        mineru=FailingMineruClient(),
        deepseek=DeepSeekClient(api_key="", base_url="https://example.invalid", model="mock", use_mock=True),
        docx_exporter=DocxExporter(),
    )

    with pytest.raises(RuntimeError, match="mineru boom"):
        await workflow.run(job.job_id, pdf_path)

    reloaded = store.load_job(job.job_id)
    assert reloaded.status == JobStatus.FAILED
    assert reloaded.nodes["document_extraction"].status == NodeStatus.FAILED
    assert "mineru boom" in reloaded.nodes["document_extraction"].error


@pytest.mark.asyncio
async def test_paper_workflow_marks_basic_info_failed_on_error(tmp_path) -> None:
    store = JobStore(tmp_path / "jobs", retention_days=7)
    job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading")
    pdf_path = store.job_dir(job.job_id) / "input" / "input.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 mock")
    failure_message = "basic info failed"
    workflow = PaperReadingWorkflow(
        store=store,
        events=EventBroker(),
        mineru=MineruClient(use_mock=True),
        deepseek=FailingDeepSeekClient("basic_info", failure_message),
        docx_exporter=DocxExporter(),
    )

    with pytest.raises(RuntimeError, match=failure_message):
        await workflow.run(job.job_id, pdf_path)

    reloaded = store.load_job(job.job_id)
    assert reloaded.status == JobStatus.FAILED
    assert reloaded.nodes["basic_info"].status == NodeStatus.FAILED
    assert failure_message in reloaded.nodes["basic_info"].error


@pytest.mark.asyncio
async def test_paper_workflow_marks_draft_failed_on_error(tmp_path) -> None:
    store = JobStore(tmp_path / "jobs", retention_days=7)
    job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading")
    pdf_path = store.job_dir(job.job_id) / "input" / "input.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 mock")
    failure_message = "draft failed"
    workflow = PaperReadingWorkflow(
        store=store,
        events=EventBroker(),
        mineru=MineruClient(use_mock=True),
        deepseek=FailingDeepSeekClient("draft", failure_message),
        docx_exporter=DocxExporter(),
    )

    with pytest.raises(RuntimeError, match=failure_message):
        await workflow.run(job.job_id, pdf_path)

    reloaded = store.load_job(job.job_id)
    assert reloaded.status == JobStatus.FAILED
    assert reloaded.nodes["draft"].status == NodeStatus.FAILED
    assert failure_message in reloaded.nodes["draft"].error
