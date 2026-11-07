"""Интеграционные тесты API на PostgreSQL (нужен TEST_DATABASE_URL)."""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from tests.fixtures.dialogue import render_app

RAW = (Path(__file__).parent / "fixtures" / "app_reverse_synthetic.txt").read_text(encoding="utf-8")


def _create(client, raw=RAW, **extra):
    body = {"raw_text": raw, "order": "reverse", **extra}
    return client.post("/api/sessions", json=body)


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_preview_returns_chronological_turns(client):
    r = client.post("/api/transcripts/preview", json={"raw_text": RAW})
    assert r.status_code == 200
    data = r.json()
    assert data["applied_direction"] == "reverse"
    assert data["turns"][0]["role"] == "tutor"
    assert data["turns"][1]["word_count"] > 0
    assert data["duplicate_of"] is None


def test_create_session_keeps_original_byte_for_byte(client, migrated_db):
    r = _create(client, lesson_date="2026-11-08")
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["title"] == "собеседование в международную компанию на аналитика данных"
    assert s["status"] == "parsed"
    assert [t["idx"] for t in s["turns"]] == list(range(len(s["turns"])))

    src = client.get(f"/api/sessions/{s['id']}/source").json()
    assert src["raw_text"] == RAW

    # Исходник нельзя изменить даже напрямую в БД.
    engine = create_engine(migrated_db)
    with pytest.raises(Exception, match="immutable"), engine.begin() as conn:
        conn.execute(text("UPDATE session_sources SET raw_text = 'x'"))
    engine.dispose()


def test_history_persists_and_lists(client):
    _create(client)
    lst = client.get("/api/sessions").json()
    assert len(lst) == 1
    detail = client.get(f"/api/sessions/{lst[0]['id']}").json()
    assert detail["stats"]["learner_turns"] == 6


def test_order_preference_is_remembered(client):
    assert client.get("/api/settings").json()["preferred_order"] is None
    _create(client)
    assert client.get("/api/settings").json()["preferred_order"] == "reverse"


def test_low_confidence_requires_confirmation(client):
    raw = render_app(reverse=True, with_timestamps=False)
    r = _create(client, raw=raw)
    assert r.status_code == 409
    r = _create(client, raw=raw, confirmed=True)
    assert r.status_code == 201, r.text


def test_order_contradicting_detection_requires_confirmation(client):
    r = client.post("/api/sessions", json={"raw_text": RAW, "order": "chronological"})
    assert r.status_code == 409


def test_unknown_roles_must_be_resolved(client):
    raw = "We talked about dashboards.\n\nI built a dashboard in Tableau."
    r = client.post("/api/sessions", json={"raw_text": raw, "order": "chronological", "confirmed": True})
    assert r.status_code == 422
    r = client.post(
        "/api/sessions",
        json={
            "raw_text": raw,
            "order": "chronological",
            "confirmed": True,
            "role_overrides": {"0": "tutor", "1": "learner"},
        },
    )
    assert r.status_code == 201, r.text
    turns = r.json()["turns"]
    assert [t["role"] for t in turns] == ["tutor", "learner"]
    assert all(t["role_overridden"] for t in turns)


def test_duplicate_is_detected(client):
    first = _create(client).json()
    prev = client.post("/api/transcripts/preview", json={"raw_text": RAW}).json()
    assert prev["duplicate_of"] == first["id"]
    assert _create(client).status_code == 409
    assert _create(client, allow_duplicate=True).status_code == 201


def test_delete_session_removes_everything(client, migrated_db):
    s = _create(client).json()
    assert client.delete(f"/api/sessions/{s['id']}").status_code == 204
    assert client.get(f"/api/sessions/{s['id']}").status_code == 404
    engine = create_engine(migrated_db)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM session_turns")).scalar() == 0
        assert conn.execute(text("SELECT count(*) FROM session_sources")).scalar() == 0
    engine.dispose()


def test_settings_update(client):
    r = client.patch("/api/settings", json={"disfluency_analysis_enabled": True, "feedback_language": "mixed"})
    assert r.json()["disfluency_analysis_enabled"] is True
    assert r.json()["feedback_language"] == "mixed"


def test_too_long_text_is_rejected(client):
    r = client.post("/api/transcripts/preview", json={"raw_text": "a" * 200_001})
    assert r.status_code == 413
