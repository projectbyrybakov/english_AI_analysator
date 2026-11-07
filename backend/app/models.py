"""Модель данных этапа 1.

Остальные сущности ТЗ (раздел 18) добавляются миграциями в следующих срезах.
Все таблицы содержат user_id — база готова к нескольким пользователям.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _uuid() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def _created() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = _uuid()
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    created_at: Mapped[datetime] = _created()

    profile: Mapped[UserProfile] = relationship(back_populates="user", uselist=False)


class UserProfile(Base):
    __tablename__ = "user_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # Последний подтверждённый порядок расшифровки: reverse | chronological.
    preferred_order: Mapped[str | None] = mapped_column(String(20))
    feedback_language: Mapped[str] = mapped_column(String(10), default="ru", nullable=False)
    # ТЗ, раздел 8: анализ дисфлюентности можно полностью отключить. По умолчанию выключен.
    disfluency_analysis_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(back_populates="profile")


class LessonSession(Base):
    __tablename__ = "sessions"
    __table_args__ = (Index("ix_sessions_user_created", "user_id", "created_at"),)

    id: Mapped[uuid.UUID] = _uuid()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    lesson_date: Mapped[date | None] = mapped_column(Date)
    scenario_title: Mapped[str | None] = mapped_column(String(500))
    scenario_type: Mapped[str | None] = mapped_column(String(50))
    user_role: Mapped[str] = mapped_column(String(20), default="candidate", nullable=False)
    market: Mapped[str | None] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default="parsed", nullable=False)
    detected_direction: Mapped[str] = mapped_column(String(20), nullable=False)
    applied_direction: Mapped[str] = mapped_column(String(20), nullable=False)
    parse_confidence: Mapped[float] = mapped_column(Float, nullable=False)
    parser_version: Mapped[str] = mapped_column(String(20), nullable=False)
    normalization_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    stats: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)
    warnings: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    source: Mapped[SessionSource] = relationship(
        back_populates="session", uselist=False, cascade="all, delete-orphan", passive_deletes=True
    )
    turns: Mapped[list[SessionTurn]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="SessionTurn.idx",
    )


class SessionSource(Base):
    """Исходный текст занятия. Неизменяем: UPDATE запрещён триггером в БД."""

    __tablename__ = "session_sources"
    __table_args__ = (Index("ix_session_sources_user_sha", "user_id", "sha256"),)

    id: Mapped[uuid.UUID] = _uuid()
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    char_count: Mapped[int] = mapped_column(Integer, nullable=False)
    input_method: Mapped[str] = mapped_column(String(20), default="paste", nullable=False)
    created_at: Mapped[datetime] = _created()

    session: Mapped[LessonSession] = relationship(back_populates="source")


class SessionTurn(Base):
    """Нормализованная реплика. Версия позволяет перепарсить без потери старой."""

    __tablename__ = "session_turns"
    __table_args__ = (UniqueConstraint("session_id", "version", "idx", name="uq_turn_position"),)

    id: Mapped[uuid.UUID] = _uuid()
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    idx: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, nullable=False)
    duration_sec: Mapped[int | None] = mapped_column(Integer)
    raw_timestamp: Mapped[str | None] = mapped_column(String(20))
    source_line_start: Mapped[int] = mapped_column(Integer, nullable=False)
    source_line_end: Mapped[int] = mapped_column(Integer, nullable=False)
    flags: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    role_overridden: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = _created()

    session: Mapped[LessonSession] = relationship(back_populates="turns")


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[uuid.UUID] = _uuid()
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    event: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)
    created_at: Mapped[datetime] = _created()
