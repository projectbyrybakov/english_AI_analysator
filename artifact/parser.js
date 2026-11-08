/*
 * Парсер расшифровки занятия — порт backend/app/parser (версия 1.0.0).
 * Детерминированный, без LLM. Работает в браузере и в Node (для тестов).
 * Документация алгоритма: docs/parser.md.
 */
(function (root) {
  "use strict";

  const PARSER_VERSION = "1.0.0-js";

  // ----------------------------------------------------------------- маркеры
  const HIDE = new Set(["скрыть текст", "hide text", "hide transcript"]);
  const SHOW = new Set(["показать текст", "show text", "show transcript"]);
  const UI_NOISE = new Set([
    "сменить роль",
    "грамматические ошибки",
    "просто говорите - не бойтесь ошибиться",
    "в любой момент можно сменить роль",
    "- кнопка вверху экрана.",
    "- кнопка вверху экрана",
    "кнопка вверху экрана.",
    "кнопка вверху экрана",
    "change role",
    "grammar mistakes",
  ]);
  const UI_NOISE_PATTERNS = [/^\d{1,3}\s*(мин|min|minutes|минут[аы]?)\.?$/];
  const TIMESTAMP_RE = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/;
  const SPEAKER_PREFIX_RE =
    /^\s*(ai|tutor|interviewer|bot|assistant|me|you|learner|student|candidate|я|ученик|тьютор|интервьюер|кандидат|ии)\s*[:：\-–—]\s*(.*)$/i;
  const TUTOR_PREFIXES = new Set(["ai", "tutor", "interviewer", "bot", "assistant", "тьютор", "интервьюер", "ии"]);
  const LEARNER_PREFIXES = new Set(["me", "you", "learner", "student", "candidate", "я", "ученик", "кандидат"]);

  function normalizeLine(line) {
    return line.trim().toLowerCase().replace(/[–—−]/g, "-").replace(/\s+/g, " ");
  }
  const isHide = (l) => HIDE.has(normalizeLine(l));
  const isShow = (l) => SHOW.has(normalizeLine(l));
  function isUiNoise(l) {
    const n = normalizeLine(l);
    return UI_NOISE.has(n) || UI_NOISE_PATTERNS.some((p) => p.test(n));
  }
  function parseTimestamp(l) {
    const m = TIMESTAMP_RE.exec(l.trim());
    if (!m) return null;
    const h = Number(m[1] || 0), mi = Number(m[2]), s = Number(m[3]);
    if (s >= 60) return null;
    return h * 3600 + mi * 60 + s;
  }
  function isCyrillicMeta(text) {
    const cyr = (text.match(/[А-Яа-яЁё]/g) || []).length;
    const lat = (text.match(/[A-Za-z]/g) || []).length;
    return cyr > 0 && cyr / (cyr + lat) >= 0.6;
  }

  // ------------------------------------------------------ шаг 1: элементы
  function tokenize(raw) {
    const elements = [];
    const removed = [];
    let gap = 0;
    const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    lines.forEach((line, i) => {
      const idx = i + 1;
      const stripped = line.trim();
      if (!stripped) { gap += 1; return; }
      if (isHide(stripped)) {
        elements.push({ kind: "hide", lineStart: idx, lineEnd: idx, gapBefore: gap, raw: stripped });
        removed.push({ line: idx, text: stripped, reason: "hide_marker" });
        gap = 0; return;
      }
      if (isShow(stripped)) {
        elements.push({ kind: "show", lineStart: idx, lineEnd: idx, gapBefore: gap, raw: stripped });
        removed.push({ line: idx, text: stripped, reason: "show_marker" });
        gap = 0; return;
      }
      if (isUiNoise(stripped)) {
        removed.push({ line: idx, text: stripped, reason: "ui_noise" });
        gap += 1; return;
      }
      const seconds = parseTimestamp(stripped);
      if (seconds !== null) {
        elements.push({ kind: "ts", lineStart: idx, lineEnd: idx, gapBefore: gap, seconds, raw: stripped });
        removed.push({ line: idx, text: stripped, reason: "timestamp" });
        gap = 0; return;
      }
      let explicit = null;
      let text = stripped;
      const m = SPEAKER_PREFIX_RE.exec(stripped);
      if (m) {
        const who = m[1].toLowerCase();
        if (TUTOR_PREFIXES.has(who)) explicit = "tutor";
        else if (LEARNER_PREFIXES.has(who)) explicit = "learner";
        text = m[2].trim();
      }
      const prev = elements[elements.length - 1];
      if (prev && prev.kind === "para" && gap === 0 && explicit === null) {
        prev.text = `${prev.text}\n${text}`;
        prev.lineEnd = idx;
      } else {
        elements.push({ kind: "para", lineStart: idx, lineEnd: idx, gapBefore: gap, text, explicitRole: explicit });
      }
      gap = 0;
    });
    return { elements, removed };
  }

  // -------------------------------------------- шаг 2: заголовки по краям
  function extractMeta(elements, removed) {
    const structural = elements.map((e, i) => (e.kind !== "para" ? i : -1)).filter((i) => i >= 0);
    if (!structural.length) return { elements, meta: [] };
    const first = structural[0];
    const last = structural[structural.length - 1];
    const meta = [];
    const keep = [];
    elements.forEach((e, i) => {
      const atEdge = i < first || i > last;
      if (e.kind === "para" && atEdge && isCyrillicMeta(e.text) && !e.explicitRole) {
        meta.push(e.text);
        removed.push({ line: e.lineStart, text: e.text, reason: "meta" });
        return;
      }
      keep.push(e);
    });
    return { elements: keep, meta };
  }

  // ------------------------------------------------ шаг 3: реплики и роли
  function makeTurn(paras, role, flags) {
    return {
      index: -1,
      role,
      text: paras.map((p) => p.text).join("\n\n"),
      durationSec: null,
      rawTimestamp: null,
      lineStart: paras[0].lineStart,
      lineEnd: paras[paras.length - 1].lineEnd,
      flags: flags ? [...flags] : [],
    };
  }
  function attachTs(turn, ts) {
    if (!ts) return;
    turn.durationSec = ts.seconds;
    turn.rawTimestamp = ts.raw;
    turn.lineStart = ts.lineStart;
  }
  function splitIndex(run) {
    const gaps = run.slice(1).map((p) => p.gapBefore);
    const best = Math.max(...gaps);
    return { k: gaps.indexOf(best) + 1, ambiguous: gaps.filter((g) => g === best).length > 1 };
  }

  function buildTurns(elements, warnings) {
    const turns = [];
    let i = 0;
    const n = elements.length;
    while (i < n) {
      const e = elements[i];
      if (e.kind === "show") {
        turns.push({ index: -1, role: "tutor", text: "", durationSec: null, rawTimestamp: null,
          lineStart: e.lineStart, lineEnd: e.lineEnd, flags: ["collapsed", "missing_text"] });
        i += 1; continue;
      }
      if (e.kind === "hide") {
        const prev = i > 0 ? elements[i - 1] : null;
        if (!prev || prev.kind !== "para") warnings.push(`Строка ${e.lineStart}: «${e.raw}» без текста реплики.`);
        i += 1; continue;
      }
      let ts = null;
      if (e.kind === "ts") {
        ts = e;
        i += 1;
        if (i >= n || elements[i].kind !== "para") {
          warnings.push(`Строка ${e.lineStart}: метка ${e.raw} без текста реплики.`);
          continue;
        }
      }
      const run = [];
      while (i < n && elements[i].kind === "para") { run.push(elements[i]); i += 1; }
      const followedByHide = i < n && elements[i].kind === "hide";

      if (run.every((p) => p.explicitRole) && !ts) {
        run.forEach((p) => turns.push(makeTurn([p], p.explicitRole || "unknown", ["explicit_prefix"])));
        continue;
      }
      const startLearner = ts !== null;
      const endTutor = followedByHide;

      if (startLearner && endTutor && run.length === 1) {
        const t = makeTurn(run, "learner");
        attachTs(t, ts);
        t.flags.push("hide_marker_after_learner");
        turns.push(t);
        warnings.push(`Строки ${run[0].lineStart}–${run[0].lineEnd}: после реплики ученика сразу «Скрыть текст» без текста тьютора.`);
        continue;
      }
      if (startLearner && endTutor) {
        const { k, ambiguous } = splitIndex(run);
        const learner = makeTurn(run.slice(0, k), "learner");
        attachTs(learner, ts);
        const tutor = makeTurn(run.slice(k), "tutor");
        if (ambiguous) {
          learner.flags.push("split_ambiguous");
          tutor.flags.push("split_ambiguous");
          warnings.push(`Строки ${run[0].lineStart}–${run[run.length - 1].lineEnd}: граница между ответом ученика и репликой тьютора определена неуверенно — проверьте в предпросмотре.`);
        }
        turns.push(learner, tutor);
        continue;
      }
      if (startLearner) {
        let k = 1;
        while (k < run.length && run[k].gapBefore <= 1) k += 1;
        const learner = makeTurn(run.slice(0, k), "learner");
        attachTs(learner, ts);
        turns.push(learner);
        run.slice(k).forEach((p) => turns.push(makeTurn([p], p.explicitRole || "unknown")));
        continue;
      }
      if (endTutor) {
        let k = run.length - 1;
        while (k > 0 && run[k].gapBefore <= 1) k -= 1;
        run.slice(0, k).forEach((p) => turns.push(makeTurn([p], p.explicitRole || "unknown")));
        turns.push(makeTurn(run.slice(k), "tutor"));
        continue;
      }
      run.forEach((p) => turns.push(makeTurn([p], p.explicitRole || "unknown")));
    }
    inferByAlternation(turns, elements.some((e) => e.kind === "hide" || e.kind === "show"));
    return turns;
  }

  function inferByAlternation(turns, hasAnchors) {
    if (!hasAnchors) return;
    turns.forEach((t, k) => {
      if (t.role !== "unknown") return;
      const roles = new Set();
      if (k > 0) roles.add(turns[k - 1].role);
      if (k + 1 < turns.length) roles.add(turns[k + 1].role);
      if (roles.size === 1 && roles.has("tutor")) {
        t.role = "learner";
        t.flags.push("role_inferred");
      }
    });
  }

  // ------------------------------------------------------- шаг 4: порядок
  const STOPWORDS = new Set(`a an the and or but if so of to in on at for from by with as is are was were be been being
    am do does did done have has had i you he she it we they me my your our their his her its this that
    these those there here what which who whom how why when where can could should would will shall may
    might must not no yes ok okay just very really about into than then also some any more most such
    one two first second like well good great nice tell me us let lets let's now please thank thanks
    sorry uh um yeah yep so`.split(/\s+/).filter(Boolean));
  const WORD_RE = /[a-z][a-z'’]+/g;
  const GREETING_RE = /\b(hello|hi there|nice to meet you|let[’']?s start|i[’']?ll be your interviewer|welcome)\b/i;
  const CLOSING_RE = /\b(end (this|the|our) (dialogue|conversation|session|interview)|summary of (our|the|this)|goodbye|thank you for your time|let[’']?s finish|wrap (it )?up|that[’']?s all for today)\b/i;

  function stems(text) {
    const out = new Set();
    for (const w of text.toLowerCase().match(WORD_RE) || []) {
      if (!STOPWORDS.has(w) && w.length > 2) out.add(w.slice(0, 5));
    }
    return out;
  }
  function similarity(a, b) {
    const sa = stems(a), sb = stems(b);
    if (!sa.size || !sb.size) return 0;
    let inter = 0;
    for (const x of sa) if (sb.has(x)) inter += 1;
    return inter / Math.sqrt(sa.size * sb.size);
  }
  function questionFeedback(text) {
    const sentences = text.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
    const q = sentences.map((s, k) => (s.includes("?") ? k : -1)).filter((k) => k >= 0);
    if (!q.length) return [sentences.length ? sentences[sentences.length - 1] : "", sentences.slice(0, -1).join(" ")];
    let start = q.length > 1 ? Math.max(q[q.length - 1] - 1, q[0]) : q[q.length - 1];
    return [sentences.slice(start).join(" "), sentences.slice(0, start).join(" ")];
  }
  function qaScore(seq) {
    let score = 0;
    seq.forEach((t, k) => {
      if (t.role !== "tutor" || !t.text) return;
      const [question, feedback] = questionFeedback(t.text);
      const nxt = seq[k + 1];
      const prv = k > 0 ? seq[k - 1] : null;
      if (nxt && nxt.role === "learner") score += similarity(question, nxt.text);
      if (prv && prv.role === "learner" && feedback) score += similarity(feedback, prv.text);
    });
    return score;
  }
  function edgeText(turns, fromStart) {
    const seq = fromStart ? turns : [...turns].reverse();
    return seq.filter((t) => t.text).slice(0, 2).map((t) => t.text).join(" ");
  }
  function timestampKind(turns) {
    const v = turns.map((t) => t.durationSec).filter((x) => x !== null && x !== undefined);
    if (v.length < 3) return { kind: v.length ? "duration" : "none", mono: 0 };
    let inc = true, dec = true;
    for (let k = 1; k < v.length; k++) {
      if (!(v[k] > v[k - 1])) inc = false;
      if (!(v[k] < v[k - 1])) dec = false;
    }
    if (inc) return { kind: "clock", mono: 1 };
    if (dec) return { kind: "clock", mono: -1 };
    return { kind: "duration", mono: 0 };
  }

  function detect(turns, preferred) {
    const signals = [];
    const fwd = qaScore(turns);
    const bwd = qaScore([...turns].reverse());
    const total = fwd + bwd;
    if (total > 0.05) {
      const diff = (fwd - bwd) / total;
      signals.push({ name: "qa_coherence", vote: diff > 0 ? 1 : diff < 0 ? -1 : 0, weight: 2.0,
        strength: Math.min(1, Math.abs(diff) * 3),
        detail: `Связность вопрос→ответ: прямой порядок ${fwd.toFixed(2)}, обратный ${bwd.toFixed(2)}.` });
    } else {
      signals.push({ name: "qa_coherence", vote: 0, weight: 2.0, strength: 0, detail: "Недостаточно пар вопрос→ответ." });
    }
    const top = edgeText(turns, true), bottom = edgeText(turns, false);
    const gTop = GREETING_RE.test(top), gBottom = GREETING_RE.test(bottom);
    if (gTop !== gBottom) {
      signals.push({ name: "greeting_edge", vote: gTop ? 1 : -1, weight: 1.5, strength: 1,
        detail: `Приветствие ${gTop ? "в начале" : "в конце"} документа.` });
    }
    const cTop = CLOSING_RE.test(top), cBottom = CLOSING_RE.test(bottom);
    if (cTop !== cBottom) {
      signals.push({ name: "closing_edge", vote: cTop ? -1 : 1, weight: 1.5, strength: 1,
        detail: `Завершение разговора ${cTop ? "в начале" : "в конце"} документа.` });
    }
    const ts = timestampKind(turns);
    if (ts.kind === "clock") {
      signals.push({ name: "timestamps", vote: ts.mono, weight: 1.0, strength: 1,
        detail: "Метки времени монотонно " + (ts.mono > 0 ? "растут." : "убывают.") });
    } else if (ts.kind === "duration") {
      signals.push({ name: "timestamps", vote: 0, weight: 1.0, strength: 0,
        detail: "Метки не монотонны — это длительность сообщений, для порядка не используются." });
    }
    if (preferred) {
      signals.push({ name: "user_preference", vote: preferred === "chronological" ? 1 : -1, weight: 0.5, strength: 1,
        detail: "Сохранённый формат пользователя." });
    }
    const score = signals.reduce((s, x) => s + x.vote * x.weight * x.strength, 0);
    return { signals, score };
  }

  const wordCount = (t) => (t.match(/[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё'’-]*/g) || []).length;
  const englishWords = (t) => (t.match(/[A-Za-z][A-Za-z'’-]*/g) || []).length;

  // ------------------------------------------------------------ публичное
  function parseTranscript(raw, order = "auto", preferred = null) {
    const warnings = [];
    const tok = tokenize(raw);
    const removed = tok.removed;
    const { elements, meta } = extractMeta(tok.elements, removed);
    const fileTurns = buildTurns(elements, warnings);

    const { signals, score } = detect(fileTurns, preferred);
    const evidenceWeight = signals.filter((s) => s.vote !== 0 && s.name !== "user_preference").reduce((a, s) => a + s.weight, 0);
    const confidence = Math.round(Math.min(1, Math.abs(score) / Math.max(evidenceWeight + 0.5, 1)) * 100) / 100;
    const detected = score > 0 ? "chronological" : score < 0 ? "reverse" : preferred || "reverse";
    const label = confidence >= 0.6 ? "high" : confidence >= 0.3 ? "medium" : "low";

    let needsConfirmation = label !== "high";
    const content = signals.filter((s) => s.vote !== 0 && s.name !== "user_preference");
    if (preferred && content.length) {
      const cs = content.reduce((a, s) => a + s.vote * s.weight * s.strength, 0);
      const cdir = cs > 0 ? "chronological" : "reverse";
      if (cdir !== preferred && Math.abs(cs) >= 1.0) {
        needsConfirmation = true;
        warnings.push("Порядок отличается от вашего обычного формата — проверьте предпросмотр.");
      }
    }
    let applied = detected;
    if (order !== "auto") {
      applied = order;
      if (order !== detected) needsConfirmation = true;
      if (order !== detected && label !== "low") {
        warnings.push(`Выбран порядок «${order === "reverse" ? "обратный" : "прямой"}», но сигналы указывают на другой. Проверьте предпросмотр.`);
      }
    }
    const chrono = applied === "reverse" ? [...fileTurns].reverse() : [...fileTurns];
    chrono.forEach((t, k) => { t.index = k; });
    chrono.forEach((t, k) => {
      if (t.flags.includes("missing_text") && chrono[k + 1] && chrono[k + 1].role === "learner") {
        chrono[k + 1].flags.push("question_missing");
      }
    });
    const collapsed = chrono.filter((t) => t.flags.includes("collapsed")).length;
    if (collapsed) {
      warnings.push(`Свёрнутых реплик тьютора («Показать текст»): ${collapsed}. Их текст не попал в копию, ответы после них оцениваются без вопроса. Совет: раскрывайте реплики перед копированием.`);
    }
    const inferred = chrono.filter((t) => t.flags.includes("role_inferred")).length;
    if (inferred) {
      needsConfirmation = true;
      warnings.push(`Роль ученика определена по чередованию реплик (без меток времени): ${inferred}. Проверьте роли.`);
    }
    const unknown = chrono.filter((t) => t.role === "unknown").length;
    if (unknown) {
      needsConfirmation = true;
      warnings.push(`Реплик с неопределённой ролью: ${unknown}. Укажите роль в предпросмотре.`);
    }
    chrono.forEach((t) => { if (t.text && isCyrillicMeta(t.text)) t.flags.push("russian_text"); });
    chrono.forEach((t) => { t.wordCount = wordCount(t.text); });

    const tsk = timestampKind(fileTurns).kind;
    const learner = chrono.filter((t) => t.role === "learner");
    const durations = learner.map((t) => t.durationSec).filter((x) => x !== null);
    const stats = {
      turnsTotal: chrono.length,
      learnerTurns: learner.length,
      tutorTurns: chrono.filter((t) => t.role === "tutor").length,
      unknownTurns: unknown,
      collapsedTutorTurns: collapsed,
      learnerWords: learner.reduce((a, t) => a + englishWords(t.text), 0),
      learnerSpeechSeconds: tsk === "duration" && durations.length ? durations.reduce((a, b) => a + b, 0) : null,
      removedLines: removed.length,
    };
    return {
      parserVersion: PARSER_VERSION,
      requestedOrder: order,
      detectedDirection: detected,
      appliedDirection: applied,
      confidence,
      confidenceLabel: label,
      needsConfirmation,
      signals,
      turns: chrono,
      scenarioTitle: meta.length ? meta[0] : null,
      metaLines: meta,
      removed: removed.sort((a, b) => a.line - b.line),
      warnings,
      timestampKind: tsk,
      stats,
    };
  }

  const api = { parseTranscript, PARSER_VERSION, wordCount, englishWords };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.EIAParser = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
