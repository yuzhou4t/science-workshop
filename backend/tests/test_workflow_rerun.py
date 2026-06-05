import pytest

from app.workflows.wechat_writing import downstream_nodes, editable_node_artifact_path


def test_downstream_nodes_from_final_only_exports_docx() -> None:
    assert downstream_nodes("final") == ["docx_export"]


def test_downstream_nodes_from_formula_metrics_regenerates_article_chain() -> None:
    assert downstream_nodes("formula_metrics") == ["draft", "final", "docx_export"]


@pytest.mark.parametrize("node_id", ["unknown", "../final", "nodes/final.md"])
def test_unknown_or_unsafe_node_ids_have_no_writeable_chain(node_id: str) -> None:
    assert downstream_nodes(node_id) == []
    with pytest.raises(ValueError):
        editable_node_artifact_path(node_id)
