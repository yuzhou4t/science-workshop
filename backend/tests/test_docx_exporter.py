from docx import Document

from app.services.docx_exporter import DocxExporter


def test_export_markdown_to_docx_preserves_headings_and_paragraphs(tmp_path) -> None:
    output = tmp_path / "final.docx"
    exporter = DocxExporter()

    exporter.export_markdown("# 主标题\n\n## 小标题\n\n这是一段正文。", output)

    assert output.exists()
    doc = Document(output)
    texts = [paragraph.text for paragraph in doc.paragraphs]
    assert "主标题" in texts
    assert "小标题" in texts
    assert "这是一段正文。" in texts


def test_export_markdown_to_docx_converts_common_markdown_markers(tmp_path) -> None:
    output = tmp_path / "final.docx"
    exporter = DocxExporter()

    exporter.export_markdown(
        "# 主标题\n\n"
        "### 三级标题\n\n"
        "**核心发现**：这是正文。\n\n"
        "1. 第一条\n"
        "2. 第二条\n"
        "- 要点一\n",
        output,
    )

    doc = Document(output)
    texts = [paragraph.text for paragraph in doc.paragraphs]
    joined = "\n".join(texts)
    assert "主标题" in texts
    assert "三级标题" in texts
    assert "核心发现：这是正文。" in texts
    assert "第一条" in texts
    assert "第二条" in texts
    assert "要点一" in texts
    assert "#" not in joined
    assert "**" not in joined
    assert "1. 第一条" not in joined
