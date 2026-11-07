import { FLAG_LABEL, formatSeconds, type Role, speakerLabel, type UserRole } from "@/lib/api";

interface Props {
  id?: string;
  index: number;
  role: Role;
  text: string;
  durationSec: number | null;
  flags: string[];
  userRole: UserRole;
  lines?: [number, number];
  roleControl?: React.ReactNode;
}

export function TurnView({ id, index, role, text, durationSec, flags, userRole, lines, roleControl }: Props) {
  const visibleFlags = flags.map((f) => FLAG_LABEL[f] ?? f).filter(Boolean);
  return (
    <article id={id} className={`turn ${role}`} aria-label={`Реплика ${index + 1}`}>
      <div className="num">#{index + 1}</div>
      <div>
        <div className="meta">
          {roleControl ?? <span className={`badge ${role}`}>{speakerLabel(role, userRole)}</span>}
          {durationSec != null && (
            <span className="chip" title="Длительность голосового сообщения">
              {formatSeconds(durationSec)}
            </span>
          )}
          {visibleFlags.map((f) => (
            <span key={f} className="chip">
              {f}
            </span>
          ))}
          {lines && (
            <span className="chip" title="Строки в исходном тексте">
              стр. {lines[0]}–{lines[1]}
            </span>
          )}
        </div>
        {text ? (
          <div className="text">{text}</div>
        ) : (
          <div className="text empty">Текст реплики не попал в копию («Показать текст»).</div>
        )}
      </div>
    </article>
  );
}
