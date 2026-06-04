import zipfile

import pytest

from app.services.deepseek_client import DeepSeekClient, _extract_message_content
from app.services.mineru_client import MineruClient, _extract_mineru_zip, _extract_task_id


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


def test_mineru_task_creation_missing_task_id_raises_runtime_error() -> None:
    with pytest.raises(RuntimeError, match="MinerU task response missing task_id"):
        _extract_task_id({"code": 0, "data": {}})


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
