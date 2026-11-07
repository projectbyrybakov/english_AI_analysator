from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Role = Literal["learner", "tutor", "unknown"]
UserRole = Literal["candidate", "interviewer", "coach", "observer", "free"]
Market = Literal["cis", "international"]
OrderIn = Literal["auto", "reverse", "chronological"]
Direction = Literal["reverse", "chronological"]


class PreviewRequest(BaseModel):
    raw_text: str = Field(min_length=1)
    order: OrderIn = "auto"


class SignalOut(BaseModel):
    name: str
    vote: int
    weight: float
    strength: float
    detail: str


class TurnOut(BaseModel):
    index: int
    role: Role
    text: str
    word_count: int
    duration_sec: int | None
    raw_timestamp: str | None
    line_start: int
    line_end: int
    flags: list[str]


class RemovedOut(BaseModel):
    line: int
    text: str
    reason: str


class PreviewResponse(BaseModel):
    parser_version: str
    requested_order: OrderIn
    detected_direction: Direction
    applied_direction: Direction
    confidence: float
    confidence_label: Literal["high", "medium", "low"]
    needs_confirmation: bool
    signals: list[SignalOut]
    turns: list[TurnOut]
    scenario_title: str | None
    meta_lines: list[str]
    removed: list[RemovedOut]
    warnings: list[str]
    timestamp_kind: str
    stats: dict[str, float | int | None]
    duplicate_of: uuid.UUID | None = None


class CreateSessionRequest(BaseModel):
    raw_text: str = Field(min_length=1)
    order: Direction
    confirmed: bool = False
    title: str | None = Field(default=None, max_length=200)
    lesson_date: date | None = None
    user_role: UserRole = "candidate"
    market: Market | None = None
    scenario_type: str | None = Field(default=None, max_length=50)
    role_overrides: dict[int, Role] = Field(default_factory=dict)
    allow_duplicate: bool = False


class SessionTurnOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    idx: int
    role: str
    text: str
    word_count: int
    duration_sec: int | None
    raw_timestamp: str | None
    source_line_start: int
    source_line_end: int
    flags: list[str]
    role_overridden: bool


class SessionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    lesson_date: date | None
    scenario_title: str | None
    user_role: str
    market: str | None
    status: str
    applied_direction: str
    parse_confidence: float
    stats: dict[str, float | int | None]
    created_at: datetime


class SessionDetail(SessionSummary):
    detected_direction: str
    parser_version: str
    normalization_version: int
    warnings: list[str]
    turns: list[SessionTurnOut]
    source_sha256: str
    source_char_count: int


class SourceOut(BaseModel):
    session_id: uuid.UUID
    raw_text: str
    sha256: str
    char_count: int
    created_at: datetime


class SettingsOut(BaseModel):
    preferred_order: Direction | None
    feedback_language: str
    disfluency_analysis_enabled: bool


class SettingsUpdate(BaseModel):
    preferred_order: Direction | None = None
    feedback_language: Literal["ru", "en", "mixed"] | None = None
    disfluency_analysis_enabled: bool | None = None
