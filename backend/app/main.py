from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes import router
from .config import get_settings


def create_app() -> FastAPI:
    app = FastAPI(title="English Interview Analyst API", version="0.1.0")
    origins = [o.strip() for o in get_settings().cors_origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["*"]
    )
    app.include_router(router)
    return app


app = create_app()
