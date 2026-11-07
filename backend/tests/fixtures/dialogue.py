"""Синтетический диалог (вымышленный кандидат и компания) и генераторы форматов.

Хронологический порядок. Роль "collapsed" — свёрнутая реплика тьютора.
Ни одной реальной записи пользователя в репозитории нет.
"""

from __future__ import annotations

DIALOGUE: list[tuple[str, str | None, str]] = [
    (
        "tutor",
        None,
        "Hi, nice to meet you. I'll be your interviewer today for a data analyst position. "
        "Could you tell me a little about yourself?",
    ),
    (
        "learner",
        "01:12",
        "Hello. Yes, of course. I am working as a junior analyst in Northwind Delivery since 2023. "
        "I... I make reports in SQL and Tablo for the operations team.",
    ),
    (
        "tutor",
        None,
        "Thanks, that is a clear introduction. Which reports did you build for the operations team, and who used them?",
    ),
    (
        "learner",
        "01:45",
        "We built a daily report about late deliveries. The operations managers used this report "
        "every morning, and they, they decided which couriers need help.",
    ),
    (
        "tutor",
        None,
        "Good, that sounds useful. How did you calculate the late delivery rate, and how did you "
        "check the data quality?",
    ),
    (
        "learner",
        "02:03",
        "I calculated late deliveries divided by all deliveries for each day. For data quality "
        "I compared the numbers with the courier app and I find some duplicates.",
    ),
    ("collapsed", None, ""),
    (
        "learner",
        "00:58",
        "The duplicates was because the app sent the same event two times. We removed them with a window function.",
    ),
    (
        "tutor",
        None,
        "Nice, using a window function to remove duplicates is a good practice. "
        "What was the business impact of the report?",
    ),
    (
        "learner",
        "01:31",
        "After three months the late delivery rate decreased. I don't remember the exact number, maybe ten percent.",
    ),
    (
        "tutor",
        None,
        "That is honest. In an interview, it is better to say you will confirm the exact figure. "
        "Do you want to continue or finish here?",
    ),
    ("learner", "00:19", "Can we finish here and can you give me a short summary?"),
    (
        "tutor",
        None,
        "Sure. Short summary: you described your junior analyst role, a daily late delivery report, "
        "data quality checks and a window function for duplicates.",
    ),
]

HEADER = [
    "",
    "Сменить роль",
    "",
    "12 мин",
    "",
    "собеседование в международную компанию на аналитика данных",
    "В любой момент можно сменить роль",
    "— кнопка вверху экрана.",
    "",
    "",
]
FOOTER = ["", "", "", "Просто говорите – не бойтесь ошибиться", ""]


def _block(role: str, ts: str | None, text: str, with_timestamps: bool) -> list[str]:
    if role == "collapsed":
        return ["Показать текст", "", "", "", ""]
    if role == "tutor":
        return [text, "Скрыть текст", "", "", ""]
    lines = [ts] if (ts and with_timestamps) else []
    return [*lines, text, "", "", "", ""]


def render_app(reverse: bool, with_timestamps: bool = True) -> str:
    """Формат копирования из приложения тьютора: прямой или обратный порядок."""
    turns = list(reversed(DIALOGUE)) if reverse else DIALOGUE
    body: list[str] = []
    for role, ts, text in turns:
        body.extend(_block(role, ts, text, with_timestamps))
    return "\n".join([*HEADER, *body, *FOOTER])


def render_prefixed() -> str:
    """Ручная разметка «Tutor: / Me:», хронологический порядок, без меток времени."""
    lines = []
    for role, _ts, text in DIALOGUE:
        if role == "collapsed":
            continue
        prefix = "Tutor" if role == "tutor" else "Me"
        lines.append(f"{prefix}: {text}")
    return "\n".join(lines)


def learner_texts() -> list[str]:
    return [text for role, _ts, text in DIALOGUE if role == "learner"]
