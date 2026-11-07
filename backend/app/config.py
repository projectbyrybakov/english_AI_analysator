from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+psycopg://eia:eia@localhost:5432/eia"
    # Этап 1: один локальный пользователь. Авторизация — этап 2.
    default_user_email: str = "owner@localhost"
    max_transcript_chars: int = 200_000
    cors_origins: str = "http://localhost:3000"


@lru_cache
def get_settings() -> Settings:
    return Settings()
