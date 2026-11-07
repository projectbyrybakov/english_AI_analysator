from __future__ import annotations

import os
from collections.abc import Iterator

import pytest

TEST_DB = os.environ.get("TEST_DATABASE_URL")


@pytest.fixture(scope="session")
def migrated_db() -> Iterator[str]:
    if not TEST_DB:
        pytest.skip("TEST_DATABASE_URL не задан — интеграционные тесты пропущены")
    os.environ["DATABASE_URL"] = TEST_DB
    from alembic.config import Config
    from sqlalchemy import create_engine, text

    from alembic import command
    from app.config import get_settings
    from app.db import reset_engine

    get_settings.cache_clear()
    reset_engine()
    engine = create_engine(TEST_DB)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    engine.dispose()

    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "alembic"))
    command.upgrade(cfg, "head")
    yield TEST_DB


@pytest.fixture()
def client(migrated_db: str):
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine, text

    from app.main import create_app

    engine = create_engine(migrated_db)
    with engine.begin() as conn:
        conn.execute(
            text("TRUNCATE audit_events, session_turns, session_sources, sessions, user_profiles, users CASCADE")
        )
    engine.dispose()
    with TestClient(create_app()) as c:
        yield c
