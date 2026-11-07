from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from .config import get_settings

_engine: Engine | None = None
_factory: sessionmaker[Session] | None = None


def get_engine() -> Engine:
    global _engine, _factory
    if _engine is None:
        _engine = create_engine(get_settings().database_url, pool_pre_ping=True)
        _factory = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def reset_engine() -> None:
    """Для тестов: пересоздать подключение после смены DATABASE_URL."""
    global _engine, _factory
    if _engine is not None:
        _engine.dispose()
    _engine, _factory = None, None


def get_db() -> Iterator[Session]:
    get_engine()
    assert _factory is not None
    db = _factory()
    try:
        yield db
    finally:
        db.close()
