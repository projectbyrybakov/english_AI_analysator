"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { TurnView } from "@/components/TurnView";
import {
  api,
  CONFIDENCE_LABEL,
  DIRECTION_LABEL,
  formatDate,
  formatSeconds,
  type SessionDetail,
  USER_ROLE_LABEL,
} from "@/lib/api";

const MARKET_LABEL = { cis: "СНГ", international: "международный" } as const;

function confidenceLabel(value: number) {
  return value >= 0.6 ? CONFIDENCE_LABEL.high : value >= 0.3 ? CONFIDENCE_LABEL.medium : CONFIDENCE_LABEL.low;
}

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    api
      .getSession(id)
      .then(setSession)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  async function loadSource() {
    if (source !== null) return;
    const s = await api.getSource(id);
    setSource(s.raw_text);
  }

  async function remove() {
    await api.deleteSession(id);
    router.push("/sessions");
  }

  if (error)
    return (
      <div className="error" role="alert">
        {error}
      </div>
    );
  if (!session) return <p className="muted">Загрузка…</p>;

  const st = session.stats;
  const learnerTurns = session.turns.filter((t) => t.role === "learner");
  const avgWords = learnerTurns.length ? Math.round((st.learner_words ?? 0) / learnerTurns.length) : 0;

  return (
    <div className="stack">
      <header className="stack" style={{ gap: 6 }}>
        <h1>{session.title}</h1>
        <div className="row muted" style={{ fontSize: "0.95rem" }}>
          <span>{formatDate(session.lesson_date)}</span>
          <span>·</span>
          <span>{USER_ROLE_LABEL[session.user_role]}</span>
          {session.market && (
            <>
              <span>·</span>
              <span>рынок: {MARKET_LABEL[session.market]}</span>
            </>
          )}
          <span className="chip">разобрано, анализа ещё нет</span>
        </div>
      </header>

      <div className="layout-report">
        <nav className="toc" aria-label="Оглавление">
          <a href="#overview">1. Обзор</a>
          <a href="#conversation">2. Диалог</a>
          <a href="#source">3. Исходный текст</a>
          <a href="#method">4. Как это посчитано</a>
        </nav>

        <div className="stack">
          <section id="overview" aria-labelledby="overview-h" className="stack">
            <h2 id="overview-h" style={{ marginTop: 0 }}>
              Обзор
            </h2>
            <p style={{ margin: 0 }}>
              Занятие сохранено и разобрано на реплики. Языковой анализ (ошибки, исправления, интервью-оценка)
              появится в следующем срезе разработки — для него ещё не выбрана нейросеть.
            </p>
            <div className="grid-stats">
              <div className="card stat">
                <div className="label">Ваших реплик</div>
                <div className="value">{st.learner_turns}</div>
              </div>
              <div className="card stat">
                <div className="label">Ваших слов</div>
                <div className="value">{st.learner_words}</div>
                <div className="note">в среднем {avgWords} на реплику</div>
              </div>
              <div className="card stat">
                <div className="label">Ваши голосовые</div>
                <div className="value" style={{ fontSize: "1.1rem" }}>
                  {formatSeconds(st.learner_speech_seconds)}
                </div>
                <div className="note">сумма длительностей сообщений</div>
              </div>
              <div className="card stat">
                <div className="label">Реплик AI</div>
                <div className="value">{st.tutor_turns}</div>
                <div className="note">без текста: {st.collapsed_tutor_turns}</div>
              </div>
            </div>
            {session.warnings.length > 0 && (
              <div className="notice">
                <strong>Ограничения данных</strong>
                <ul>
                  {session.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section id="conversation" aria-labelledby="conv-h" className="stack">
            <h2 id="conv-h">Диалог</h2>
            {session.turns.map((t) => (
              <TurnView
                key={t.idx}
                id={`turn-${t.idx + 1}`}
                index={t.idx}
                role={t.role}
                text={t.text}
                durationSec={t.duration_sec}
                flags={t.role_overridden ? [...t.flags, "роль изменена вручную"] : t.flags}
                userRole={session.user_role}
                lines={[t.source_line_start, t.source_line_end]}
              />
            ))}
          </section>

          <section id="source" aria-labelledby="source-h" className="stack">
            <h2 id="source-h">Исходный текст</h2>
            <details onToggle={(e) => (e.currentTarget.open ? loadSource() : undefined)}>
              <summary>
                Показать оригинал без изменений ({session.source_char_count.toLocaleString("ru-RU")} символов)
              </summary>
              {source === null ? <p className="muted">Загрузка…</p> : <pre className="source">{source}</pre>}
            </details>
          </section>

          <section id="method" aria-labelledby="method-h" className="stack">
            <h2 id="method-h">Как это посчитано</h2>
            <ul style={{ margin: 0 }}>
              <li>
                Порядок в исходнике: {DIRECTION_LABEL[session.applied_direction]}; определён автоматически как{" "}
                {DIRECTION_LABEL[session.detected_direction]}, уверенность {confidenceLabel(session.parse_confidence)}{" "}
                ({session.parse_confidence.toFixed(2)}).
              </li>
              <li>Слова — последовательности букв, числа и знаки не считаются. Запинки и повторы не удаляются.</li>
              <li>
                Метки вида 02:49 — длительность голосового сообщения, а не время занятия; их сумма не равна
                длительности урока.
              </li>
              <li>
                Парсер {session.parser_version}, версия нормализации {session.normalization_version}. Контрольная
                сумма оригинала: <code>{session.source_sha256.slice(0, 12)}…</code>
              </li>
            </ul>
          </section>

          <section className="row" aria-label="Действия">
            {!confirmDelete ? (
              <button type="button" className="danger" onClick={() => setConfirmDelete(true)}>
                Удалить занятие
              </button>
            ) : (
              <>
                <span>Удалить занятие и исходный текст без возможности восстановления?</span>
                <button type="button" className="danger" onClick={remove}>
                  Да, удалить
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)}>
                  Отмена
                </button>
              </>
            )}
          </section>
        </div>
      </div>
      <a href="#top" className="button back-to-top">
        Наверх
      </a>
    </div>
  );
}
