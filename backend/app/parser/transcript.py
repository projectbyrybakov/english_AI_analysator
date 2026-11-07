"""Парсер расшифровки занятия.

Принципы (ТЗ, раздел 3):
- оригинал не меняется, парсер строит отдельную нормализованную последовательность;
- порядок определяется по нескольким сигналам, метки времени — только слабый сигнал;
- служебные надписи и заголовки сценария отделяются от реплик;
- при низкой уверенности результат требует подтверждения пользователем.

Парсер детерминированный и не вызывает LLM.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from itertools import pairwise
from typing import Literal

from . import markers

PARSER_VERSION = "1.0.0"

Role = Literal["learner", "tutor", "unknown"]
Order = Literal["auto", "reverse", "chronological"]
Direction = Literal["reverse", "chronological"]


# --------------------------------------------------------------------------- #
# Структуры данных
# --------------------------------------------------------------------------- #


@dataclass
class _Element:
    kind: Literal["para", "ts", "hide", "show"]
    line_start: int
    line_end: int
    gap_before: int = 0
    text: str = ""
    seconds: int | None = None
    raw: str = ""
    explicit_role: Role | None = None


@dataclass
class ParsedTurn:
    index: int  # позиция в хронологическом порядке, с 0
    role: Role
    text: str
    duration_sec: int | None = None
    raw_timestamp: str | None = None
    line_start: int = 0
    line_end: int = 0
    flags: list[str] = field(default_factory=list)


@dataclass
class Signal:
    name: str
    vote: int  # +1 хронологический, -1 обратный, 0 нет голоса
    weight: float
    strength: float
    detail: str


@dataclass
class RemovedLine:
    line: int
    text: str
    reason: Literal["ui_noise", "hide_marker", "show_marker", "timestamp", "meta"]


@dataclass
class ParseResult:
    parser_version: str
    requested_order: Order
    detected_direction: Direction
    applied_direction: Direction
    confidence: float
    confidence_label: Literal["high", "medium", "low"]
    needs_confirmation: bool
    signals: list[Signal]
    turns: list[ParsedTurn]
    scenario_title: str | None
    meta_lines: list[str]
    removed: list[RemovedLine]
    warnings: list[str]
    timestamp_kind: Literal["duration", "clock", "none"]
    stats: dict[str, float | int | None]


# --------------------------------------------------------------------------- #
# Шаг 1. Разбиение на элементы
# --------------------------------------------------------------------------- #


def _tokenize(raw: str) -> tuple[list[_Element], list[RemovedLine]]:
    elements: list[_Element] = []
    removed: list[RemovedLine] = []
    gap = 0
    lines = raw.replace("\r\n", "\n").replace("\r", "\n").split("\n")

    for idx, line in enumerate(lines, start=1):
        stripped = line.strip()
        if not stripped:
            gap += 1
            continue
        if markers.is_hide_marker(stripped):
            elements.append(_Element("hide", idx, idx, gap, raw=stripped))
            removed.append(RemovedLine(idx, stripped, "hide_marker"))
            gap = 0
            continue
        if markers.is_show_marker(stripped):
            elements.append(_Element("show", idx, idx, gap, raw=stripped))
            removed.append(RemovedLine(idx, stripped, "show_marker"))
            gap = 0
            continue
        if markers.is_ui_noise(stripped):
            removed.append(RemovedLine(idx, stripped, "ui_noise"))
            gap += 1  # служебная строка разрывает абзац
            continue
        seconds = markers.parse_timestamp(stripped)
        if seconds is not None:
            elements.append(_Element("ts", idx, idx, gap, seconds=seconds, raw=stripped))
            removed.append(RemovedLine(idx, stripped, "timestamp"))
            gap = 0
            continue

        explicit: Role | None = None
        text = stripped
        m = markers.SPEAKER_PREFIX_RE.match(stripped)
        if m:
            who = m.group("who").lower()
            if who in markers.TUTOR_PREFIXES:
                explicit = "tutor"
            elif who in markers.LEARNER_PREFIXES:
                explicit = "learner"
            text = m.group("text").strip()

        prev = elements[-1] if elements else None
        if prev is not None and prev.kind == "para" and gap == 0 and explicit is None:
            prev.text = f"{prev.text}\n{text}"
            prev.line_end = idx
        else:
            elements.append(_Element("para", idx, idx, gap, text=text, explicit_role=explicit))
        gap = 0

    return elements, removed


# --------------------------------------------------------------------------- #
# Шаг 2. Заголовки сценария на краях документа
# --------------------------------------------------------------------------- #


def _extract_meta(elements: list[_Element], removed: list[RemovedLine]) -> list[str]:
    structural = [i for i, e in enumerate(elements) if e.kind != "para"]
    if not structural:
        return []
    first, last = structural[0], structural[-1]
    meta: list[str] = []
    keep: list[_Element] = []
    for i, e in enumerate(elements):
        at_edge = i < first or i > last
        # Перед первым маркером может стоять реплика тьютора (последняя в обратном
        # порядке), поэтому в заголовки уходят только строки без латиницы.
        if e.kind == "para" and at_edge and markers.is_cyrillic_meta(e.text) and e.explicit_role is None:
            meta.append(e.text)
            removed.append(RemovedLine(e.line_start, e.text, "meta"))
            continue
        keep.append(e)
    elements[:] = keep
    return meta


# --------------------------------------------------------------------------- #
# Шаг 3. Реплики и роли (в порядке документа)
# --------------------------------------------------------------------------- #


def _make_turn(paras: list[_Element], role: Role, flags: list[str] | None = None) -> ParsedTurn:
    return ParsedTurn(
        index=-1,
        role=role,
        text="\n\n".join(p.text for p in paras),
        line_start=paras[0].line_start,
        line_end=paras[-1].line_end,
        flags=list(flags or []),
    )


def _split_index(run: list[_Element]) -> tuple[int, bool]:
    """Граница learner|tutor внутри блока: по самому большому разрыву строк."""
    gaps = [run[k].gap_before for k in range(1, len(run))]
    best = max(gaps)
    ambiguous = gaps.count(best) > 1
    return gaps.index(best) + 1, ambiguous


def _build_turns(elements: list[_Element], warnings: list[str]) -> list[ParsedTurn]:
    turns: list[ParsedTurn] = []
    i = 0
    n = len(elements)
    while i < n:
        e = elements[i]
        if e.kind == "show":
            turns.append(
                ParsedTurn(
                    -1, "tutor", "", line_start=e.line_start, line_end=e.line_end, flags=["collapsed", "missing_text"]
                )
            )
            i += 1
            continue
        if e.kind == "hide":
            # «Скрыть текст» без текста реплики перед ним.
            prev = elements[i - 1] if i > 0 else None
            if prev is None or prev.kind != "para":
                warnings.append(f"Строка {e.line_start}: «{e.raw}» без текста реплики.")
            i += 1
            continue

        ts: _Element | None = None
        if e.kind == "ts":
            ts = e
            i += 1
            if i >= n or elements[i].kind != "para":
                warnings.append(f"Строка {e.line_start}: метка {e.raw} без текста реплики.")
                continue

        # Собираем подряд идущие абзацы.
        run: list[_Element] = []
        while i < n and elements[i].kind == "para":
            run.append(elements[i])
            i += 1
        followed_by_hide = i < n and elements[i].kind == "hide"

        # Явная разметка говорящего — каждая строка отдельной репликой.
        if all(p.explicit_role for p in run) and ts is None:
            for p in run:
                turns.append(_make_turn([p], p.explicit_role or "unknown", ["explicit_prefix"]))
            continue

        start_learner = ts is not None
        end_tutor = followed_by_hide

        if start_learner and end_tutor and len(run) == 1:
            t = _make_turn(run, "learner")
            _attach_ts(t, ts)
            t.flags.append("hide_marker_after_learner")
            turns.append(t)
            warnings.append(
                f"Строки {run[0].line_start}–{run[0].line_end}: после реплики ученика сразу "
                "«Скрыть текст» без текста тьютора."
            )
            continue

        if start_learner and end_tutor:
            k, ambiguous = _split_index(run)
            learner = _make_turn(run[:k], "learner")
            _attach_ts(learner, ts)
            tutor = _make_turn(run[k:], "tutor")
            if ambiguous:
                learner.flags.append("split_ambiguous")
                tutor.flags.append("split_ambiguous")
                warnings.append(
                    f"Строки {run[0].line_start}–{run[-1].line_end}: граница между ответом ученика "
                    "и репликой тьютора определена неуверенно — проверьте в предпросмотре."
                )
            turns.extend([learner, tutor])
            continue

        if start_learner:
            k = 1
            while k < len(run) and run[k].gap_before <= 1:
                k += 1
            learner = _make_turn(run[:k], "learner")
            _attach_ts(learner, ts)
            turns.append(learner)
            for p in run[k:]:
                turns.append(_make_turn([p], p.explicit_role or "unknown"))
            continue

        if end_tutor:
            k = len(run) - 1
            while k > 0 and run[k].gap_before <= 1:
                k -= 1
            for p in run[:k]:
                turns.append(_make_turn([p], p.explicit_role or "unknown"))
            turns.append(_make_turn(run[k:], "tutor"))
            continue

        for p in run:
            turns.append(_make_turn([p], p.explicit_role or "unknown"))

    _infer_by_alternation(turns, has_anchors=any(e.kind in ("hide", "show") for e in elements))
    return turns


def _infer_by_alternation(turns: list[ParsedTurn], has_anchors: bool) -> None:
    """Реплика без роли между репликами тьютора — скорее всего ученик.

    Применяется только к формату с маркерами тьютора («Скрыть/Показать текст»),
    результат помечается флагом role_inferred и требует подтверждения.
    """
    if not has_anchors:
        return
    for k, t in enumerate(turns):
        if t.role != "unknown":
            continue
        prev_role = turns[k - 1].role if k > 0 else None
        next_role = turns[k + 1].role if k + 1 < len(turns) else None
        neighbours = {r for r in (prev_role, next_role) if r is not None}
        if neighbours == {"tutor"}:
            t.role = "learner"
            t.flags.append("role_inferred")


def _attach_ts(turn: ParsedTurn, ts: _Element | None) -> None:
    if ts is not None:
        turn.duration_sec = ts.seconds
        turn.raw_timestamp = ts.raw
        turn.line_start = ts.line_start


# --------------------------------------------------------------------------- #
# Шаг 4. Определение порядка
# --------------------------------------------------------------------------- #

_STOPWORDS = frozenset(
    [
        "a",
        "an",
        "the",
        "and",
        "or",
        "but",
        "if",
        "so",
        "of",
        "to",
        "in",
        "on",
        "at",
        "for",
        "from",
        "by",
        "with",
        "as",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "being",
        "am",
        "do",
        "does",
        "did",
        "done",
        "have",
        "has",
        "had",
        "i",
        "you",
        "he",
        "she",
        "it",
        "we",
        "they",
        "me",
        "my",
        "your",
        "our",
        "their",
        "his",
        "her",
        "its",
        "this",
        "that",
        "these",
        "those",
        "there",
        "here",
        "what",
        "which",
        "who",
        "whom",
        "how",
        "why",
        "when",
        "where",
        "can",
        "could",
        "should",
        "would",
        "will",
        "shall",
        "may",
        "might",
        "must",
        "not",
        "no",
        "yes",
        "ok",
        "okay",
        "just",
        "very",
        "really",
        "about",
        "into",
        "than",
        "then",
        "also",
        "some",
        "any",
        "more",
        "most",
        "such",
        "one",
        "two",
        "first",
        "second",
        "like",
        "well",
        "good",
        "great",
        "nice",
        "tell",
        "me",
        "us",
        "let",
        "lets",
        "let's",
        "now",
        "please",
        "thank",
        "thanks",
        "sorry",
        "uh",
        "um",
        "yeah",
        "yep",
        "so",
    ]
)

_WORD_RE = re.compile(r"[a-z][a-z'’]+")
_SENT_RE = re.compile(r"(?<=[.!?])\s+")
_GREETING_RE = re.compile(
    r"\b(hello|hi there|nice to meet you|let[’']?s start|i[’']?ll be your interviewer|welcome)\b", re.I
)
_CLOSING_RE = re.compile(
    r"\b(end (this|the|our) (dialogue|conversation|session|interview)|summary of (our|the|this)|"
    r"goodbye|thank you for your time|let[’']?s finish|wrap (it )?up|that[’']?s all for today)\b",
    re.I,
)


def _stems(text: str) -> set[str]:
    words = _WORD_RE.findall(text.lower())
    return {w[:5] for w in words if w not in _STOPWORDS and len(w) > 2}


def _similarity(a: str, b: str) -> float:
    sa, sb = _stems(a), _stems(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / math.sqrt(len(sa) * len(sb))


def _question_feedback(text: str) -> tuple[str, str]:
    sentences = [s for s in _SENT_RE.split(text.strip()) if s]
    q_idx = [k for k, s in enumerate(sentences) if "?" in s]
    if not q_idx:
        return sentences[-1] if sentences else "", " ".join(sentences[:-1])
    start = q_idx[0]
    # Вопрос — последнее предложение-вопрос плюс предыдущее, если оно тоже вопрос.
    start = max(q_idx[-1] - 1, start) if len(q_idx) > 1 else q_idx[-1]
    return " ".join(sentences[start:]), " ".join(sentences[:start])


def _qa_score(seq: list[ParsedTurn]) -> float:
    score = 0.0
    for k, t in enumerate(seq):
        if t.role != "tutor" or not t.text:
            continue
        question, feedback = _question_feedback(t.text)
        nxt = seq[k + 1] if k + 1 < len(seq) else None
        prv = seq[k - 1] if k > 0 else None
        if nxt is not None and nxt.role == "learner":
            score += _similarity(question, nxt.text)
        if prv is not None and prv.role == "learner" and feedback:
            score += _similarity(feedback, prv.text)
    return score


def _edge_texts(turns: list[ParsedTurn], from_start: bool, count: int = 2) -> str:
    seq = turns if from_start else list(reversed(turns))
    texts = [t.text for t in seq if t.text][:count]
    return " ".join(texts)


def _timestamp_kind(turns: list[ParsedTurn]) -> tuple[Literal["duration", "clock", "none"], int]:
    """Возвращает тип меток и направление монотонности (+1 / -1 / 0)."""
    values = [t.duration_sec for t in turns if t.duration_sec is not None]
    if len(values) < 3:
        return ("none" if not values else "duration"), 0
    inc = all(b > a for a, b in pairwise(values))
    dec = all(b < a for a, b in pairwise(values))
    if inc:
        return "clock", 1
    if dec:
        return "clock", -1
    return "duration", 0


def _detect(turns: list[ParsedTurn], preferred: Direction | None) -> tuple[list[Signal], float]:
    signals: list[Signal] = []

    # 1. Связность «вопрос тьютора → следующий ответ ученика».
    forward = _qa_score(turns)
    backward = _qa_score(list(reversed(turns)))
    total = forward + backward
    if total > 0.05:
        diff = (forward - backward) / total
        vote = 1 if diff > 0 else -1 if diff < 0 else 0
        strength = min(1.0, abs(diff) * 3)
        signals.append(
            Signal(
                "qa_coherence",
                vote,
                2.0,
                strength,
                f"Связность вопрос→ответ: прямой порядок {forward:.2f}, обратный {backward:.2f}.",
            )
        )
    else:
        signals.append(Signal("qa_coherence", 0, 2.0, 0.0, "Недостаточно пар вопрос→ответ."))

    # 2. Приветствие и завершение на краях документа.
    top, bottom = _edge_texts(turns, True), _edge_texts(turns, False)
    g_top, g_bottom = bool(_GREETING_RE.search(top)), bool(_GREETING_RE.search(bottom))
    if g_top != g_bottom:
        vote = 1 if g_top else -1
        where = "в начале" if g_top else "в конце"
        signals.append(Signal("greeting_edge", vote, 1.5, 1.0, f"Приветствие {where} документа."))
    c_top, c_bottom = bool(_CLOSING_RE.search(top)), bool(_CLOSING_RE.search(bottom))
    if c_top != c_bottom:
        vote = -1 if c_top else 1
        where = "в начале" if c_top else "в конце"
        signals.append(Signal("closing_edge", vote, 1.5, 1.0, f"Завершение разговора {where} документа."))

    # 3. Метки времени — слабый сигнал, только если монотонны.
    kind, mono = _timestamp_kind(turns)
    if kind == "clock":
        signals.append(
            Signal("timestamps", mono, 1.0, 1.0, "Метки времени монотонно " + ("растут." if mono > 0 else "убывают."))
        )
    elif kind == "duration":
        signals.append(
            Signal(
                "timestamps",
                0,
                1.0,
                0.0,
                "Метки не монотонны — это длительность сообщений, для порядка не используются.",
            )
        )

    # 4. Предпочтение пользователя — слабый априорный сигнал.
    if preferred is not None:
        signals.append(
            Signal(
                "user_preference",
                1 if preferred == "chronological" else -1,
                0.5,
                1.0,
                "Сохранённый формат пользователя.",
            )
        )

    score = sum(s.vote * s.weight * s.strength for s in signals)
    return signals, score


# --------------------------------------------------------------------------- #
# Публичная функция
# --------------------------------------------------------------------------- #


def parse_transcript(
    raw: str,
    order: Order = "auto",
    preferred: Direction | None = None,
) -> ParseResult:
    warnings: list[str] = []
    elements, removed = _tokenize(raw)
    meta = _extract_meta(elements, removed)
    file_turns = _build_turns(elements, warnings)

    signals, score = _detect(file_turns, preferred)
    evidence_weight = sum(s.weight for s in signals if s.vote != 0 and s.name != "user_preference")
    raw_conf = abs(score) / max(evidence_weight + 0.5, 1.0)
    confidence = round(min(1.0, raw_conf), 2)
    detected: Direction = "chronological" if score > 0 else "reverse" if score < 0 else (preferred or "reverse")
    label: Literal["high", "medium", "low"] = "high" if confidence >= 0.6 else "medium" if confidence >= 0.3 else "low"

    # Сохранять без явного подтверждения можно только при высокой уверенности.
    needs_confirmation = label != "high"
    content_votes = [s for s in signals if s.vote != 0 and s.name != "user_preference"]
    if preferred is not None and content_votes:
        content_score = sum(s.vote * s.weight * s.strength for s in content_votes)
        content_dir = "chronological" if content_score > 0 else "reverse"
        if content_dir != preferred and abs(content_score) >= 1.0:
            needs_confirmation = True
            warnings.append("Порядок отличается от вашего обычного формата — проверьте предпросмотр.")

    if order == "auto":
        applied: Direction = detected
    else:
        applied = order
        if order != detected:
            needs_confirmation = True
        if order != detected and label != "low":
            warnings.append(
                "Выбран порядок «"
                + ("обратный" if order == "reverse" else "прямой")
                + "», но сигналы указывают на другой. Проверьте предпросмотр."
            )

    chrono = list(reversed(file_turns)) if applied == "reverse" else list(file_turns)
    for idx, t in enumerate(chrono):
        t.index = idx

    # Пропущенная реплика тьютора: следующий ответ ученика без вопроса.
    for k, t in enumerate(chrono):
        if "missing_text" in t.flags and k + 1 < len(chrono) and chrono[k + 1].role == "learner":
            chrono[k + 1].flags.append("question_missing")

    collapsed = sum(1 for t in chrono if "collapsed" in t.flags)
    if collapsed:
        warnings.append(
            f"Свёрнутых реплик тьютора («Показать текст»): {collapsed}. Их текст не попал в копию, "
            "ответы ученика после них будут оцениваться без вопроса. Совет: раскрывайте реплики перед копированием."
        )
    inferred = sum(1 for t in chrono if "role_inferred" in t.flags)
    if inferred:
        needs_confirmation = True
        warnings.append(
            f"Роль ученика определена по чередованию реплик (без меток времени): {inferred}. Проверьте роли."
        )
    unknown = sum(1 for t in chrono if t.role == "unknown")
    if unknown:
        needs_confirmation = True
        warnings.append(f"Реплик с неопределённой ролью: {unknown}. Укажите роль в предпросмотре.")
    for t in chrono:
        if t.text and markers.is_cyrillic_meta(t.text):
            t.flags.append("russian_text")

    kind, _ = _timestamp_kind(file_turns)
    learner_turns = [t for t in chrono if t.role == "learner"]
    tutor_turns = [t for t in chrono if t.role == "tutor"]
    durations = [t.duration_sec for t in learner_turns if t.duration_sec is not None]
    learner_words = sum(len(re.findall(r"[A-Za-z][A-Za-z'’-]*", t.text)) for t in learner_turns)

    stats: dict[str, float | int | None] = {
        "turns_total": len(chrono),
        "learner_turns": len(learner_turns),
        "tutor_turns": len(tutor_turns),
        "unknown_turns": unknown,
        "collapsed_tutor_turns": collapsed,
        "learner_words": learner_words,
        "learner_speech_seconds": sum(durations) if kind == "duration" and durations else None,
        "removed_lines": len(removed),
    }

    return ParseResult(
        parser_version=PARSER_VERSION,
        requested_order=order,
        detected_direction=detected,
        applied_direction=applied,
        confidence=confidence,
        confidence_label=label,
        needs_confirmation=needs_confirmation,
        signals=signals,
        turns=chrono,
        scenario_title=meta[0] if meta else None,
        meta_lines=meta,
        removed=sorted(removed, key=lambda r: r.line),
        warnings=warnings,
        timestamp_kind=kind,
        stats=stats,
    )
