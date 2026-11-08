# English Interview Analyst

Личная платформа для разбора занятий английским с AI-тьютором и подготовки к собеседованиям на Middle Data Analyst.

## Статус

Этап 1 (прототип), срез 1 из 4 — **приём и нормализация занятий**.

Что работает:

- вставка расшифровки как есть, из приложения тьютора;
- автоопределение порядка (обратный / прямой) по нескольким сигналам с оценкой уверенности;
- удаление служебных надписей («Скрыть текст», «Сменить роль», «16 мин» и т. п.), выделение заголовка сценария;
- роли «вы / AI», свёрнутые реплики тьютора («Показать текст»), метки длительности голосовых;
- предпросмотр с ручной правкой ролей и переворотом порядка; подтверждение, если уверенность не высокая;
- сохранение: оригинал неизменен (триггер в БД), нормализованные реплики отдельно, история, удаление;
- светлая/тёмная тема, desktop / tablet / mobile.

Чего пока нет: AI-анализа ошибок, карточек ошибок, упражнений, отчётов, авторизации. План — в [docs/roadmap.md](docs/roadmap.md).

## Временная версия в Claude

Пока сервер не развёрнут, сервисом можно пользоваться как артефактом Claude — с AI-анализом через ваш аккаунт: https://claude.ai/artifact/U14QWBTwJqvoGV75mbfYhR. Код и устройство — [artifact/README.md](artifact/README.md).

## Быстрый старт (Docker)

Нужен Docker Desktop.

```bash
git clone git@github.com:projectbyrybakov/english_AI_analysator.git
cd english_AI_analysator
cp .env.example .env          # поменяйте POSTGRES_PASSWORD
docker compose up --build
```

Откройте http://localhost:3000. API и документация Swagger: http://localhost:8000/docs.

## Запуск без Docker (для разработки)

Нужны Python 3.12+, Node.js 22+, PostgreSQL 16.

```bash
# база
createdb eia

# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
export DATABASE_URL=postgresql+psycopg://$USER@localhost:5432/eia
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# frontend (в другом терминале)
cd frontend
npm ci
BACKEND_URL=http://localhost:8000 npm run dev
```

## Проверки

```bash
# backend: линтер, типы, тесты (интеграционные — на отдельной тестовой БД, она очищается)
cd backend
ruff check . && ruff format --check . && mypy app
createdb eia_test
TEST_DATABASE_URL=postgresql+psycopg://$USER@localhost:5432/eia_test pytest -q

# frontend
cd frontend && npm run lint && npm run typecheck && npm run build

# e2e в браузере (backend и frontend должны быть запущены)
pip install pytest playwright && python -m playwright install chromium
pytest -q e2e
```

Свои реальные занятия можно прогнать через тесты парсера локально, не добавляя их в репозиторий:

```bash
PRIVATE_FIXTURES_DIR=~/english-lessons pytest -q tests/test_parser.py
```

## Структура

```
backend/      FastAPI, SQLAlchemy, Alembic; парсер в app/parser
frontend/     Next.js (App Router, TypeScript)
e2e/          браузерные тесты Playwright
docs/         архитектура, парсер, API, ADR, требования к нейросети, бэкапы
```

## Приватность

- В репозитории только синтетические примеры. Реальные занятия, `.env`, дампы БД в git не попадают (`.gitignore`).
- Расшифровка — это данные, а не инструкции: в срезе 2 она будет передаваться модели только как данные.
- Ключи API будут храниться только на сервере.

## Документация

- [Архитектура](docs/architecture.md)
- [Парсер расшифровок](docs/parser.md)
- [API](docs/api.md)
- [Требования к нейросети](docs/llm-requirements.md)
- [Бэкап и восстановление](docs/backup.md)
- [Решения (ADR)](docs/adr/)
- [План разработки](docs/roadmap.md)
- [CHANGELOG](CHANGELOG.md)
