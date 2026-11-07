"use client";

import { useEffect, useState } from "react";

import { api, type Direction, type Settings } from "@/lib/api";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch((e: Error) => setError(e.message));
  }, []);

  async function update(patch: Partial<Settings>) {
    setSaved(false);
    try {
      setSettings(await api.updateSettings(patch));
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (error)
    return (
      <div className="error" role="alert">
        {error}
      </div>
    );
  if (!settings) return <p className="muted">Загрузка…</p>;

  return (
    <div className="stack">
      <h1>Настройки</h1>
      <section className="card stack">
        <label className="field">
          Обычный формат расшифровки
          <select
            value={settings.preferred_order ?? ""}
            onChange={(e) => update({ preferred_order: (e.target.value || null) as Direction | null })}
          >
            <option value="">Не задан</option>
            <option value="reverse">Обратный — новые реплики сверху</option>
            <option value="chronological">Прямой — по времени</option>
          </select>
        </label>
        <p className="muted" style={{ margin: 0 }}>
          Запоминается при каждом сохранении. Используется как слабая подсказка: если текст явно в другом порядке,
          сервис предупредит.
        </p>
        <label className="field">
          Язык объяснений
          <select
            value={settings.feedback_language}
            onChange={(e) => update({ feedback_language: e.target.value as Settings["feedback_language"] })}
          >
            <option value="ru">Русский</option>
            <option value="mixed">Русский и английский</option>
            <option value="en">Английский</option>
          </select>
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={settings.disfluency_analysis_enabled}
            onChange={(e) => update({ disfluency_analysis_enabled: e.target.checked })}
          />
          Анализировать паузы, повторы и запинки
        </label>
        <p className="muted" style={{ margin: 0 }}>
          По умолчанию выключено. По текстовой расшифровке причину повтора или паузы определить нельзя, поэтому
          они не считаются ошибками ни при каком значении этой настройки.
        </p>
        {saved && (
          <p role="status" style={{ color: "var(--ok)", margin: 0 }}>
            Сохранено
          </p>
        )}
      </section>
    </div>
  );
}
