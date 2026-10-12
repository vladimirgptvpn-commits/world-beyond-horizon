"""Лёгкие проверки структуры пакета без внешних зависимостей."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_json_files_parse():
    for path in ROOT.rglob("*.json"):
        json.loads(path.read_text(encoding="utf-8"))


def test_character_requires_player_name():
    schema = json.loads((ROOT / "schemas/character.schema.json").read_text(encoding="utf-8"))
    assert "name" in schema["required"]
    assert schema["properties"]["name"]["minLength"] >= 1


def test_save_has_version_and_revision():
    schema = json.loads((ROOT / "schemas/save.schema.json").read_text(encoding="utf-8"))
    assert "format_version" in schema["required"]
    assert "world_revision" in schema["required"]
