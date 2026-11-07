"""Приёмочные тесты парсера (ТЗ, раздел 20: A–E, часть F)."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from app.parser.transcript import parse_transcript
from tests.fixtures.dialogue import DIALOGUE, learner_texts, render_app, render_prefixed

FIXTURES = Path(__file__).parent / "fixtures"
UI_LINES = (
    "Скрыть текст",
    "Показать текст",
    "Сменить роль",
    "Грамматические ошибки",
    "Просто говорите",
    "кнопка вверху экрана",
    "12 мин",
)


def _roles(result):
    return [t.role for t in result.turns]


def _expected_roles():
    return ["tutor" if r in ("tutor", "collapsed") else "learner" for r, _ts, _t in DIALOGUE]


# --- A. Обратный порядок -------------------------------------------------------


def test_a_reverse_handwritten_fixture_restores_chronology():
    raw = (FIXTURES / "app_reverse_synthetic.txt").read_text(encoding="utf-8")
    r = parse_transcript(raw)

    assert r.detected_direction == "reverse"
    assert r.applied_direction == "reverse"
    assert r.confidence_label == "high"
    assert not r.needs_confirmation
    assert _roles(r) == _expected_roles()
    assert r.turns[0].text.startswith("Hi, nice to meet you")
    assert r.turns[-1].text.startswith("Sure. Short summary")
    learner = [t for t in r.turns if t.role == "learner"]
    assert [t.text for t in learner] == learner_texts()
    assert [t.raw_timestamp for t in learner] == ["01:12", "01:45", "02:03", "00:58", "01:31", "00:19"]
    assert [t.index for t in r.turns] == list(range(len(r.turns)))


def test_a_generated_reverse_matches_handwritten():
    r = parse_transcript(render_app(reverse=True))
    assert r.applied_direction == "reverse"
    assert _roles(r) == _expected_roles()


# --- B. Прямой порядок не переворачивается --------------------------------------


def test_b_chronological_is_not_flipped():
    r = parse_transcript(render_app(reverse=False))
    assert r.detected_direction == "chronological"
    assert r.applied_direction == "chronological"
    assert r.turns[0].text.startswith("Hi, nice to meet you")
    assert _roles(r) == _expected_roles()


def test_b_explicit_order_overrides_detection_with_warning():
    r = parse_transcript(render_app(reverse=True), order="chronological")
    assert r.applied_direction == "chronological"
    assert r.detected_direction == "reverse"
    assert any("сигналы указывают на другой" in w for w in r.warnings)
    assert r.turns[0].text.startswith("Sure. Short summary")


# --- C. Без меток времени ----------------------------------------------------------


def test_c_prefixed_transcript_without_timestamps():
    r = parse_transcript(render_prefixed())
    assert r.applied_direction == "chronological"
    assert r.timestamp_kind == "none"
    assert [t.role for t in r.turns] == [
        "tutor" if role == "tutor" else "learner" for role, _ts, _t in DIALOGUE if role != "collapsed"
    ]
    assert all("explicit_prefix" in t.flags for t in r.turns)


def test_c_app_format_without_timestamps_infers_roles_and_asks_confirmation():
    r = parse_transcript(render_app(reverse=True, with_timestamps=False))
    assert r.applied_direction == "reverse"
    assert _roles(r) == _expected_roles()
    learner = [t for t in r.turns if t.role == "learner"]
    assert all("role_inferred" in t.flags for t in learner)
    assert all(t.duration_sec is None for t in learner)
    assert r.needs_confirmation


def test_c_plain_text_without_any_markers_needs_confirmation():
    raw = "We talked about dashboards.\n\nI built a dashboard in Tableau.\n\nIt was used weekly."
    r = parse_transcript(raw)
    assert r.needs_confirmation
    assert set(_roles(r)) == {"unknown"}
    assert r.confidence_label == "low"


# --- D. Служебные надписи ---------------------------------------------------------


def test_d_ui_noise_and_scenario_header_removed_from_turns():
    raw = (FIXTURES / "app_reverse_synthetic.txt").read_text(encoding="utf-8")
    r = parse_transcript(raw)
    for t in r.turns:
        for ui in UI_LINES:
            assert ui not in t.text
    removed_texts = " | ".join(x.text for x in r.removed)
    for ui in ("Скрыть текст", "Показать текст", "Сменить роль", "12 мин", "Грамматические ошибки"):
        assert ui in removed_texts
    assert r.scenario_title == "собеседование в международную компанию на аналитика данных"


def test_d_crlf_input_is_supported():
    raw = (FIXTURES / "app_reverse_synthetic.txt").read_text(encoding="utf-8").replace("\n", "\r\n")
    r = parse_transcript(raw)
    assert _roles(r) == _expected_roles()


# --- E. Роли и пропуски -----------------------------------------------------------


def test_e_collapsed_tutor_turn_is_marked_and_next_answer_flagged():
    r = parse_transcript(render_app(reverse=True))
    collapsed = [t for t in r.turns if "collapsed" in t.flags]
    assert len(collapsed) == 1
    assert collapsed[0].role == "tutor" and collapsed[0].text == ""
    nxt = r.turns[collapsed[0].index + 1]
    assert nxt.role == "learner" and "question_missing" in nxt.flags
    assert r.stats["collapsed_tutor_turns"] == 1
    assert any("Показать текст" in w for w in r.warnings)


def test_e_timestamps_are_durations_not_clock():
    r = parse_transcript(render_app(reverse=True))
    assert r.timestamp_kind == "duration"
    ts_signal = next(s for s in r.signals if s.name == "timestamps")
    assert ts_signal.vote == 0
    assert r.stats["learner_speech_seconds"] == 72 + 105 + 123 + 58 + 91 + 19


def test_e_clock_timestamps_are_used_as_weak_signal():
    raw = "\n\n".join(
        [
            "Tell me about SQL?\nСкрыть текст",
            "10:01\nI use joins and window functions.",
            "Which window functions?\nСкрыть текст",
            "10:03\nRow number and lag.",
            "Why lag?\nСкрыть текст",
            "10:05\nTo compare with the previous day.",
        ]
    )
    r = parse_transcript(raw)
    ts_signal = next(s for s in r.signals if s.name == "timestamps")
    assert r.timestamp_kind == "clock"
    assert ts_signal.vote == 1


def test_e_preference_conflict_is_flagged():
    r = parse_transcript(render_app(reverse=False), preferred="reverse")
    assert r.applied_direction == "chronological"
    assert r.needs_confirmation
    assert any("обычного формата" in w for w in r.warnings)


# --- F (частично). Повторы и запинки не меняются парсером ------------------------


def test_f_disfluencies_are_preserved_verbatim():
    r = parse_transcript(render_app(reverse=True))
    texts = " ".join(t.text for t in r.turns)
    assert "I... I make reports" in texts
    assert "and they, they decided" in texts


def test_parse_is_pure_and_deterministic():
    raw = render_app(reverse=True)
    copy = str(raw)
    a, b = parse_transcript(raw), parse_transcript(raw)
    assert raw == copy
    assert [(t.role, t.text) for t in a.turns] == [(t.role, t.text) for t in b.turns]


# --- Реальные записи: только локально, в репозиторий не попадают ------------------

PRIVATE_DIR = os.environ.get("PRIVATE_FIXTURES_DIR")


@pytest.mark.skipif(not PRIVATE_DIR, reason="PRIVATE_FIXTURES_DIR не задан")
def test_private_lessons_parse_without_unknown_roles():
    files = sorted(Path(PRIVATE_DIR or ".").glob("*.txt"))
    assert files, "в PRIVATE_FIXTURES_DIR нет .txt"
    for f in files:
        r = parse_transcript(f.read_text(encoding="utf-8"))
        assert r.stats["unknown_turns"] == 0, f.name
        assert r.turns and r.turns[0].role == "tutor", f.name
