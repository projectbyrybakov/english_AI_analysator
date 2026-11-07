# API

Интерактивная документация: http://localhost:8000/docs (Swagger), схема — `/openapi.json`.

| Метод | Путь | Назначение |
| --- | --- | --- |
| GET | `/api/health` | проверка работы |
| POST | `/api/transcripts/preview` | разобрать текст без сохранения. Тело: `raw_text`, `order` (`auto` / `reverse` / `chronological`). Ответ: реплики в хронологическом порядке, сигналы, уверенность, предупреждения, статистика, `duplicate_of` |
| POST | `/api/sessions` | сохранить занятие. Тело: `raw_text`, `order`, `confirmed`, `title`, `lesson_date`, `user_role`, `market`, `role_overrides` (`{номер: роль}`), `allow_duplicate` |
| GET | `/api/sessions` | список занятий |
| GET | `/api/sessions/{id}` | занятие с репликами |
| GET | `/api/sessions/{id}/source` | исходный текст без изменений и sha256 |
| DELETE | `/api/sessions/{id}` | удалить занятие вместе с исходником и репликами |
| GET / PATCH | `/api/settings` | настройки: `preferred_order`, `feedback_language`, `disfluency_analysis_enabled` |

Коды ошибок `POST /api/sessions`:

- 409 — порядок требует подтверждения (`confirmed: true`) или такой текст уже сохранён (`allow_duplicate: true`, чтобы сохранить повторно);
- 413 — текст длиннее `MAX_TRANSCRIPT_CHARS` (по умолчанию 200 000);
- 422 — остались реплики с ролью `unknown` или неверные номера в `role_overrides`.
