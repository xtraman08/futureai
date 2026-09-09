import json
from pathlib import Path

SCHEMA_PATH = (
    Path(__file__).resolve().parents[2] / "docs" / "database-schema.json"
)


def load_schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def test_database_schema_defines_required_entities() -> None:
    schema = load_schema()

    assert schema["schema_version"] == 1
    assert schema["database"]["engine"] == "SQLite"
    assert set(schema["tables"]) == {
        "schema_migrations",
        "users",
        "boards",
        "board_columns",
        "cards",
        "chat_messages",
    }


def test_domain_tables_have_primary_keys_and_cascading_ownership() -> None:
    tables = load_schema()["tables"]

    for table_name in ("users", "boards", "board_columns", "cards", "chat_messages"):
        assert tables[table_name]["columns"]["id"]["primary_key"] is True

    expected_references = {
        ("boards", "user_id"): "users",
        ("board_columns", "board_id"): "boards",
        ("cards", "column_id"): "board_columns",
        ("chat_messages", "board_id"): "boards",
    }
    for (table_name, column_name), parent_table in expected_references.items():
        reference = tables[table_name]["columns"][column_name]["references"]
        assert reference["table"] == parent_table
        assert reference["on_delete"] == "CASCADE"


def test_schema_supports_ordering_and_stale_ai_proposal_detection() -> None:
    tables = load_schema()["tables"]

    assert "UNIQUE (board_id, position)" in tables["board_columns"]["constraints"]
    assert "UNIQUE (column_id, position)" in tables["cards"]["constraints"]
    assert "version" in tables["boards"]["columns"]
    assert "base_board_version" in tables["chat_messages"]["columns"]
    assert "proposed_operations_json" in tables["chat_messages"]["columns"]
    assert tables["chat_messages"]["indexes"][1]["where"] == (
        "proposal_status = 'pending'"
    )
