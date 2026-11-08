// Имитация window.claude для локальной проверки страницы (не публикуется).
(function () {
  const store = new Map(); // path -> data
  const listeners = new Set();
  const freeze = (o) => JSON.parse(JSON.stringify(o), (k, v) => (v && typeof v === "object" ? Object.freeze(v) : v));
  const notify = () => listeners.forEach((l) => l());
  const docSnap = (path) => ({ id: path.split("/").pop(), exists: store.has(path), data: () => (store.has(path) ? freeze(store.get(path)) : undefined), metadata: { fromCache: false, hasPendingWrites: false } });
  const delay = () => new Promise((r) => setTimeout(r, 5));
  function docRef(path) {
    return {
      id: path.split("/").pop(), path,
      async get() { await delay(); return docSnap(path); },
      async set(d) { await delay(); store.set(path, JSON.parse(JSON.stringify(d))); notify(); },
      async update(d) { await delay(); if (!store.has(path)) throw { code: "invalid_argument", message: "missing" }; store.set(path, { ...store.get(path), ...JSON.parse(JSON.stringify(d)) }); notify(); },
      async delete() { await delay(); store.delete(path); notify(); },
      onSnapshot(next) { const l = () => next(docSnap(path)); listeners.add(l); setTimeout(l, 10); return () => listeners.delete(l); },
      collection(sub) { return collRef(path + "/" + sub); },
    };
  }
  function collRef(path) {
    const snap = () => {
      const docs = [...store.keys()].filter((k) => k.startsWith(path + "/") && k.slice(path.length + 1).split("/").length === 1).sort().map(docSnap);
      return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
    };
    return {
      path, doc: (id) => docRef(path + "/" + (id || Math.random().toString(36).slice(2))),
      async get() { return snap(); },
      onSnapshot(next) { const l = () => next(snap()); listeners.add(l); setTimeout(l, 10); return () => listeners.delete(l); },
    };
  }
  const db = { doc: docRef, collection: collRef };
  const user = { id: async () => "u_test", isOwner: () => true };

  function turnsOf(prompt) {
    const block = prompt.slice(prompt.lastIndexOf("<transcript>") + 12, prompt.lastIndexOf("</transcript>"));
    const map = {};
    for (const line of block.trim().split("\n")) { const m = /^t(\d+) \[(\w+)\](?: \{flags: [^}]*\})?: (.*)$/.exec(line); if (m) map[m[1]] = m[3]; }
    return map;
  }
  const RULES = [
    [/should to \w+/, "grammar.modals", "confirmed_error", "P1", "modal_should_to", (m) => m.replace("should to", "had to"), "После should не ставится to."],
    [/data analytic\b/i, "lexical_choice", "confirmed_error", "P1", "data_analyst_noun", () => "data analyst", "Профессия — analyst, analytic — прилагательное."],
    [/I find some/, "grammar.tenses", "confirmed_error", "P2", "past_simple_in_narrative", () => "I found some", "В рассказе о прошлом нужен Past Simple."],
    [/duplicates was/, "grammar.agreement", "confirmed_error", "P2", "subject_verb_agreement", () => "duplicates were", "Множественное число — were."],
    [/I am working as a junior analyst in Northwind Delivery since 2023/, "grammar.tenses", "likely_issue", "P2", "present_perfect_since", () => "I have been working as a junior analyst at Northwind Delivery since 2023", "С since нужен Present Perfect."],
    [/Tablo/, "lexical_choice", "recognition_uncertainty", "P3", "asr_tool_name", () => "Tableau", "Похоже на ошибку распознавания."],
  ];
  async function sampleFn(prompt) {
    await new Promise((r) => setTimeout(r, 120));
    if (prompt.includes("Analyse ONLY these learner turns")) {
      const ids = /Analyse ONLY these learner turns: ([^.]+)\./.exec(prompt)[1].split(", ");
      const tt = turnsOf(prompt);
      return { turns: ids.map((id) => {
        const text = tt[id.slice(1)] || "";
        const issues = [];
        for (const [re, cat, st, pr, key, fix, ex] of RULES) { const m = re.exec(text); if (m) issues.push({ evidence: m[0], category: cat, status: st, priority: pr, error_key: key, minimal_correction: fix(m[0]), explanation: ex, rule: "rule", alternatives: [], likely_cause: { hypothesis: "влияние русского языка", confidence: 0.4 }, confidence: 0.9 }); }
        if (/I\.\.\. I/.test(text)) issues.push({ evidence: "I... I", category: "grammar.verb_forms", status: "confirmed_error", error_key: "rep" });
        issues.push({ evidence: "phrase that is not in the turn", category: "grammar.articles", status: "confirmed_error", error_key: "invented" });
        return { turn_id: id, communicative_task: "рассказать об опыте", relevance: "answered", clarity: 3,
          strengths: [{ evidence: text.split(" ").slice(0, 3).join(" "), note: "уверенное начало" }], issues,
          natural_version: "Natural: " + text, interview_version: "In my role at [company], I " + text.slice(0, 40) + " [X%].", transfer_rule: "Past events → Past Simple.", practice_task: "Расскажите о проекте в Past Simple.",
          interview: { applicable: true, answered_question: "partly", structure: 3, specificity: 2, personal_contribution: 3, result_impact: 2, technical_clarity: 3, notes: "Нет результата в цифрах." } };
      }) };
    }
    if (prompt.includes('"headline"')) {
      return { headline: "Понятные ответы о проектах, но прошедшее время и should to мешают звучать уверенно.", strengths: ["Проверка данных вторым источником", "Развёрнутые ответы"],
        key_problems: [{ error_key: "past_simple_in_narrative", title: "Present вместо Past Simple", why_it_matters: "Интервьюер путается во времени событий." }],
        main_correction: { before: "I find some duplicates", after: "I found some duplicates", why: "Рассказ о прошлом." },
        recommendations: ["Перескажите проект о дубликатах в Past Simple.", "Подготовьте цифру результата."],
        interview: { overall: "Ответы релевантны, не хватает результата.", structure_star: "Situation и Action есть, Result слабый.", chronology: "Хронология последовательна.", contradictions: [], clarifying_questions: "Уточняющих вопросов не было.", short_answer_draft: "I'm a junior analyst at Northwind Delivery. I build daily reports in SQL and Tableau ... [X%].", long_answer_draft: "Longer version ..." },
        cefr: { note: "provisional", dimensions: [{ name: "grammar_range_accuracy", range: "A2+–B1", confidence: 0.9, evidence: ["I find some duplicates"], to_verify: "Past Simple в рассказе" }, { name: "fluency", range: "B1", confidence: 0.5, evidence: [], to_verify: "" }] },
        vocabulary: [{ phrase: "late delivery rate", meaning: "доля опозданий", example: "The late delivery rate dropped by [X%].", source: "used" }], limitations: ["Один разговор."] };
    }
    if (prompt.includes('"exercises"')) {
      return { exercises: [
        { type: "gap_fill", error_key: "past_simple_in_narrative", prompt: "Yesterday I ___ (find) a bug in the dashboard.", answer: "found", accepted: ["found"], hint: "Past Simple", explanation: "find → found", transfer: true },
        { type: "error_correction", error_key: "subject_verb_agreement", prompt: "Исправьте: The duplicates was removed.", answer: "The duplicates were removed.", accepted: [], hint: "were", explanation: "мн. число", transfer: false },
      ] };
    }
    return { verdict: "partial", feedback: "Смысл верный, но форма глагола не та.", corrected: "found" };
  }
  const sample = Object.assign((p, o) => sampleFn(p, o).then((v) => ({ text: JSON.stringify(v), truncated: false })), { json: sampleFn });
  const downloads = { async save(r) { window.__downloads = (window.__downloads || []).concat([{ filename: r.filename, size: String(r.data).length }]); return { status: "saved" }; } };
  const caps = { db, user, sample, downloads };
  window.claude = { use: async (n) => { await delay(); return caps[n] || null; } };
  window.__store = store;
})();
