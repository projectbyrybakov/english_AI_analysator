export type Role = "learner" | "tutor" | "unknown";
export type Direction = "reverse" | "chronological";
export type OrderIn = "auto" | Direction;
export type UserRole = "candidate" | "interviewer" | "coach" | "observer" | "free";
export type Market = "cis" | "international";

export interface Signal {
  name: string;
  vote: number;
  weight: number;
  strength: number;
  detail: string;
}

export interface PreviewTurn {
  index: number;
  role: Role;
  text: string;
  word_count: number;
  duration_sec: number | null;
  raw_timestamp: string | null;
  line_start: number;
  line_end: number;
  flags: string[];
}

export interface Stats {
  turns_total?: number;
  learner_turns?: number;
  tutor_turns?: number;
  unknown_turns?: number;
  collapsed_tutor_turns?: number;
  learner_words?: number;
  learner_speech_seconds?: number | null;
  removed_lines?: number;
}

export interface Preview {
  parser_version: string;
  requested_order: OrderIn;
  detected_direction: Direction;
  applied_direction: Direction;
  confidence: number;
  confidence_label: "high" | "medium" | "low";
  needs_confirmation: boolean;
  signals: Signal[];
  turns: PreviewTurn[];
  scenario_title: string | null;
  meta_lines: string[];
  removed: { line: number; text: string; reason: string }[];
  warnings: string[];
  timestamp_kind: "duration" | "clock" | "none";
  stats: Stats;
  duplicate_of: string | null;
}

export interface SessionTurn {
  idx: number;
  role: Role;
  text: string;
  word_count: number;
  duration_sec: number | null;
  raw_timestamp: string | null;
  source_line_start: number;
  source_line_end: number;
  flags: string[];
  role_overridden: boolean;
}

export interface SessionSummary {
  id: string;
  title: string;
  lesson_date: string | null;
  scenario_title: string | null;
  user_role: UserRole;
  market: Market | null;
  status: string;
  applied_direction: Direction;
  parse_confidence: number;
  stats: Stats;
  created_at: string;
}

export interface SessionDetail extends SessionSummary {
  detected_direction: Direction;
  parser_version: string;
  normalization_version: number;
  warnings: string[];
  turns: SessionTurn[];
  source_sha256: string;
  source_char_count: number;
}

export interface Settings {
  preferred_order: Direction | null;
  feedback_language: "ru" | "en" | "mixed";
  disfluency_analysis_enabled: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    let message = `Ошибка ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail)) message = body.detail.map((d: { msg: string }) => d.msg).join("; ");
    } catch {
      /* тело не JSON */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  preview: (raw_text: string, order: OrderIn) =>
    request<Preview>("/api/transcripts/preview", { method: "POST", body: JSON.stringify({ raw_text, order }) }),
  createSession: (body: {
    raw_text: string;
    order: Direction;
    confirmed: boolean;
    title?: string;
    lesson_date?: string | null;
    user_role: UserRole;
    market?: Market | null;
    role_overrides: Record<number, Role>;
    allow_duplicate?: boolean;
  }) => request<SessionDetail>("/api/sessions", { method: "POST", body: JSON.stringify(body) }),
  listSessions: () => request<SessionSummary[]>("/api/sessions"),
  getSession: (id: string) => request<SessionDetail>(`/api/sessions/${id}`),
  getSource: (id: string) =>
    request<{ raw_text: string; sha256: string; char_count: number }>(`/api/sessions/${id}/source`),
  deleteSession: (id: string) => request<void>(`/api/sessions/${id}`, { method: "DELETE" }),
  getSettings: () => request<Settings>("/api/settings"),
  updateSettings: (body: Partial<Settings>) =>
    request<Settings>("/api/settings", { method: "PATCH", body: JSON.stringify(body) }),
};

// ---------------------------------------------------------------------------
// Подписи для интерфейса
// ---------------------------------------------------------------------------

export const USER_ROLE_LABEL: Record<UserRole, string> = {
  candidate: "Кандидат (AI — интервьюер)",
  interviewer: "Интервьюер (AI — кандидат)",
  coach: "Тренировка с коучем",
  observer: "Наблюдатель",
  free: "Свободный разговор",
};

export function speakerLabel(role: Role, userRole: UserRole): string {
  if (role === "unknown") return "Роль не определена";
  if (role === "learner") {
    if (userRole === "candidate") return "Вы · кандидат";
    if (userRole === "interviewer") return "Вы · интервьюер";
    return "Вы";
  }
  if (userRole === "candidate") return "AI · интервьюер";
  if (userRole === "interviewer") return "AI · кандидат";
  if (userRole === "coach") return "AI · коуч";
  return "AI-тьютор";
}

export const FLAG_LABEL: Record<string, string> = {
  collapsed: "реплика свёрнута, текста нет",
  missing_text: "",
  question_missing: "вопрос перед ответом потерян",
  role_inferred: "роль определена по чередованию",
  split_ambiguous: "граница реплик неуверенная",
  explicit_prefix: "роль по префиксу",
  hide_marker_after_learner: "нет текста тьютора",
  russian_text: "текст на русском",
};

export const CONFIDENCE_LABEL = { high: "высокая", medium: "средняя", low: "низкая" } as const;

export const DIRECTION_LABEL: Record<Direction, string> = {
  reverse: "обратный (новые реплики сверху)",
  chronological: "прямой (по времени)",
};

export function formatSeconds(total: number | null | undefined): string {
  if (total == null) return "—";
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m} мин ${s.toString().padStart(2, "0")} с`;
}

export function formatDate(value: string | null): string {
  if (!value) return "без даты";
  const [y, m, d] = value.split("-");
  return `${d}.${m}.${y}`;
}
