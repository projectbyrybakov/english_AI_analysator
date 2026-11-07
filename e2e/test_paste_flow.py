"""E2E: вставка → предпросмотр → сохранение → карточка занятия → удаление.

Запуск (нужны запущенные backend и frontend):
    pip install pytest playwright && python -m playwright install chromium
    E2E_BASE_URL=http://localhost:3000 pytest e2e -q
Скриншоты сохраняются в e2e/screenshots/ (в .gitignore).
"""

from __future__ import annotations

import os
import re
from pathlib import Path

import pytest
from playwright.sync_api import Page, expect, sync_playwright

BASE = os.environ.get("E2E_BASE_URL", "http://localhost:3000")
FIXTURE = Path(__file__).parents[1] / "backend" / "tests" / "fixtures" / "app_reverse_synthetic.txt"
SHOTS = Path(__file__).parent / "screenshots"
VIEWPORTS = {"desktop": (1440, 900), "tablet": (820, 1180), "mobile": (390, 844)}


@pytest.fixture(scope="module")
def browser():
    channel = os.environ.get("E2E_BROWSER_CHANNEL")  # например, "chrome"
    with sync_playwright() as p:
        b = p.chromium.launch(channel=channel) if channel else p.chromium.launch()
        yield b
        b.close()


def _paste_and_save(page: Page, raw: str) -> str:
    page.goto(f"{BASE}/sessions/new")
    page.get_by_label("Текст расшифровки").fill(raw)
    page.get_by_role("button", name="Разобрать").click()
    expect(page.get_by_text("Диалог по порядку")).to_be_visible()
    # Первая реплика в хронологии — приветствие интервьюера.
    first = page.locator("article.turn").first
    expect(first).to_contain_text("Hi, nice to meet you")
    expect(page.locator("article.turn").last).to_contain_text("Short summary")
    expect(page.get_by_text("Свёрнутых реплик тьютора")).to_be_visible()
    page.get_by_role("button", name="Сохранить занятие").click()
    page.wait_for_url(re.compile(r".*/sessions/[0-9a-f-]{36}$"))
    expect(page.get_by_role("heading", name="Диалог", exact=True)).to_be_visible()
    return page.url


@pytest.mark.parametrize("name", list(VIEWPORTS))
def test_paste_preview_save_delete(browser, name):
    SHOTS.mkdir(exist_ok=True)
    w, h = VIEWPORTS[name]
    page = browser.new_page(viewport={"width": w, "height": h})
    raw = FIXTURE.read_text(encoding="utf-8")

    # Дубликат с прошлого прогона мешает сохранению — удаляем заранее.
    for s in page.request.get(f"{BASE}/api/sessions").json():
        page.request.delete(f"{BASE}/api/sessions/{s['id']}")

    url = _paste_and_save(page, raw)
    page.screenshot(path=str(SHOTS / f"session-{name}.png"), full_page=False)

    # Оригинал доступен без изменений.
    page.get_by_text("Показать оригинал без изменений").click()
    expect(page.locator("pre.source")).to_contain_text("Скрыть текст")

    # История сохраняется: занятие видно в списке после перезагрузки.
    page.goto(f"{BASE}/sessions")
    expect(page.get_by_text("собеседование в международную компанию")).to_be_visible()

    page.goto(url)
    page.get_by_role("button", name="Удалить занятие").click()
    page.get_by_role("button", name="Да, удалить").click()
    page.wait_for_url(re.compile(r".*/sessions$"))
    expect(page.get_by_text("Пока нет ни одного занятия")).to_be_visible()
    page.close()


def test_preview_screenshot_and_dark_theme(browser):
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto(f"{BASE}/sessions/new")
    page.get_by_label("Текст расшифровки").fill(FIXTURE.read_text(encoding="utf-8"))
    page.get_by_role("button", name="Разобрать").click()
    expect(page.get_by_text("Диалог по порядку")).to_be_visible()
    page.screenshot(path=str(SHOTS / "preview-desktop.png"), full_page=False)
    page.get_by_role("button", name="Переключить тему").click()
    expect(page.locator("html")).to_have_attribute("data-theme", "dark")
    page.screenshot(path=str(SHOTS / "preview-dark.png"), full_page=False)
    page.close()
