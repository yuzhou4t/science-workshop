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
