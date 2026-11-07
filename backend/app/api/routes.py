from __future__ import annotations

import uuid
from dataclasses import asdict
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .. import models, schemas, services
from ..config import get_settings
from ..db import get_db
from ..parser.transcript import ParseResult, parse_transcript

router = APIRouter(prefix="/api")


def current_user(db: Session = Depends(get_db)) -> models.User:
    return services.get_or_create_owner(db)


def _preferred(user: models.User) -> schemas.Direction | None:
    value = user.profile.preferred_order if user.profile else None
    if value == "reverse":
        return "reverse"
    if value == "chronological":
        return "chronological"
    return None


def _check_size(raw: str) -> None:
    limit = get_settings().max_transcript_chars
    if len(raw) > limit:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, f"Текст длиннее {limit} символов.")


def _preview_out(parsed: ParseResult, duplicate_of: uuid.UUID | None) -> schemas.PreviewResponse:
    data = asdict(parsed)
    for t in data["turns"]:
        t["word_count"] = services.word_count(t["text"])
    return schemas.PreviewResponse(**data, duplicate_of=duplicate_of)


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/transcripts/preview", response_model=schemas.PreviewResponse)
def preview(
    body: schemas.PreviewRequest,
    db: Session = Depends(get_db),
    user: models.User = Depends(current_user),
) -> schemas.PreviewResponse:
    _check_size(body.raw_text)
    preferred = _preferred(user)
    parsed = parse_transcript(body.raw_text, order=body.order, preferred=preferred)
    return _preview_out(parsed, services.find_duplicate(db, user.id, body.raw_text))


@router.post("/sessions", response_model=schemas.SessionDetail, status_code=status.HTTP_201_CREATED)
def create_session(
    body: schemas.CreateSessionRequest,
    db: Session = Depends(get_db),
    user: models.User = Depends(current_user),
) -> schemas.SessionDetail:
    _check_size(body.raw_text)
    preferred = _preferred(user)

    auto = parse_transcript(body.raw_text, order="auto", preferred=preferred)
    if (auto.needs_confirmation or auto.detected_direction != body.order) and not body.confirmed:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Порядок реплик определён неуверенно или отличается от выбранного. "
            "Проверьте предпросмотр и подтвердите порядок.",
        )

    duplicate = services.find_duplicate(db, user.id, body.raw_text)
    if duplicate and not body.allow_duplicate:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Это занятие уже сохранено: {duplicate}")

    parsed = parse_transcript(body.raw_text, order=body.order, preferred=preferred)
    max_idx = len(parsed.turns) - 1
    bad = [i for i in body.role_overrides if i < 0 or i > max_idx]
    if bad:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Нет реплик с номерами {bad}.")
    final_roles = [body.role_overrides.get(t.index, t.role) for t in parsed.turns]
    if "unknown" in final_roles:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Укажите роль для всех реплик перед сохранением.")

    session = models.LessonSession(
        user_id=user.id,
        title=body.title or parsed.scenario_title or f"Занятие {body.lesson_date or date.today():%d.%m.%Y}",
        lesson_date=body.lesson_date,
        scenario_title=parsed.scenario_title,
        scenario_type=body.scenario_type,
        user_role=body.user_role,
        market=body.market,
        status="parsed",
        detected_direction=auto.detected_direction,
        applied_direction=parsed.applied_direction,
        parse_confidence=auto.confidence,
        parser_version=parsed.parser_version,
        stats=parsed.stats,
        warnings=parsed.warnings,
    )
    db.add(session)
    db.flush()
    db.add(
        models.SessionSource(
            session_id=session.id,
            user_id=user.id,
            raw_text=body.raw_text,
            sha256=services.sha256(body.raw_text),
            char_count=len(body.raw_text),
        )
    )
    db.add_all(services.build_turn_rows(parsed, session.id, user.id, body.role_overrides))
    if user.profile is not None:
        user.profile.preferred_order = parsed.applied_direction
    services.audit(db, user.id, "session.created", session.id, order=parsed.applied_direction)
    db.commit()
    return _detail(db, user, session.id)


def _load(db: Session, user: models.User, session_id: uuid.UUID) -> models.LessonSession:
    session = db.scalar(
        select(models.LessonSession)
        .options(selectinload(models.LessonSession.turns), selectinload(models.LessonSession.source))
        .where(models.LessonSession.id == session_id, models.LessonSession.user_id == user.id)
    )
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Занятие не найдено.")
    return session


def _detail(db: Session, user: models.User, session_id: uuid.UUID) -> schemas.SessionDetail:
    s = _load(db, user, session_id)
    turns = [t for t in s.turns if t.version == s.normalization_version]
    return schemas.SessionDetail(
        **schemas.SessionSummary.model_validate(s).model_dump(),
        detected_direction=s.detected_direction,
        parser_version=s.parser_version,
        normalization_version=s.normalization_version,
        warnings=s.warnings,
        turns=[schemas.SessionTurnOut.model_validate(t) for t in turns],
        source_sha256=s.source.sha256,
        source_char_count=s.source.char_count,
    )


@router.get("/sessions", response_model=list[schemas.SessionSummary])
def list_sessions(
    db: Session = Depends(get_db), user: models.User = Depends(current_user)
) -> list[models.LessonSession]:
    rows = db.scalars(
        select(models.LessonSession)
        .where(models.LessonSession.user_id == user.id)
        .order_by(models.LessonSession.lesson_date.desc().nulls_last(), models.LessonSession.created_at.desc())
    )
    return list(rows)


@router.get("/sessions/{session_id}", response_model=schemas.SessionDetail)
def get_session(
    session_id: uuid.UUID, db: Session = Depends(get_db), user: models.User = Depends(current_user)
) -> schemas.SessionDetail:
    return _detail(db, user, session_id)


@router.get("/sessions/{session_id}/source", response_model=schemas.SourceOut)
def get_source(
    session_id: uuid.UUID, db: Session = Depends(get_db), user: models.User = Depends(current_user)
) -> schemas.SourceOut:
    s = _load(db, user, session_id)
    src = s.source
    return schemas.SourceOut(
        session_id=s.id, raw_text=src.raw_text, sha256=src.sha256, char_count=src.char_count, created_at=src.created_at
    )


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(
    session_id: uuid.UUID, db: Session = Depends(get_db), user: models.User = Depends(current_user)
) -> Response:
    s = _load(db, user, session_id)
    db.delete(s)
    services.audit(db, user.id, "session.deleted", session_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/settings", response_model=schemas.SettingsOut)
def get_user_settings(user: models.User = Depends(current_user)) -> schemas.SettingsOut:
    p = user.profile
    return schemas.SettingsOut(
        preferred_order=_preferred(user),
        feedback_language=p.feedback_language,
        disfluency_analysis_enabled=p.disfluency_analysis_enabled,
    )


@router.patch("/settings", response_model=schemas.SettingsOut)
def update_settings(
    body: schemas.SettingsUpdate, db: Session = Depends(get_db), user: models.User = Depends(current_user)
) -> schemas.SettingsOut:
    p = user.profile
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(p, key, value)
    db.commit()
    return get_user_settings(user)
