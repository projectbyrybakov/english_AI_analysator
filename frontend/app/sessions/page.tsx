"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api, formatDate, type SessionSummary } from "@/lib/api";

export default function SessionsPage() {
  const [items, setItems] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listSessions()
      .then(setItems)
      .catch((e: Error) => setError(e.message));
  }, []);

  const totalWords = items?.reduce((sum, s) => sum + (s.stats.learner_words ?? 0), 0) ?? 0;

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>Занятия</h1>
          {items && (
            <p className="muted" style={{ margin: 0 }}>
              Сохранено занятий: {items.length}. Ваших слов во всех занятиях: {totalWords.toLocaleString("ru-RU")}.
            </p>
          )}
        </div>
        <Link href="/sessions/new" className="button primary">
          Добавить занятие
        </Link>
      </div>

      {error && (
        <div className="error" role="alert">
          Не удалось загрузить список: {error}
        </div>
      )}
      {items === null && !error && <p className="muted">Загрузка…</p>}
      {items?.length === 0 && (
        <div className="card">
          <p style={{ marginTop: 0 }}>Пока нет ни одного занятия.</p>
          <Link href="/sessions/new">Вставить первую расшифровку</Link>
        </div>
      )}

      {items?.map((s) => (
        <Link key={s.id} href={`/sessions/${s.id}`} className="card list-item">
          <div>
            <div style={{ fontWeight: 600 }}>{s.title}</div>
            <div className="muted" style={{ fontSize: "0.9rem" }}>
              {formatDate(s.lesson_date)} · реплик ученика: {s.stats.learner_turns} · слов: {s.stats.learner_words}
            </div>
          </div>
          <span className="chip">{s.status === "parsed" ? "разобрано, анализа ещё нет" : s.status}</span>
        </Link>
      ))}
    </div>
  );
}
