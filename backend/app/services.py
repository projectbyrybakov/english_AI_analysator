from __future__ import annotations

import hashlib
import re
import uuid
from collections.abc import Mapping

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models
from .config import get_settings
from .parser.transcript import ParseResult

_WORD_RE = re.compile(r"[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё'’-]*")


def word_count(text: str) -> int:
    return len(_WORD_RE.findall(text))


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def get_or_create_owner(db: Session) -> models.User:
    """Этап 1: единственный локальный пользователь. Этап 2 заменит это авторизацией."""
    email = get_settings().default_user_email
    user = db.scalar(select(models.User).where(models.User.email == email))
    if user is None:
        user = models.User(email=email)
        user.profile = models.UserProfile()
        db.add(user)
        db.commit()
        db.refresh(user)
    elif user.profile is None:
        user.profile = models.UserProfile()
        db.commit()
    return user


def find_duplicate(db: Session, user_id: uuid.UUID, raw_text: str) -> uuid.UUID | None:
    return db.scalar(
        select(models.SessionSource.session_id).where(
            models.SessionSource.user_id == user_id, models.SessionSource.sha256 == sha256(raw_text)
        )
    )


def audit(db: Session, user_id: uuid.UUID | None, event: str, entity_id: uuid.UUID | None, **payload: object) -> None:
    db.add(models.AuditEvent(user_id=user_id, event=event, entity_id=entity_id, payload=payload))


def build_turn_rows(
    parsed: ParseResult, session_id: uuid.UUID, user_id: uuid.UUID, overrides: Mapping[int, str]
) -> list[models.SessionTurn]:
    rows = []
    for t in parsed.turns:
        role = overrides.get(t.index, t.role)
        rows.append(
            models.SessionTurn(
                session_id=session_id,
                user_id=user_id,
                version=1,
                idx=t.index,
                role=role,
                text=t.text,
                word_count=word_count(t.text),
                duration_sec=t.duration_sec,
                raw_timestamp=t.raw_timestamp,
                source_line_start=t.line_start,
                source_line_end=t.line_end,
                flags=list(t.flags),
                role_overridden=t.index in overrides and overrides[t.index] != t.role,
            )
        )
    return rows
