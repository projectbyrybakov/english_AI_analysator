"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { TurnView } from "@/components/TurnView";
import {
  ApiError,
  api,
  CONFIDENCE_LABEL,
  DIRECTION_LABEL,
  type Direction,
  formatSeconds,
  type Market,
  type OrderIn,
  type Preview,
  type Role,
  USER_ROLE_LABEL,
  type UserRole,
} from "@/lib/api";

function today(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function guessMarket(title: string | null): Market | "" {
  if (!title) return "";
  const t = title.toLowerCase();
  if (t.includes("снг")) return "cis";
  if (t.includes("международ") || t.includes("international")) return "international";
  return "";
}

export default function NewSessionPage() {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [order, setOrder] = useState<OrderIn>("auto");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [roles, setRoles] = useState<Record<number, Role>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [title, setTitle] = useState("");
  const [lessonDate, setLessonDate] = useState(today());
  const [userRole, setUserRole] = useState<UserRole>("candidate");
  const [market, setMarket] = useState<Market | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateBlocked, setDuplicateBlocked] = useState(false);

  async function runPreview(nextOrder: OrderIn) {
    setBusy(true);
    setError(null);
    setDuplicateBlocked(false);
    try {
      const p = await api.preview(raw, nextOrder);
      setOrder(nextOrder);
      setPreview(p);
      setRoles(Object.fromEntries(p.turns.map((t) => [t.index, t.role])));
      setConfirmed(false);
      setTitle(p.scenario_title ?? "");
      setMarket(guessMarket(p.scenario_title));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const overrides = useMemo(() => {
    if (!preview) return {};
    const out: Record<number, Role> = {};
    for (const t of preview.turns) if (roles[t.index] !== t.role) out[t.index] = roles[t.index];
    return out;
  }, [preview, roles]);

  const unknownLeft = preview ? preview.turns.filter((t) => roles[t.index] === "unknown").length : 0;
  const confirmationRequired = !!preview && (preview.needs_confirmation || Object.keys(overrides).length > 0);
  const canSave = !!preview && unknownLeft === 0 && (!confirmationRequired || confirmed) && !busy;

  async function save(allowDuplicate = false) {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api.createSession({
        raw_text: raw,
        order: preview.applied_direction,
        confirmed: confirmationRequired ? confirmed : false,
        title: title.trim() || undefined,
        lesson_date: lessonDate || null,
        user_role: userRole,
        market: market || null,
        role_overrides: overrides,
        allow_duplicate: allowDuplicate,
      });
      router.push(`/sessions/${s.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.message.includes("уже сохранено")) {
        setDuplicateBlocked(true);
      }
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const flip: Direction | null = preview
    ? preview.applied_direction === "reverse"
      ? "chronological"
      : "reverse"
    : null;

  return (
    <div className="stack">
      <div>
        <h1>Новое занятие</h1>
        <p className="muted">
          Вставьте расшифровку целиком, как скопировали из приложения. Служебные надписи и метки уберутся
          автоматически, исходный текст сохранится без изменений.
        </p>
      </div>

      <section className="card stack" aria-labelledby="paste-h">
        <h2 id="paste-h" style={{ margin: 0 }}>
          1. Расшифровка
        </h2>
        <label className="sr-only" htmlFor="raw">
          Текст расшифровки
        </label>
        <textarea
          id="raw"
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setPreview(null);
          }}
          placeholder="Вставьте сюда текст занятия…"
        />
        <div className="row">
          <label className="field">
            Порядок реплик
            <select value={order} onChange={(e) => setOrder(e.target.value as OrderIn)}>
              <option value="auto">Определить автоматически</option>
              <option value="reverse">Обратный — новые сверху</option>
              <option value="chronological">Прямой — по времени</option>
            </select>
          </label>
          <button
            type="button"
            className="primary"
            disabled={!raw.trim() || busy}
            onClick={() => runPreview(order)}
            style={{ alignSelf: "end" }}
          >
            {busy && !preview ? "Разбираю…" : "Разобрать"}
          </button>
          <span className="muted" style={{ alignSelf: "end" }}>
            {raw.length.toLocaleString("ru-RU")} символов
          </span>
        </div>
      </section>

      {error && (
        <div className="error" role="alert">
          {error}
          {duplicateBlocked && (
            <div className="row" style={{ marginTop: 8 }}>
              <button type="button" onClick={() => save(true)}>
                Сохранить ещё раз как отдельное занятие
              </button>
            </div>
          )}
        </div>
      )}

      {preview && (
        <>
          <section className="card stack" aria-labelledby="check-h">
            <h2 id="check-h" style={{ margin: 0 }}>
              2. Проверка порядка и ролей
            </h2>
            <div className="grid-stats">
              <div className="stat">
                <div className="label">Порядок в тексте</div>
                <div className="value" style={{ fontSize: "1.05rem" }}>
                  {DIRECTION_LABEL[preview.applied_direction]}
                </div>
                <div className="note">
                  уверенность {CONFIDENCE_LABEL[preview.confidence_label]} ({preview.confidence.toFixed(2)})
                </div>
              </div>
              <div className="stat">
                <div className="label">Реплик ученика</div>
                <div className="value">{preview.stats.learner_turns}</div>
                <div className="note">{preview.stats.learner_words} слов</div>
              </div>
              <div className="stat">
                <div className="label">Реплик AI</div>
                <div className="value">{preview.stats.tutor_turns}</div>
                <div className="note">свёрнуто: {preview.stats.collapsed_tutor_turns}</div>
              </div>
              <div className="stat">
                <div className="label">Ваши голосовые</div>
                <div className="value" style={{ fontSize: "1.05rem" }}>
                  {formatSeconds(preview.stats.learner_speech_seconds)}
                </div>
                <div className="note">сумма длительностей сообщений</div>
              </div>
            </div>

            {preview.scenario_title && (
              <p style={{ margin: 0 }}>
                Сценарий из текста: <strong>{preview.scenario_title}</strong>
              </p>
            )}

            {preview.duplicate_of && (
              <div className="notice">
                Этот текст уже сохранён: <Link href={`/sessions/${preview.duplicate_of}`}>открыть занятие</Link>.
              </div>
            )}

            {preview.warnings.length > 0 && (
              <div className="notice" role="status">
                <strong>Обратите внимание</strong>
                <ul>
                  {preview.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <details>
              <summary>Почему выбран такой порядок</summary>
              <ul>
                {preview.signals.map((s) => (
                  <li key={s.name}>
                    {s.detail}{" "}
                    <span className="muted">
                      {s.vote === 0 ? "(не влияет)" : s.vote > 0 ? "→ прямой" : "→ обратный"}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
            <details>
              <summary>Убрано из анализа: {preview.removed.length} строк</summary>
              <ul>
                {preview.removed
                  .filter((r) => r.reason !== "timestamp")
                  .map((r) => (
                    <li key={`${r.line}-${r.text}`}>
                      стр. {r.line}: «{r.text}» <span className="muted">({r.reason})</span>
                    </li>
                  ))}
              </ul>
            </details>

            <div className="row">
              {flip && (
                <button type="button" onClick={() => runPreview(flip)} disabled={busy}>
                  Перевернуть порядок
                </button>
              )}
              {order !== "auto" && (
                <button type="button" onClick={() => runPreview("auto")} disabled={busy}>
                  Вернуть автоопределение
                </button>
              )}
            </div>
          </section>

          <section aria-labelledby="turns-h" className="stack">
            <h2 id="turns-h" style={{ marginBottom: 0 }}>
              Диалог по порядку
            </h2>
            <p className="muted" style={{ margin: 0 }}>
              Первая реплика — начало занятия. Если роль определена неверно, поменяйте её в списке.
            </p>
            {preview.turns.map((t) => (
              <TurnView
                key={t.index}
                index={t.index}
                role={roles[t.index]}
                text={t.text}
                durationSec={t.duration_sec}
                flags={t.flags}
                userRole={userRole}
                roleControl={
                  <select
                    aria-label={`Роль реплики ${t.index + 1}`}
                    value={roles[t.index]}
                    onChange={(e) => setRoles({ ...roles, [t.index]: e.target.value as Role })}
                  >
                    <option value="learner">Вы (ученик)</option>
                    <option value="tutor">AI</option>
                    <option value="unknown">Не определено</option>
                  </select>
                }
              />
            ))}
          </section>

          <section className="card stack" aria-labelledby="save-h">
            <h2 id="save-h" style={{ margin: 0 }}>
              3. Сохранение
            </h2>
            <div className="form-grid">
              <label className="field">
                Название
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
              </label>
              <label className="field">
                Дата занятия
                <input type="date" value={lessonDate} onChange={(e) => setLessonDate(e.target.value)} />
              </label>
              <label className="field">
                Ваша роль
                <select value={userRole} onChange={(e) => setUserRole(e.target.value as UserRole)}>
                  {Object.entries(USER_ROLE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Рынок
                <select value={market} onChange={(e) => setMarket(e.target.value as Market | "")}>
                  <option value="">Не указан</option>
                  <option value="cis">СНГ</option>
                  <option value="international">Международный</option>
                </select>
              </label>
            </div>
            {confirmationRequired && (
              <label className="row">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                Я проверил порядок и роли реплик
              </label>
            )}
            {unknownLeft > 0 && <p className="muted">Осталось указать роль для {unknownLeft} реплик.</p>}
            <div className="row">
              <button type="button" className="primary" disabled={!canSave} onClick={() => save(false)}>
                {busy ? "Сохраняю…" : "Сохранить занятие"}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
