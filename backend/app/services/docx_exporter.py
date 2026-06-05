import re
from pathlib import Path

from docx import Document


HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$")
ORDERED_LIST_RE = re.compile(r"^\d+[\.)]\s+(.+)$")
BULLET_LIST_RE = re.compile(r"^[-*+]\s+(.+)$")
INLINE_TOKEN_RE = re.compile(r"(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))")
LINK_RE = re.compile(r"^\[([^\]]+)\]\(([^)]+)\)$")


class DocxExporter:
    def export_markdown(self, markdown: str, output_path: Path) -> Path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        document = Document()
        for raw_line in markdown.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            if set(line) <= {"-", "*", "_"} and len(line) >= 3:
                continue
            heading = HEADING_RE.match(line)
            ordered = ORDERED_LIST_RE.match(line)
            bullet = BULLET_LIST_RE.match(line)
            if heading:
                level = min(len(heading.group(1)), 6)
                paragraph = document.add_heading("", level=level)
                self._add_inline_runs(paragraph, heading.group(2).strip())
            elif ordered:
                paragraph = document.add_paragraph(style="List Number")
                self._add_inline_runs(paragraph, ordered.group(1).strip())
            elif bullet:
                paragraph = document.add_paragraph(style="List Bullet")
                self._add_inline_runs(paragraph, bullet.group(1).strip())
            elif line.startswith("> "):
                paragraph = document.add_paragraph(style="Intense Quote")
                self._add_inline_runs(paragraph, line[2:].strip())
            else:
                paragraph = document.add_paragraph()
                self._add_inline_runs(paragraph, line)
        document.save(output_path)
        return output_path

    def _add_inline_runs(self, paragraph, text: str) -> None:
        for token in INLINE_TOKEN_RE.split(text):
            if not token:
                continue
            link = LINK_RE.match(token)
            if token.startswith(("**", "__")) and token.endswith(("**", "__")):
                run = paragraph.add_run(token[2:-2])
                run.bold = True
            elif token.startswith("`") and token.endswith("`"):
                paragraph.add_run(token[1:-1])
            elif token.startswith(("*", "_")) and token.endswith(("*", "_")):
                run = paragraph.add_run(token[1:-1])
                run.italic = True
            elif link:
                paragraph.add_run(f"{link.group(1)}（{link.group(2)}）")
            else:
                paragraph.add_run(token)
