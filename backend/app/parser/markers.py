"""Служебные надписи и маркеры интерфейса AI-тьютора.

Список расширяемый: новые надписи добавляются сюда, а не в логику парсера.
Сравнение идёт по нормализованной строке (нижний регистр, схлопнутые пробелы,
единый вид тире).
"""

from __future__ import annotations

import re

# Маркер под репликой тьютора: текст реплики развёрнут.
HIDE_TEXT_MARKERS = frozenset({"скрыть текст", "hide text", "hide transcript"})

# Маркер на месте свёрнутой реплики тьютора: текста в копии нет.
SHOW_TEXT_MARKERS = frozenset({"показать текст", "show text", "show transcript"})

# Кнопки и подсказки интерфейса, которые не являются репликами.
UI_NOISE_EXACT = frozenset(
    {
        "сменить роль",
        "грамматические ошибки",
        "просто говорите - не бойтесь ошибиться",
        "в любой момент можно сменить роль",
        "- кнопка вверху экрана.",
        "- кнопка вверху экрана",
        "кнопка вверху экрана.",
        "кнопка вверху экрана",
        "change role",
        "grammar mistakes",
    }
)

# Метаданные занятия вида «16 мин» / «16 min».
UI_NOISE_PATTERNS = (re.compile(r"^\d{1,3}\s*(мин|min|minutes|минут[аы]?)\.?$"),)

# Метка в начале реплики ученика: 02:49 или 1:02:49.
TIMESTAMP_RE = re.compile(r"^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$")

# Явные префиксы говорящего, если расшифровка размечена вручную.
SPEAKER_PREFIX_RE = re.compile(
    r"^\s*(?P<who>ai|tutor|interviewer|bot|assistant|me|you|learner|student|"
    r"candidate|я|ученик|тьютор|интервьюер|кандидат|ии)\s*[:：\-–—]\s*(?P<text>.*)$",
    re.IGNORECASE,
)

TUTOR_PREFIXES = frozenset({"ai", "tutor", "interviewer", "bot", "assistant", "тьютор", "интервьюер", "ии"})
LEARNER_PREFIXES = frozenset({"me", "you", "learner", "student", "candidate", "я", "ученик", "кандидат"})


def normalize_line(line: str) -> str:
    text = line.strip().lower()
    text = re.sub(r"[–—−]", "-", text)
    return re.sub(r"\s+", " ", text)


def is_hide_marker(line: str) -> bool:
    return normalize_line(line) in HIDE_TEXT_MARKERS


def is_show_marker(line: str) -> bool:
    return normalize_line(line) in SHOW_TEXT_MARKERS


def is_ui_noise(line: str) -> bool:
    norm = normalize_line(line)
    if norm in UI_NOISE_EXACT:
        return True
    return any(p.match(norm) for p in UI_NOISE_PATTERNS)


def parse_timestamp(line: str) -> int | None:
    """Возвращает число секунд, если строка — метка времени, иначе None."""
    m = TIMESTAMP_RE.match(line.strip())
    if not m:
        return None
    hours = int(m.group(1) or 0)
    minutes = int(m.group(2))
    seconds = int(m.group(3))
    if seconds >= 60:
        return None
    return hours * 3600 + minutes * 60 + seconds


def has_latin(text: str) -> bool:
    return re.search(r"[A-Za-z]", text) is not None


def is_cyrillic_meta(text: str) -> bool:
    """Строка преимущественно на русском — кандидат в заголовок сценария.

    Допускаются отдельные английские слова («middle», «SQL»), но доля
    кириллических букв должна быть не меньше 60%.
    """
    cyr = len(re.findall(r"[А-Яа-яЁё]", text))
    lat = len(re.findall(r"[A-Za-z]", text))
    return cyr > 0 and cyr / (cyr + lat) >= 0.6
