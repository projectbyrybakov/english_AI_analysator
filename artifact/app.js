/* English Interview Analyst — версия-артефакт. Данные: db (приватно для каждого пользователя), AI: sample. */
(function () {
  "use strict";
  const P = window.EIAParser;
  const A = window.EIAAnalysis;
  const $app = document.getElementById("app");

  // ---------------------------------------------------------------- справочники
  const SCENARIOS = {
    recruiter_screening: "Recruiter screening",
    hr_interview: "HR interview",
    technical_da: "Middle Data Analyst technical interview",
    sql_python_stats: "SQL / Python / statistics interview",
    analytics_case: "Product / marketing analytics case",
    hiring_manager: "Hiring manager interview",
    team_fit: "Team-fit / meet the team",
    behavioural: "Behavioural interview",
    project_deep_dive: "Project deep dive",
    salary_motivation: "Salary, motivation and career goals",
    workplace: "Workplace conversation",
    small_talk: "Small talk",
    travel: "Travel English",
  };
  const ROLES = {
    candidate: "Кандидат (AI — интервьюер)",
    interviewer: "Интервьюер (AI — кандидат)",
    coach: "Coach (AI объясняет и тренирует)",
    observer: "Observer (AI не вмешивается)",
    free: "Свободный разговор",
  };
  const MARKETS = { cis: "СНГ", international: "Международный" };
  const TIERS = { quick: "Быстрая модель", default: "Стандартная модель", complex: "Самая сильная модель (рекомендуется)" };
  const EX_TYPES = {
    gap_fill: "Пропуск", error_correction: "Исправьте ошибку", translation_ru_en: "Перевод RU→EN",
    paraphrase: "Перефразируйте", sentence_building: "Составьте предложение", short_answer: "Короткий ответ",
  };
  const STATUS_PILL = {
    confirmed_error: "bad", likely_issue: "warn", naturalness: "info", style_register: "violet",
    acceptable_variant: "ok", recognition_uncertainty: "grey", not_enough_context: "grey",
  };
  const MASTERY_PILL = { new: "grey", recurring: "bad", practicing: "warn", improving: "info", mastered: "ok" };
  const FLAG_RU = {
    collapsed: "реплика свёрнута, текста нет", question_missing: "вопрос перед ответом потерян",
    role_inferred: "роль по чередованию", split_ambiguous: "граница неуверенная", explicit_prefix: "роль по префиксу",
    hide_marker_after_learner: "нет текста тьютора", russian_text: "текст на русском", role_overridden: "роль изменена вручную",
  };
  const CEFR_RU = {
    grammar_range_accuracy: "Грамматика: диапазон и точность", vocabulary_range_control: "Лексика: диапазон и контроль",
    coherence_cohesion: "Связность", functional_communication: "Решение коммуникативной задачи",
    interview_communication: "Коммуникация на интервью",
  };
  const DEFAULT_SETTINGS = {
    preferredOrder: null, feedbackLanguage: "ru", defaultRole: "candidate", defaultMarket: "", defaultScenario: "technical_da",
    mode: "training", hints: true, modelTier: "complex", disfluencyAnalysis: false, theme: "",
  };

  // ---------------------------------------------------------------- состояние
  const state = {
    phase: "loading", // loading | ready | offline
    loadNote: "",
    db: null, base: null, uid: null, sample: null, downloads: null,
    settings: { ...DEFAULT_SETTINGS },
    sessions: {}, analyses: {}, exercises: {},
    route: { name: "home", id: null },
    draft: null,
    running: {},
    ui: {
      filters: { prio: "", cat: "", status: "", q: "", recurring: false, sort: "order" },
      bank: { status: "", prio: "", q: "" },
      rolePanel: false, practiceKey: "", practice: {}, version: {}, confirmDelete: null, confirmWipe: false,
    },
    toast: "",
  };

  const esc = (s) => String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const today = () => new Date().toISOString().slice(0, 10);
  const nowIso = () => new Date().toISOString();
  const rid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const fmtDate = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "без даты");
  const fmtNum = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? "—" : Number(v).toFixed(d).replace(".", ","));
  const fmtSec = (s) => (s === null || s === undefined ? "—" : `${Math.floor(s / 60)} мин ${String(s % 60).padStart(2, "0")} с`);
  const plain = (o) => JSON.parse(JSON.stringify(o));

  function newDraft() {
    const s = state.settings;
    return {
      raw: "", order: "auto", preview: null, roles: {}, confirmed: false, title: "", date: today(),
      userRole: s.defaultRole, market: s.defaultMarket, scenario: s.defaultScenario,
    };
  }

  // ---------------------------------------------------------------- хранилище
  const queues = {};
  function enqueue(path, fn) {
    const p = (queues[path] || Promise.resolve()).then(fn, fn);
    queues[path] = p.catch(() => {});
    return p;
  }
  const COLL = { sessions: "sessions", analyses: "analyses", exercises: "exercises" };
  async function put(kind, id, data) {
    const body = plain(data);
    state[kind][id] = body;
    if (!state.base) return;
    const ref = state.base.collection(COLL[kind]).doc(id);
    try {
      await enqueue(ref.path, () => ref.set(body));
    } catch (e) {
      handleDbError(e);
      throw e;
    }
  }
  async function patch(kind, id, fields) {
    const body = plain(fields);
    state[kind][id] = { ...state[kind][id], ...body };
    if (!state.base) return;
    const ref = state.base.collection(COLL[kind]).doc(id);
    try {
      await enqueue(ref.path, () => ref.update(body));
    } catch (e) {
      handleDbError(e);
      throw e;
    }
  }
  async function remove(kind, id) {
    delete state[kind][id];
    if (!state.base) return;
    const ref = state.base.collection(COLL[kind]).doc(id);
    await enqueue(ref.path, () => ref.delete());
  }
  async function saveSettings(fields) {
    state.settings = { ...state.settings, ...fields };
    applyTheme();
    if (!state.base) return;
    const body = plain(state.settings);
    await enqueue(state.base.path, () => state.base.set(body)).catch(handleDbError);
  }
  function handleDbError(e) {
    const code = e && e.code;
    if (code === "quota_exceeded") toast("Хранилище заполнено. Удалите старые занятия или упражнения.");
    else if (code === "resource_exhausted") toast("Слишком много запросов к хранилищу. Подождите минуту.");
    else if (code === "invalid_argument") toast("Запись отклонена хранилищем: " + (e.message || ""));
    else if (code === "revoked") toast("Доступ к данным отозван.");
    else toast("Не удалось сохранить: " + ((e && e.message) || "ошибка хранилища"));
  }

  async function connect() {
    const use = (name) => (typeof claude !== "undefined" && claude && claude.use ? claude.use(name).catch(() => null) : Promise.resolve(null));
    const [db, user, sample, downloads] = await Promise.all([use("db"), use("user"), use("sample"), use("downloads")]);
    state.sample = sample;
    state.downloads = downloads;
    const uid = user ? await Promise.resolve(user.id()).catch(() => null) : null;
    if (!db || !uid) {
      state.phase = "offline";
      state.loadNote = "Хранилище недоступно: откройте страницу в claude.ai, войдя в аккаунт. Сейчас данные живут только до закрытия вкладки.";
      state.draft = state.draft || newDraft();
      render();
      return;
    }
    state.db = db;
    state.uid = uid;
    state.base = db.doc(`data/users/${uid}/eia`);
    let pending = 4;
    const timer = setTimeout(() => {
      if (state.phase === "loading") {
        state.phase = "ready";
        state.loadNote = "Данные пока не загрузились — возможно, нет связи. Показано то, что есть.";
        render();
      }
    }, 10000);
    const arrived = (snap) => {
      if (snap && snap.metadata && snap.metadata.fromCache) return;
      pending -= 1;
      if (pending <= 0 && state.phase === "loading") {
        clearTimeout(timer);
        state.phase = "ready";
        state.loadNote = "";
        state.draft = state.draft || newDraft();
        renderSoon();
      }
    };
    const fail = (e) => {
      clearTimeout(timer);
      state.phase = "ready";
      state.loadNote = "Ошибка хранилища: " + ((e && e.message) || "неизвестно") + ". Изменения могут не сохраниться.";
      renderSoon();
    };
    state.base.onSnapshot((snap) => {
      if (snap.exists) state.settings = { ...DEFAULT_SETTINGS, ...snap.data() };
      applyTheme();
      arrived(snap);
      renderSoon();
    }, fail);
    for (const kind of Object.keys(COLL)) {
      state.base.collection(COLL[kind]).onSnapshot((snap) => {
        const next = {};
        for (const d of snap.docs) next[d.id] = d.data();
        state[kind] = next;
        arrived(snap);
        renderSoon();
      }, fail);
    }
  }

  // ---------------------------------------------------------------- производные
  const sessionsSorted = () => Object.values(state.sessions).sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || "")) || String(b.createdAt).localeCompare(String(a.createdAt)));
  const analysesFor = (sid) => Object.values(state.analyses).filter((a) => a.sessionId === sid).sort((a, b) => b.version - a.version);
  function currentAnalysis(s) {
    const chosen = state.ui.version[s.id];
    const list = analysesFor(s.id);
    if (chosen) return list.find((a) => a.id === chosen) || null;
    return list.find((a) => a.id === s.currentAnalysis) || list.find((a) => a.status === "done" || a.status === "partial") || null;
  }
  function bank() {
    const sessions = Object.values(state.sessions).map((s) => {
      const a = analysesFor(s.id).find((x) => x.id === s.currentAnalysis) || null;
      return { id: s.id, date: s.date || String(s.createdAt).slice(0, 10), title: s.title, analysis: a, disputed: s.disputed || [] };
    });
    return A.buildErrorBank(sessions, Object.values(state.exercises));
  }
  const dueExercises = () => Object.values(state.exercises).filter((x) => !x.srs || x.srs.due <= today());
  const metricsOf = (s, a) => A.computeMetrics(s.turns, a ? a.turnResults : {}, s.disputed || []);

  // ---------------------------------------------------------------- рендер
  let renderPending = false;
  function typing() {
    const el = document.activeElement;
    return el && $app.contains(el) && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && el.type !== "checkbox"));
  }
  function renderSoon() {
    if (typing()) { renderPending = true; return; }
    render();
  }
  document.addEventListener("focusout", () => {
    if (renderPending) setTimeout(() => { if (!typing() && renderPending) { renderPending = false; render(); } }, 250);
  });

  function render() {
    const scrollY = window.scrollY;
    const r = state.route;
    let body = "";
    if (state.phase === "loading") body = `<div class="card"><p>Загружаю ваши занятия…</p></div>`;
    else if (r.name === "sessions") body = viewSessions();
    else if (r.name === "new") body = viewNew();
    else if (r.name === "session") body = viewSession(r.id);
    else if (r.name === "errors") body = viewBank();
    else if (r.name === "practice") body = viewPractice();
    else if (r.name === "settings") body = viewSettings();
    else body = viewHome();
    const note = state.loadNote ? `<div class="banner ${state.phase === "offline" ? "warn" : ""}" role="status">${esc(state.loadNote)}</div>` : "";
    const ai = state.phase !== "loading" && !state.sample
      ? `<div class="banner warn" role="status">AI-анализ недоступен в этом просмотре: откройте страницу в claude.ai. Разбор реплик и история работают.</div>` : "";
    $app.innerHTML = topbar() + (state.ui.rolePanel ? rolePanel() : "") +
      `<main class="wrap" id="top">${note}${ai}${body}</main>` +
      (state.toast ? `<div class="toast" role="status">${esc(state.toast)}</div>` : "") +
      (r.name === "session" ? `<button class="totop" data-action="totop">Наверх</button>` : "");
    window.scrollTo(0, scrollY);
  }

  function topbar() {
    const s = state.settings;
    const due = dueExercises().length;
    const link = (name, label, extra = "") =>
      `<a href="#${name}" ${state.route.name === name || (name === "sessions" && state.route.name === "session") ? 'aria-current="page"' : ""}>${label}${extra}</a>`;
    const roleShort = { candidate: "Кандидат", interviewer: "Интервьюер", coach: "Coach", observer: "Observer", free: "Свободный" }[s.defaultRole] || "Кандидат";
    return `<header class="topbar">
      <div class="brand">English Interview Analyst<small>прототип</small></div>
      <nav class="nav" aria-label="Разделы">
        ${link("home", "Обзор")}${link("sessions", "Занятия")}${link("new", "Новое занятие")}${link("errors", "Банк ошибок")}
        ${link("practice", "Практика", due ? ` <span class="pill accent">${due}</span>` : "")}${link("settings", "Настройки")}
      </nav>
      <button class="role-btn" data-action="role-panel" aria-expanded="${state.ui.rolePanel}">Роль / сценарий: ${esc(roleShort)}${s.defaultMarket ? " · " + esc(MARKETS[s.defaultMarket]) : ""}</button>
      <button data-action="theme" aria-label="Переключить тему">${currentTheme() === "dark" ? "Светлая" : "Тёмная"} тема</button>
    </header>`;
  }

  function rolePanel() {
    const s = state.settings;
    return `<div class="panel" role="dialog" aria-label="Роль и сценарий">
      <h3>Роль и сценарий по умолчанию</h3>
      <label class="field" for="rp-role">Ваша роль<select id="rp-role" data-setting="defaultRole">${opts(ROLES, s.defaultRole)}</select></label>
      <label class="field" for="rp-scn">Сценарий<select id="rp-scn" data-setting="defaultScenario">${opts(SCENARIOS, s.defaultScenario)}</select></label>
      <label class="field" for="rp-mkt">Рынок<select id="rp-mkt" data-setting="defaultMarket"><option value="">Не указан</option>${opts(MARKETS, s.defaultMarket)}</select></label>
      <label class="field" for="rp-mode">Режим<select id="rp-mode" data-setting="mode">${opts({ training: "Тренировка", exam: "Экзамен" }, s.mode)}</select></label>
      <label class="check"><input type="checkbox" id="rp-hints" data-setting="hints" ${s.hints ? "checked" : ""}> Подсказки в упражнениях</label>
      <p class="small muted">Применяется к новым занятиям и к AI-анализу (в режиме «Экзамен» подсказки в практике скрыты). Внешним AI-тьютором сервис не управляет — роль там меняется кнопкой в самом приложении.</p>
      <div class="row"><button data-action="role-panel">Закрыть</button></div>
    </div>`;
  }

  const opts = (map, selected) => Object.entries(map).map(([v, l]) => `<option value="${esc(v)}" ${v === selected ? "selected" : ""}>${esc(l)}</option>`).join("");
  const statusPill = (st) => `<span class="pill ${STATUS_PILL[st] || "grey"}">${esc(A.STATUS_RU[st] || st)}</span>`;
  const tile = (v, l, n = "") => `<div class="tile"><div class="v">${v}</div><div class="l">${l}</div>${n ? `<div class="n">${n}</div>` : ""}</div>`;

  // ---------------------------------------------------------------- Обзор
  function viewHome() {
    const list = sessionsSorted();
    if (!list.length) {
      return `<section class="card">
        <h1>Разбор занятий английским для интервью на Data Analyst</h1>
        <p>Вставьте расшифровку занятия с AI-тьютором — сервис восстановит порядок реплик, разберёт ваши ответы, заведёт банк повторяющихся ошибок и даст упражнения.</p>
        <ol class="plain"><li>Скопируйте занятие целиком, раскрыв все «Показать текст».</li><li>Вставьте в «Новое занятие» и проверьте порядок.</li><li>Запустите AI-анализ, затем тренируйтесь в «Практике».</li></ol>
        <div class="row"><a class="btn primary" href="#new" style="color:var(--accent-ink);background:var(--accent);border-color:var(--accent)">Добавить первое занятие</a></div>
      </section>`;
    }
    const analysed = list.filter((s) => currentAnalysis(s));
    const b = bank();
    const recurring = b.filter((e) => e.sessions >= 2 && e.status !== "mastered");
    const blockers = b.filter((e) => (e.priority === "P0" || e.priority === "P1") && e.status !== "mastered").slice(0, 5);
    const due = dueExercises().length;
    const calls = Object.values(state.analyses).reduce((a, x) => a + (x.calls || 0), 0);
    const totalWords = list.reduce((a, s) => a + (s.stats ? s.stats.learnerWords : 0), 0);
    const last = analysed[0];
    const lastA = last ? currentAnalysis(last) : null;
    const lastM = last ? metricsOf(last, lastA) : null;
    const prev = analysed[1];
    const prevM = prev ? metricsOf(prev, currentAnalysis(prev)) : null;

    let change = "Для сравнения нужно минимум два проанализированных занятия.";
    if (lastM && prevM && lastM.words && prevM.words) {
      const d = lastM.errorsPer100 - prevM.errorsPer100;
      change = `Ошибок на 100 слов: ${fmtNum(prevM.errorsPer100)} → ${fmtNum(lastM.errorsPer100)} (${d <= 0 ? "меньше" : "больше"} на ${fmtNum(Math.abs(d))}). ` +
        `Объём речи: ${prevM.words} → ${lastM.words} слов. Рост ошибок может быть связан с более длинными и сложными ответами.`;
    }
    const next = lastA && lastA.summary && lastA.summary.recommendations[0]
      ? esc(lastA.summary.recommendations[0])
      : last ? "Запустите AI-анализ последнего занятия." : `Запустите AI-анализ занятия «${esc(list[0].title)}».`;

    const trendRows = [...analysed].reverse().map((s) => {
      const m = metricsOf(s, currentAnalysis(s));
      const p1 = (m.byPriority.P0 || 0) + (m.byPriority.P1 || 0);
      const w = Math.min(100, (m.errorsPer100 || 0) * 5);
      return `<tr><td>${fmtDate(s.date)}</td><td><a href="#s-${esc(s.id)}">${esc(s.title)}</a></td><td class="r">${m.words}</td>
        <td class="r">${m.confirmed}</td><td class="r">${m.likely}</td><td class="r">${fmtNum(m.errorsPer100)}</td>
        <td style="min-width:90px"><div class="bar" style="width:${w}%" aria-hidden="true"></div></td><td class="r">${p1}</td></tr>`;
    }).join("");

    const cefr = lastA && lastA.summary ? lastA.summary.cefr : null;
    return `
      <section class="grid">
        <h1>Обзор</h1>
        <div class="tiles">
          ${tile(list.length, "Занятий", `проанализировано: ${analysed.length}`)}
          ${tile(totalWords, "Ваших слов всего", "по расшифровкам")}
          ${tile(lastM ? fmtNum(lastM.errorsPer100) : "—", "Ошибок на 100 слов", lastM ? `последнее занятие, ${lastM.words} слов` : "нет анализа")}
          ${tile(recurring.length, "Повторяющихся ошибок", "встречались в 2+ занятиях")}
          ${tile(due, "Упражнений к повторению", "на сегодня")}
          ${tile(calls, "Вызовов Claude", "в рамках вашей подписки")}
        </div>
      </section>
      <section class="two">
        <div class="card"><h2>Что изменилось</h2><p>${change}</p></div>
        <div class="card"><h2>Следующий шаг</h2><p>${next}</p>
          <div class="row">${due ? `<a href="#practice">Повторить ${due} упражнений</a>` : ""}${last && !lastA ? `<a href="#s-${esc(last.id)}">Открыть занятие</a>` : ""}</div></div>
      </section>
      <section class="card">
        <h2>Что мешает пройти интервью</h2>
        ${blockers.length ? `<table><thead><tr><th>Ошибка</th><th>Приоритет</th><th class="r">Раз</th><th class="r">Занятий</th><th>Статус</th></tr></thead><tbody>
          ${blockers.map((e) => `<tr><td><code>${esc(e.errorKey)}</code><div class="small muted">${esc(e.rule || e.explanation)}</div></td><td><span class="prio ${e.priority}">${e.priority}</span></td>
          <td class="r">${e.count}</td><td class="r">${e.sessions}</td><td><span class="pill ${MASTERY_PILL[e.status]}">${A.MASTERY_RU[e.status]}</span></td></tr>`).join("")}
        </tbody></table>` : `<p class="muted">Критичных ошибок (P0–P1) в банке нет${analysed.length ? "" : " — сначала запустите анализ"}.</p>`}
      </section>
      <section class="card">
        <h2>Динамика по занятиям</h2>
        ${trendRows ? `<div class="tablewrap"><table><thead><tr><th>Дата</th><th>Занятие</th><th class="r">Слов</th><th class="r">Ошибок</th><th class="r">Вероятных</th><th class="r">На 100 слов</th><th></th><th class="r">P0–P1</th></tr></thead><tbody>${trendRows}</tbody></table></div>
          <p class="small muted">На 100 слов = (ошибки + вероятные ошибки, кроме отмеченных вами «не ошибка») / слова ученика × 100. Сравнивайте с осторожностью: занятия разной длины и сложности.</p>` : `<p class="muted">Появится после первого анализа.</p>`}
      </section>
      <section class="card">
        <h2>Предварительный профиль CEFR</h2>
        ${cefr && cefr.dimensions.length ? cefrTable(cefr) + `<p class="small muted">По последнему занятию (${fmtDate(last.date)}). Один разговор — не экзамен; беглость и произношение по тексту не оцениваются.</p>` : `<p class="muted">Появится после анализа занятия.</p>`}
      </section>`;
  }

  function cefrTable(cefr) {
    return `<div class="tablewrap"><table><thead><tr><th>Навык</th><th>Диапазон</th><th class="r">Уверенность</th><th>Основания</th><th>Что проверить</th></tr></thead><tbody>
      ${cefr.dimensions.map((d) => `<tr><td>${esc(CEFR_RU[d.name] || d.name)}</td><td><strong>${esc(d.range)}</strong></td><td class="r">${fmtNum(d.confidence * 100, 0)}%</td>
      <td class="small">${d.evidence.map((e) => `«${esc(e)}»`).join("<br>")}</td><td class="small">${esc(d.toVerify)}</td></tr>`).join("")}
    </tbody></table></div>`;
  }

  // ---------------------------------------------------------------- Занятия
  function viewSessions() {
    const list = sessionsSorted();
    return `<section class="grid">
      <div class="row between"><h1>Занятия</h1><a class="btn primary" href="#new" style="color:var(--accent-ink);background:var(--accent);border-color:var(--accent)">Добавить занятие</a></div>
      ${list.length ? list.map((s) => {
        const a = currentAnalysis(s);
        const run = state.running[s.id];
        const st = run ? `<span class="pill accent">анализ идёт</span>` : a ? `<span class="pill ok">анализ v${a.version}${a.status === "partial" ? ", частично" : ""}</span>` : `<span class="pill grey">без анализа</span>`;
        return `<a class="card" href="#s-${esc(s.id)}" style="text-decoration:none;color:inherit">
          <div class="row between"><strong>${esc(s.title)}</strong>${st}</div>
          <div class="small muted">${fmtDate(s.date)} · ${esc(SCENARIOS[s.scenario] || "")} · ваших реплик: ${s.stats.learnerTurns} · слов: ${s.stats.learnerWords}</div>
        </a>`;
      }).join("") : `<div class="card"><p>Занятий пока нет.</p></div>`}
    </section>`;
  }

  // ---------------------------------------------------------------- Новое занятие
  function viewNew() {
    const d = state.draft || (state.draft = newDraft());
    const p = d.preview;
    let preview = "";
    if (p) {
      const unknownLeft = p.turns.filter((t) => d.roles[t.index] === "unknown").length;
      const overrides = p.turns.filter((t) => d.roles[t.index] !== t.role).length;
      const needConfirm = p.needsConfirmation || overrides > 0;
      const dup = p.duplicateOf ? state.sessions[p.duplicateOf] : null;
      preview = `
      <section class="card">
        <h2>2. Проверка порядка и ролей</h2>
        <div class="tiles">
          ${tile(p.appliedDirection === "reverse" ? "Обратный" : "Прямой", "Порядок в тексте", `уверенность ${{ high: "высокая", medium: "средняя", low: "низкая" }[p.confidenceLabel]} (${fmtNum(p.confidence, 2)})`)}
          ${tile(p.stats.learnerTurns, "Ваших реплик", `${p.stats.learnerWords} слов`)}
          ${tile(p.stats.tutorTurns, "Реплик AI", `без текста: ${p.stats.collapsedTutorTurns}`)}
          ${tile(fmtSec(p.stats.learnerSpeechSeconds), "Ваши голосовые", "сумма длительностей")}
        </div>
        ${p.scenarioTitle ? `<p>Сценарий из текста: <strong>${esc(p.scenarioTitle)}</strong></p>` : ""}
        ${dup ? `<div class="banner warn">Этот текст уже сохранён: <a href="#s-${esc(dup.id)}">${esc(dup.title)}</a>. Можно сохранить ещё раз как отдельное занятие.</div>` : ""}
        ${p.warnings.length ? `<div class="banner warn"><strong>Обратите внимание</strong><ul class="plain">${p.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
        <details><summary>Почему выбран такой порядок</summary><ul class="plain">${p.signals.map((s) => `<li>${esc(s.detail)} <span class="muted">${s.vote === 0 ? "(не влияет)" : s.vote > 0 ? "→ прямой" : "→ обратный"}</span></li>`).join("")}</ul></details>
        <details><summary>Убрано из анализа: ${p.removed.filter((x) => x.reason !== "timestamp").length} строк</summary><ul class="plain">${p.removed.filter((x) => x.reason !== "timestamp").map((x) => `<li>стр. ${x.line}: «${esc(x.text)}»</li>`).join("")}</ul></details>
        <div class="row"><button data-action="flip">Перевернуть порядок</button>${d.order !== "auto" ? `<button data-action="reparse" data-order="auto">Вернуть автоопределение</button>` : ""}</div>
      </section>
      <section class="grid">
        <h2>Диалог по порядку</h2>
        <p class="muted small">Первая реплика — начало занятия. Если роль определена неверно, поменяйте её.</p>
        ${p.turns.map((t) => turnHtml(t, d.roles[t.index], d.userRole, `<select aria-label="Роль реплики ${t.index + 1}" data-role-idx="${t.index}">
          ${opts({ learner: "Вы", tutor: "AI", unknown: "Не определено" }, d.roles[t.index])}</select>`)).join("")}
      </section>
      <section class="card">
        <h2>3. Сохранение</h2>
        <div class="form">
          <label class="field" for="nd-title">Название<input id="nd-title" data-draft="title" value="${esc(d.title)}" maxlength="200"></label>
          <label class="field" for="nd-date">Дата занятия<input id="nd-date" type="date" data-draft="date" value="${esc(d.date)}"></label>
          <label class="field" for="nd-role">Ваша роль<select id="nd-role" data-draft="userRole">${opts(ROLES, d.userRole)}</select></label>
          <label class="field" for="nd-scn">Сценарий<select id="nd-scn" data-draft="scenario">${opts(SCENARIOS, d.scenario)}</select></label>
          <label class="field" for="nd-mkt">Рынок<select id="nd-mkt" data-draft="market"><option value="">Не указан</option>${opts(MARKETS, d.market)}</select></label>
        </div>
        ${needConfirm ? `<label class="check"><input type="checkbox" id="nd-confirm" data-draft-check="confirmed" ${d.confirmed ? "checked" : ""}> Я проверил порядок и роли реплик</label>` : ""}
        ${unknownLeft ? `<p class="muted">Осталось указать роль для ${unknownLeft} реплик.</p>` : ""}
        <div class="row">
          <button class="primary" data-action="save-session" data-analyse="1" ${unknownLeft || (needConfirm && !d.confirmed) || !state.sample ? "disabled" : ""}>Сохранить и запустить анализ</button>
          <button data-action="save-session" ${unknownLeft || (needConfirm && !d.confirmed) ? "disabled" : ""}>Только сохранить</button>
        </div>
      </section>`;
    }
    return `<section class="grid">
      <h1>Новое занятие</h1>
      <p class="muted">Вставьте расшифровку целиком, как скопировали из приложения. Служебные надписи уберутся автоматически, оригинал сохранится без изменений.</p>
      <section class="card">
        <h2>1. Расшифровка</h2>
        <label class="hidden" for="nd-raw">Текст расшифровки</label>
        <textarea id="nd-raw" class="raw" data-draft="raw" placeholder="Вставьте сюда текст занятия…">${esc(d.raw)}</textarea>
        <div class="row">
          <label class="field" for="nd-order">Порядок реплик<select id="nd-order" data-draft="order">${opts({ auto: "Определить автоматически", reverse: "Обратный — новые сверху", chronological: "Прямой — по времени" }, d.order)}</select></label>
          <button class="primary" data-action="reparse" style="align-self:end">Разобрать</button>
          <span class="muted small" style="align-self:end">${d.raw.length.toLocaleString("ru-RU")} символов</span>
        </div>
      </section>
    </section>${preview}`;
  }

  function turnHtml(t, role, userRole, control, inner) {
    const who = role === "learner"
      ? (userRole === "interviewer" ? "Вы · интервьюер" : userRole === "candidate" ? "Вы · кандидат" : "Вы")
      : role === "tutor" ? (userRole === "candidate" ? "AI · интервьюер" : userRole === "interviewer" ? "AI · кандидат" : "AI-тьютор") : "Роль не определена";
    const flags = (t.flags || []).map((f) => FLAG_RU[f]).filter(Boolean).map((f) => `<span class="chip">${esc(f)}</span>`).join("");
    const text = t.text ? (inner || esc(t.text)) : "";
    return `<article class="turn ${role}" id="turn-${t.index}">
      <div class="head"><span class="num">#${t.index + 1}</span>${control || `<span class="who">${who}</span>`}
        ${t.durationSec !== null && t.durationSec !== undefined ? `<span class="chip">${fmtSec(t.durationSec)}</span>` : ""}${flags}</div>
      ${t.text ? `<div class="text">${text}</div>` : `<div class="text empty">Текст реплики не попал в копию («Показать текст»).</div>`}
    </article>`;
  }

  async function sha256(text) {
    try {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      let h = 0;
      for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
      return "fallback-" + (h >>> 0).toString(16) + "-" + text.length;
    }
  }

  async function reparse(order) {
    const d = state.draft;
    if (!d.raw.trim()) { toast("Вставьте текст занятия."); return; }
    if (d.raw.length > 200000) { toast("Текст длиннее 200 000 символов."); return; }
    d.order = order || d.order;
    const p = P.parseTranscript(d.raw, d.order, state.settings.preferredOrder || null);
    const sha = await sha256(d.raw);
    p.sha = sha;
    p.duplicateOf = (Object.values(state.sessions).find((s) => s.sha === sha) || {}).id || null;
    d.preview = p;
    d.roles = Object.fromEntries(p.turns.map((t) => [t.index, t.role]));
    d.confirmed = false;
    d.title = p.scenarioTitle || d.title;
    if (p.scenarioTitle) {
      const t = p.scenarioTitle.toLowerCase();
      if (t.includes("снг")) d.market = "cis";
      else if (t.includes("международ") || t.includes("international")) d.market = "international";
    }
    render();
  }

  async function saveSession(analyse) {
    const d = state.draft;
    const p = d.preview;
    if (!p) return;
    const id = rid("s");
    const turns = p.turns.map((t) => ({
      index: t.index, role: d.roles[t.index], text: t.text, wordCount: t.wordCount,
      durationSec: t.durationSec, rawTimestamp: t.rawTimestamp, lineStart: t.lineStart, lineEnd: t.lineEnd,
      flags: d.roles[t.index] !== t.role ? [...t.flags, "role_overridden"] : t.flags,
    }));
    const learner = turns.filter((t) => t.role === "learner");
    const session = {
      id, title: (d.title || "").trim() || p.scenarioTitle || `Занятие ${fmtDate(d.date || today())}`,
      date: d.date || today(), scenario: d.scenario, scenarioTitle: p.scenarioTitle, userRole: d.userRole, market: d.market || null,
      raw: d.raw, sha: p.sha, createdAt: nowIso(),
      parser: { version: p.parserVersion, detected: p.detectedDirection, applied: p.appliedDirection, confidence: p.confidence, signals: p.signals, warnings: p.warnings, removed: p.removed.length },
      turns,
      stats: { ...p.stats, learnerTurns: learner.length, tutorTurns: turns.filter((t) => t.role === "tutor").length, learnerWords: learner.reduce((a, t) => a + P.englishWords(t.text), 0) },
      currentAnalysis: null, disputed: [], feedback: {},
    };
    try {
      await put("sessions", id, session);
    } catch {
      return;
    }
    await saveSettings({ preferredOrder: p.appliedDirection });
    state.draft = newDraft();
    location.hash = `#s-${id}`;
    if (analyse) setTimeout(() => runAnalysis(id), 50);
  }

  // ---------------------------------------------------------------- AI
  function extractJson(text) {
    const s = String(text || "");
    const a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a < 0 || b <= a) throw new Error("Ответ модели не содержит JSON.");
    return JSON.parse(s.slice(a, b + 1));
  }
  async function askJson(prompt, tier, signal) {
    const o = { modelTier: tier, signal, cache: false };
    if (typeof state.sample.json === "function") {
      try {
        return await state.sample.json(prompt, o);
      } catch (e) {
        if (signal && signal.aborted) throw e;
        if (e && (e.code === "not_granted" || e.code === "rate_limited")) throw e;
      }
    }
    const r = await state.sample(prompt, o);
    return extractJson(r.text);
  }
  async function pool(tasks, n) {
    let i = 0;
    const worker = async () => { while (i < tasks.length) { const k = i++; await tasks[k](); } };
    await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  }
  function sessionForPrompt(s) {
    return { title: s.title, scenarioTitle: s.scenarioTitle || SCENARIOS[s.scenario], userRole: s.userRole, market: s.market };
  }

  async function runAnalysis(sid) {
    const s = state.sessions[sid];
    if (!s || state.running[sid]) return;
    if (!state.sample) { toast("AI недоступен в этом просмотре. Откройте страницу в claude.ai."); return; }
    const lang = state.settings.feedbackLanguage || "ru";
    const tier = state.settings.modelTier || "complex";
    const version = (analysesFor(sid)[0] || { version: 0 }).version + 1;
    const aid = `${sid}_v${version}`;
    const learner = s.turns.filter((t) => t.role === "learner" && t.text);
    const groups = A.batches(learner.map((t) => t.index));
    const ctrl = new AbortController();
    const run = { stage: "Разбор реплик", done: 0, total: groups.length + 2, ctrl, started: Date.now() };
    state.running[sid] = run;
    const turnsByIdx = Object.fromEntries(s.turns.map((t) => [t.index, t]));
    const known = bank().map((e) => e.errorKey).slice(0, 40);
    const an = {
      id: aid, sessionId: sid, version, promptVersion: A.PROMPT_VERSION, parserVersion: P.PARSER_VERSION, tier, lang,
      status: "running", createdAt: nowIso(), turnResults: {}, dropped: [], missing: [], calls: 0, errors: [], summary: null, exerciseIds: [],
    };
    render();
    const fatal = (e) => e && (e.code === "not_granted" || e.code === "rate_limited" || ctrl.signal.aborted);
    try {
      await put("analyses", aid, an);
      const callBatch = async (group, depth) => {
        try {
          const raw = await askJson(A.batchPrompt(sessionForPrompt(s), s.turns, group.map((i) => "t" + i), known, lang), tier, ctrl.signal);
          an.calls += 1;
          const v = A.validateBatch(raw, turnsByIdx, group);
          Object.assign(an.turnResults, v.turns);
          an.dropped.push(...v.dropped);
          if (v.missing.length && depth === 0 && v.missing.length < group.length) await callBatch(v.missing, 1);
          else an.missing.push(...v.missing);
        } catch (e) {
          an.calls += 1;
          if (fatal(e)) throw e;
          if (group.length > 1 && depth === 0) {
            const h = Math.ceil(group.length / 2);
            await callBatch(group.slice(0, h), 1);
            await callBatch(group.slice(h), 1);
          } else {
            an.errors.push(`Реплики ${group.map((i) => "#" + (i + 1)).join(", ")}: ${(e && e.message) || "ошибка ответа модели"}`);
            an.missing.push(...group);
          }
        }
      };
      await pool(groups.map((g) => async () => { await callBatch(g, 0); run.done += 1; renderSoon(); }), 2);
      await put("analyses", aid, an);

      run.stage = "Сводка и интервью-анализ";
      renderSoon();
      const digest = A.digestForSummary(an.turnResults, s.disputed || []);
      try {
        const raw = await askJson(A.summaryPrompt(sessionForPrompt(s), s.turns, digest, lang), tier, ctrl.signal);
        an.calls += 1;
        an.summary = A.validateSummary(raw);
      } catch (e) {
        an.calls += 1;
        if (fatal(e)) throw e;
        an.errors.push("Сводка: " + ((e && e.message) || "ошибка ответа модели"));
      }
      run.done += 1;
      await put("analyses", aid, an);

      run.stage = "Упражнения";
      renderSoon();
      if (digest.length) {
        try {
          const items = digest.slice(0, 5).map((x) => ({ error_key: x.error_key, category: x.category, examples: x.examples }));
          const raw = await askJson(A.exercisesPrompt(items, lang, Math.min(10, items.length * 2)), tier === "complex" ? "default" : tier, ctrl.signal);
          an.calls += 1;
          for (const ex of A.validateExercises(raw)) {
            const xid = rid("x");
            await put("exercises", xid, { id: xid, ...ex, sourceSessionId: sid, createdAt: nowIso(), srs: { box: 0, due: today() }, attempts: [] });
            an.exerciseIds.push(xid);
          }
        } catch (e) {
          an.calls += 1;
          if (fatal(e)) throw e;
          an.errors.push("Упражнения: " + ((e && e.message) || "ошибка ответа модели"));
        }
      }
      run.done += 1;
      an.status = an.missing.length || an.errors.length ? "partial" : "done";
      an.finishedAt = nowIso();
      an.durationSec = Math.round((Date.now() - run.started) / 1000);
      await put("analyses", aid, an);
      await patch("sessions", sid, { currentAnalysis: aid });
      delete state.ui.version[sid];
      toast(an.status === "done" ? "Анализ готов." : "Анализ готов частично — подробности в разделе «Методика».");
    } catch (e) {
      an.status = "failed";
      an.errors.push(ctrl.signal.aborted ? "Остановлено пользователем." : e && e.code === "not_granted" ? "Нет разрешения на вызов Claude." : e && e.code === "rate_limited" ? "Лимит запросов к Claude. Попробуйте позже." : (e && e.message) || "Ошибка");
      try { await put("analyses", aid, an); } catch { /* уже показано */ }
      toast(an.errors[an.errors.length - 1]);
    } finally {
      delete state.running[sid];
      render();
    }
  }

  // ---------------------------------------------------------------- Отчёт по занятию
  function highlight(text, issues) {
    const list = [...issues].sort((a, b) => a.start - b.start);
    let out = "", pos = 0;
    for (const i of list) {
      if (i.start < pos) continue;
      out += esc(text.slice(pos, i.start));
      out += `<mark class="s-${i.status}" data-issue="${esc(i.id)}" title="${esc(A.STATUS_RU[i.status])}: ${esc(i.minimalCorrection || i.explanation)}">${esc(text.slice(i.start, i.end))}<sup>${i.n}</sup></mark>`;
      pos = i.end;
    }
    return out + esc(text.slice(pos));
  }
  function applyCorrections(text, issues) {
    const list = issues.filter((i) => A.ERROR_STATUSES.has(i.status) && i.minimalCorrection).sort((a, b) => b.start - a.start);
    let out = text, lastStart = Infinity;
    for (const i of list) {
      if (i.end > lastStart) continue;
      out = out.slice(0, i.start) + i.minimalCorrection + out.slice(i.end);
      lastStart = i.start;
    }
    return out;
  }

  function viewSession(id) {
    const s = state.sessions[id];
    if (!s) return `<div class="card"><p>Занятие не найдено. <a href="#sessions">К списку</a></p></div>`;
    const a = currentAnalysis(s);
    const run = state.running[id];
    const versions = analysesFor(id);
    const disputed = new Set(s.disputed || []);
    const m = metricsOf(s, a);
    const res = a ? a.turnResults || {} : {};
    // Данные из хранилища заморожены — нумеруем копии.
    let n = 0;
    const allIssues = [];
    const byTurn = {};
    s.turns.forEach((t) => {
      byTurn[t.index] = (res[t.index] ? res[t.index].issues : []).map((i) => ({ ...i, n: ++n }));
      allIssues.push(...byTurn[t.index]);
    });
    const b = bank();
    const bankByKey = Object.fromEntries(b.map((e) => [e.errorKey, e]));
    const sum = a && a.summary;

    const head = `<section class="grid">
      <div class="row between">
        <div class="grid" style="gap:4px"><h1>${esc(s.title)}</h1>
          <div class="row small muted"><span>${fmtDate(s.date)}</span><span>·</span><span>${esc(ROLES[s.userRole] || "")}</span><span>·</span><span>${esc(SCENARIOS[s.scenario] || "")}</span>${s.market ? `<span>·</span><span>${esc(MARKETS[s.market])}</span>` : ""}
          ${a ? `<span class="pill ${a.status === "done" ? "ok" : a.status === "partial" ? "warn" : "bad"}">анализ v${a.version}${a.status === "partial" ? " · частично" : a.status === "failed" ? " · ошибка" : ""}</span>` : `<span class="pill grey">без анализа</span>`}</div></div>
        <div class="row">
          ${run ? `<button data-action="stop" data-id="${esc(id)}">Остановить</button>` : `<button class="primary" data-action="analyse" data-id="${esc(id)}" ${state.sample ? "" : "disabled"}>${a ? "Повторить анализ" : "Запустить AI-анализ"}</button>`}
          ${versions.length > 1 ? `<label class="field" for="ver-sel">Версия<select id="ver-sel" data-version="${esc(id)}">${versions.map((v) => `<option value="${esc(v.id)}" ${a && a.id === v.id ? "selected" : ""}>v${v.version} · ${fmtDate(String(v.createdAt).slice(0, 10))} · ${v.status}</option>`).join("")}</select></label>` : ""}
          ${state.downloads ? `<button data-action="export-report" data-id="${esc(id)}">Скачать отчёт</button>` : ""}
          <button data-action="goto" data-target="sec-source">Исходный текст</button>
        </div>
      </div>
      ${run ? `<div class="card"><div class="row between"><strong>${esc(run.stage)}…</strong><span class="muted small">${run.done} из ${run.total} шагов</span></div><div class="progress"><div style="width:${Math.round((run.done / run.total) * 100)}%"></div></div><p class="small muted">Обычно 1–3 минуты. Страницу можно не держать открытой на этом разделе, но не закрывайте вкладку.</p></div>` : ""}
    </section>`;

    const summaryBlock = sum ? `<section class="card">
        <p class="headline">${esc(sum.headline)}</p>
        <div class="two">
          <div><h3>Сильные стороны</h3><ul class="plain">${sum.strengths.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
          <div><h3>Главные проблемы</h3><ul class="plain">${sum.keyProblems.map((k) => `<li><strong>${esc(k.title)}</strong> <code class="small">${esc(k.errorKey)}</code>${bankByKey[k.errorKey] && bankByKey[k.errorKey].sessions > 1 ? ` <span class="pill bad">повторяется</span>` : ""}<div class="small muted">${esc(k.why)}</div></li>`).join("")}</ul></div>
        </div>
        ${sum.mainCorrection ? `<div><h3>Главное исправление</h3><p><span class="mono">${esc(sum.mainCorrection.before)}</span> → <span class="mono" style="color:var(--ok)">${esc(sum.mainCorrection.after)}</span></p><p class="small muted">${esc(sum.mainCorrection.why)}</p></div>` : ""}
        <div><h3>Следующий шаг</h3><ul class="plain">${sum.recommendations.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      </section>` : a ? `<section class="card"><p class="muted">Сводка не построена${a.status === "running" ? " — анализ ещё идёт" : ""}. Подробности — в разделе «Методика и уверенность».</p></section>` : `<section class="card"><p>Занятие сохранено и разобрано на реплики. Запустите AI-анализ, чтобы получить ошибки, исправления, интервью-оценку и упражнения.</p></section>`;

    const tiles = `<div class="tiles">
        ${tile(m.words, "Ваших слов", `${m.learnerTurns} реплик, медиана ${fmtNum(m.medianWordsPerTurn, 0)} слов`)}
        ${tile(a ? m.confirmed : "—", "Ошибок", a ? `${fmtNum(m.confirmedPer100)} на 100 слов` : "нет анализа")}
        ${tile(a ? m.likely : "—", "Вероятных ошибок", a ? "требуют проверки" : "")}
        ${tile(a ? allIssues.filter((i) => A.ERROR_STATUSES.has(i.status) && bankByKey[i.errorKey] && bankByKey[i.errorKey].sessions > 1).length : "—", "Повторы из прошлых занятий", "")}
        ${tile(a && m.interview.n ? fmtNum(m.interview.answeredShare * 100, 0) + "%" : "—", "Ответов по существу вопроса", a ? `из ${m.interview.n} интервью-ответов` : "")}
        ${tile(fmtSec(s.stats.learnerSpeechSeconds), "Ваши голосовые", "сумма длительностей")}
      </div>`;

    const toc = [
      ["sec-overview", "1 Обзор"], ["sec-conversation", "2 Диалог"], ["sec-errors", "3 Ошибки"], ["sec-corrections", "4 Исправления"],
      ["sec-vocab", "5 Лексика"], ["sec-grammar", "6 Грамматика"], ["sec-interview", "7 Интервью"], ["sec-speech", "8 Речь (аудио)"],
      ["sec-stats", "9 Статистика"], ["sec-exercises", "10 Упражнения"], ["sec-next", "11 Следующие шаги"], ["sec-method", "12 Методика"], ["sec-source", "Исходный текст"],
    ];

    // Диалог
    const conv = s.turns.map((t) => {
      const r = res[t.index];
      const issues = byTurn[t.index].filter((i) => !disputed.has(i.id));
      return turnHtml(t, t.role, s.userRole, null, r ? highlight(t.text, issues) : null);
    }).join("");

    // Ошибки
    const f = state.ui.filters;
    const cats = [...new Set(allIssues.map((i) => i.category))];
    let issues = allIssues.filter((i) =>
      (!f.prio || i.priority === f.prio) && (!f.cat || i.category === f.cat) && (!f.status || i.status === f.status) &&
      (!f.recurring || (bankByKey[i.errorKey] && bankByKey[i.errorKey].sessions > 1)) &&
      (!f.q || (i.evidence + " " + i.minimalCorrection + " " + i.explanation + " " + i.errorKey).toLowerCase().includes(f.q.toLowerCase())));
    if (f.sort === "priority") issues = [...issues].sort((x, y) => x.priority.localeCompare(y.priority) || y.confidence - x.confidence);
    if (f.sort === "confidence") issues = [...issues].sort((x, y) => y.confidence - x.confidence);
    const errorsSec = a ? `
      <div class="filters">
        <label class="field" for="f-prio">Приоритет<select id="f-prio" data-filter="prio"><option value="">Все</option>${opts({ P0: "P0", P1: "P1", P2: "P2", P3: "P3" }, f.prio)}</select></label>
        <label class="field" for="f-cat">Тип<select id="f-cat" data-filter="cat"><option value="">Все</option>${opts(Object.fromEntries(cats.map((c) => [c, A.CATEGORY_RU[c] || c])), f.cat)}</select></label>
        <label class="field" for="f-st">Статус<select id="f-st" data-filter="status"><option value="">Все</option>${opts(A.STATUS_RU, f.status)}</select></label>
        <label class="field" for="f-sort">Сортировка<select id="f-sort" data-filter="sort">${opts({ order: "По ходу занятия", priority: "По приоритету", confidence: "По уверенности" }, f.sort)}</select></label>
        <label class="field" for="f-q">Поиск<input id="f-q" data-filter="q" value="${esc(f.q)}" placeholder="слово или ключ"></label>
        <label class="check"><input type="checkbox" id="f-rec" data-filter-check="recurring" ${f.recurring ? "checked" : ""}> Только повторяющиеся</label>
      </div>
      <p class="small muted">Показано ${issues.length} из ${allIssues.length}. Отклонено кодом при проверке: ${(a.dropped || []).length} (см. «Методика»).</p>
      ${issues.map((i) => issueCard(i, s, bankByKey[i.errorKey], disputed.has(i.id))).join("") || `<p class="muted">Нет замечаний по выбранным фильтрам.</p>`}` : `<p class="muted">Появится после анализа.</p>`;

    // Исправления по репликам (A–H)
    const corrections = a ? s.turns.filter((t) => t.role === "learner" && res[t.index]).map((t) => {
      const r = res[t.index];
      const iss = byTurn[t.index].filter((i) => !disputed.has(i.id));
      const alts = iss.flatMap((i) => i.alternatives).filter(Boolean);
      return `<details class="card"><summary><strong>Реплика #${t.index + 1}</strong> <span class="muted small">${esc(r.communicativeTask)}</span> ${iss.filter((i) => A.ERROR_STATUSES.has(i.status)).length ? `<span class="pill bad">${iss.filter((i) => A.ERROR_STATUSES.has(i.status)).length} ош.</span>` : `<span class="pill ok">без ошибок</span>`}</summary>
        <div class="versions">
          <div class="ver"><div class="k">A. Оригинал</div><div class="t">${highlight(t.text, iss)}</div></div>
          <div class="ver"><div class="k">B. Минимальное исправление</div><div class="t">${esc(applyCorrections(t.text, iss))}</div></div>
          ${r.naturalVersion ? `<div class="ver"><div class="k">C. Естественно (B2)</div><div class="t">${esc(r.naturalVersion)}</div></div>` : ""}
          ${r.interviewVersion ? `<div class="ver"><div class="k">D. Для интервью</div><div class="t">${esc(r.interviewVersion)}</div></div>` : ""}
          ${alts.length ? `<div class="ver"><div class="k">E. Альтернативы</div><div class="t">${alts.map(esc).join("<br>")}</div></div>` : ""}
          ${iss.length ? `<div class="ver"><div class="k">F. Объяснение</div><div class="t">${iss.map((i) => `<sup>${i.n}</sup> ${esc(i.explanation)}`).join("<br>")}</div></div>` : ""}
          ${r.transferRule ? `<div class="ver"><div class="k">G. Правило переноса</div><div class="t">${esc(r.transferRule)}</div></div>` : ""}
          ${r.practiceTask ? `<div class="ver"><div class="k">H. Задание</div><div class="t">${esc(r.practiceTask)}</div></div>` : ""}
          ${r.strengths.length ? `<div class="ver"><div class="k">Удачно</div><div class="t">${r.strengths.map((x) => `«${esc(x.evidence)}» — ${esc(x.note)}`).join("<br>")}</div></div>` : ""}
        </div></details>`;
    }).join("") : `<p class="muted">Появится после анализа.</p>`;

    // Лексика
    const vocab = sum && sum.vocabulary.length ? `<div class="tablewrap"><table><thead><tr><th>Выражение</th><th>Значение</th><th>Пример для интервью</th><th>Источник</th></tr></thead><tbody>
      ${sum.vocabulary.map((v) => `<tr><td><strong>${esc(v.phrase)}</strong></td><td>${esc(v.meaning)}</td><td>${esc(v.example)}</td><td>${v.source === "used" ? "вы употребили" : "предложено"}</td></tr>`).join("")}</tbody></table></div>` : "";
    const lexIssues = allIssues.filter((i) => ["lexical_choice", "collocations", "word_formation", "phrasal_verbs_idioms"].includes(i.category) && !disputed.has(i.id));
    const vocabSec = `<div class="tiles">${tile(m.uniqueForms, "Разных словоформ", "без лемматизации")}${tile(fmtNum(m.ttr, 2), "TTR", "разные / все слова")}${tile(fmtNum(m.mattr50, 2), "MATTR-50", m.mattr50 === null ? "нужно ≥ 50 слов" : "устойчивее к длине")}${tile(lexIssues.length, "Лексических замечаний", "выбор слова, сочетаемость")}</div>
      ${vocab || `<p class="muted">Словарь выражений появится после анализа.</p>`}
      <p class="small muted">Слово не считается активным после одного употребления: в словарь «вы употребили» попадает только то, что встретилось в ваших репликах.</p>`;

    // Грамматика
    const gram = Object.entries(m.byCategory).sort((x, y) => y[1] - x[1]);
    const maxG = Math.max(1, ...gram.map((g) => g[1]));
    const grammarSec = a ? (gram.length ? `<div class="tablewrap"><table><thead><tr><th>Тип</th><th class="r">Ошибок</th><th class="r">На 100 слов</th><th></th></tr></thead><tbody>
      ${gram.map(([c, k]) => `<tr><td>${esc(A.CATEGORY_RU[c] || c)}</td><td class="r">${k}</td><td class="r">${fmtNum((k / Math.max(1, m.words)) * 100)}</td><td style="min-width:120px"><div class="bar" style="width:${(k / maxG) * 100}%" aria-hidden="true"></div></td></tr>`).join("")}</tbody></table></div>` : `<p>Ошибок не найдено.</p>`) : `<p class="muted">Появится после анализа.</p>`;

    // Интервью
    const ivRows = s.turns.filter((t) => res[t.index] && res[t.index].interview).map((t) => {
      const v = res[t.index].interview;
      return `<tr><td><button class="ghost" data-action="goto" data-target="turn-${t.index}">#${t.index + 1}</button></td><td>${{ yes: "да", partly: "частично", no: "нет" }[v.answered]}</td><td class="r">${v.structure ?? "—"}</td><td class="r">${v.specificity ?? "—"}</td><td class="r">${v.contribution ?? "—"}</td><td class="r">${v.impact ?? "—"}</td><td class="r">${v.technical ?? "—"}</td><td class="small">${esc(v.notes)}</td></tr>`;
    }).join("");
    const iv = sum ? sum.interview : null;
    const interviewSec = a ? `
      ${ivRows ? `<div class="tablewrap"><table><thead><tr><th>Реплика</th><th>Ответ на вопрос</th><th class="r">Структура</th><th class="r">Конкретика</th><th class="r">Личный вклад</th><th class="r">Результат</th><th class="r">Тех. ясность</th><th>Комментарий</th></tr></thead><tbody>${ivRows}</tbody></table></div><p class="small muted">Оценки 1–5 от модели по каждой реплике; средние: структура ${fmtNum(m.interview.structure)}, конкретика ${fmtNum(m.interview.specificity)}, вклад ${fmtNum(m.interview.contribution)}, результат ${fmtNum(m.interview.impact)}.</p>` : `<p class="muted">Интервью-ответов не найдено.</p>`}
      ${iv ? `<div class="grid">
        ${iv.overall ? `<div><h3>Общая оценка</h3><p>${esc(iv.overall)}</p></div>` : ""}
        ${iv.star ? `<div><h3>Структура (STAR)</h3><p>${esc(iv.star)}</p></div>` : ""}
        ${iv.chronology ? `<div><h3>Хронология</h3><p>${esc(iv.chronology)}</p></div>` : ""}
        ${iv.contradictions.length ? `<div><h3>Противоречия</h3><ul class="plain">${iv.contradictions.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
        ${iv.clarifying ? `<div><h3>Уточняющие вопросы</h3><p>${esc(iv.clarifying)}</p></div>` : ""}
        ${iv.shortDraft ? `<div><div class="row between"><h3>Короткий ответ о себе (30–60 с)</h3><button data-action="copy" data-text="${esc(iv.shortDraft)}">Копировать</button></div><div class="draft">${esc(iv.shortDraft)}</div></div>` : ""}
        ${iv.longDraft ? `<div><div class="row between"><h3>Развёрнутый ответ (2–3 мин)</h3><button data-action="copy" data-text="${esc(iv.longDraft)}">Копировать</button></div><div class="draft">${esc(iv.longDraft)}</div></div>` : ""}
        <p class="small muted">Черновики собраны только из фактов вашей речи. Поля вида [X%] заполните реальными данными — сервис их не придумывает.</p>
      </div>` : ""}` : `<p class="muted">Появится после анализа.</p>`;

    // Статистика
    const statRows = [
      ["Реплик ученика", m.learnerTurns, "число реплик с ролью «вы»", ""],
      ["Слов", m.words, "латинские слова в ваших репликах", "числа и русские слова не считаются"],
      ["Предложений", m.sentences, "фрагменты между . ! ?", "в устной расшифровке границы условны"],
      ["Слов на реплику (среднее / медиана)", `${fmtNum(m.meanWordsPerTurn)} / ${fmtNum(m.medianWordsPerTurn, 0)}`, "слова / реплики", ""],
      ["Ошибки (подтверждённые)", a ? m.confirmed : "—", "статус confirmed_error, без «не ошибка»", "фрагмент проверен в тексте кодом"],
      ["Вероятные ошибки", a ? m.likely : "—", "статус likely_issue", "нужна проверка"],
      ["Ошибок на 100 слов", a ? fmtNum(m.confirmedPer100) : "—", "подтверждённые / слова × 100", `выборка ${m.words} слов`],
      ["Ошибок + вероятных на 100 слов", a ? fmtNum(m.errorsPer100) : "—", "(подтв. + вероятн.) / слова × 100", ""],
      ["Отмечено вами «не ошибка»", a ? m.disputedCount : "—", "исключено из всех метрик", ""],
      ["TTR", fmtNum(m.ttr, 2), "разные словоформы / все слова", "падает с ростом длины текста"],
      ["MATTR-50", fmtNum(m.mattr50, 2), "средний TTR в окне 50 слов", "нужно ≥ 50 слов"],
    ];
    const prioRow = a ? `<p class="small">По приоритету: ${["P0", "P1", "P2", "P3"].map((p) => `<span class="prio ${p}">${p}</span> ${m.byPriority[p] || 0}`).join(" · ")}. По статусу: ${Object.entries(m.byStatus).map(([k, v]) => `${esc(A.STATUS_RU[k] || k)} — ${v}`).join(", ") || "—"}.</p>` : "";
    const statsSec = `<div class="tablewrap"><table><thead><tr><th>Показатель</th><th class="r">Значение</th><th>Формула</th><th>Ограничения</th></tr></thead><tbody>
      ${statRows.map((r) => `<tr><td>${r[0]}</td><td class="r">${r[1]}</td><td class="small">${r[2]}</td><td class="small muted">${r[3]}</td></tr>`).join("")}</tbody></table></div>${prioRow}`;

    // Упражнения
    const exs = Object.values(state.exercises).filter((x) => x.sourceSessionId === id);
    const exSec = exs.length ? `<p>Создано упражнений: ${exs.length}, к повторению сегодня: ${exs.filter((x) => !x.srs || x.srs.due <= today()).length}.</p>
      <ul class="plain">${exs.slice(0, 10).map((x) => `<li><span class="chip">${esc(EX_TYPES[x.type])}</span> ${esc(x.prompt.slice(0, 140))}</li>`).join("")}</ul>
      <div class="row"><a href="#practice" data-action="practice-session" data-id="${esc(id)}">Перейти к практике</a></div>` : `<p class="muted">${a ? "Упражнения не созданы." : "Появятся после анализа."}</p>`;

    // Следующие шаги
    const nextSec = sum ? `<ul class="plain">${sum.recommendations.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="muted">Появится после анализа.</p>`;

    // Методика
    const dropCount = {};
    (a ? a.dropped || [] : []).forEach((d) => { dropCount[d.reason] = (dropCount[d.reason] || 0) + 1; });
    const DROP_RU = { evidence_not_found: "фрагмент не найден в реплике", disfluency: "повтор / запинка, не ошибка", duplicate: "дубликат", unknown_turn: "не реплика ученика" };
    const methodSec = `<ul class="plain">
      <li>Порядок реплик: ${s.parser.applied === "reverse" ? "обратный" : "прямой"}, автоопределение — ${s.parser.detected === "reverse" ? "обратный" : "прямой"}, уверенность ${fmtNum(s.parser.confidence, 2)}. Парсер ${esc(s.parser.version)}.</li>
      ${a ? `<li>Анализ v${a.version}: промпт ${esc(a.promptVersion)}, модель — ${esc(TIERS[a.tier] || a.tier)}, вызовов Claude: ${a.calls}, время ${a.durationSec ? a.durationSec + " с" : "—"}.</li>
      <li>Каждое замечание проверено кодом: фрагмент должен дословно встречаться в реплике. Отклонено: ${Object.entries(dropCount).map(([k, v]) => `${DROP_RU[k] || k} — ${v}`).join(", ") || "ничего"}.</li>
      ${a.missing.length ? `<li>Не проанализированы реплики: ${[...new Set(a.missing)].map((i) => "#" + (i + 1)).join(", ")}.</li>` : ""}
      ${a.errors.length ? `<li>Ошибки: ${a.errors.map(esc).join("; ")}</li>` : ""}` : ""}
      <li>Повторы слов, паузы и перезапуски фраз не считаются ошибками и не снижают оценки: правило в промпте и отдельный фильтр в коде.</li>
      <li>Все числа считает код по тексту и проверенным замечаниям; модель даёт только разметку и объяснения.</li>
      <li>CEFR — предварительный диапазон по одному разговору, уверенность не выше 60%. Это не сертификация. Беглость, произношение и аудирование по тексту не оцениваются.</li>
      <li>Причины ошибок — гипотезы модели с указанной уверенностью, не факты.</li>
      <li>Текст расшифровки передаётся модели как данные; инструкции внутри него игнорируются.</li>
    </ul>
    ${sum && sum.limitations.length ? `<h3>Ограничения этого анализа</h3><ul class="plain">${sum.limitations.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    <details><summary>Источники методики</summary><div class="tablewrap"><table><thead><tr><th>Источник</th><th>Что обосновывает</th></tr></thead><tbody>
      <tr><td><a href="https://rm.coe.int/common-european-framework-of-reference-for-languages-learning-teaching/16809ea0d4">Council of Europe. CEFR Companion Volume, 2020</a></td><td>Шкалы и названия навыков в профиле CEFR</td></tr>
      <tr><td><a href="https://doi.org/10.1111/j.1467-9280.2006.01693.x">Roediger, Karpicke. Test-enhanced learning. Psychological Science, 2006</a></td><td>Практика через самостоятельное воспроизведение, а не перечитывание правила</td></tr>
      <tr><td><a href="https://doi.org/10.1037/0033-2909.132.3.354">Cepeda et al. Distributed practice. Psychological Bulletin, 2006</a></td><td>Интервальное повторение 1–3–7–14–30 дней</td></tr>
      <tr><td><a href="https://doi.org/10.3102/003465430298487">Hattie, Timperley. The power of feedback. Review of Educational Research, 2007</a></td><td>Конкретная обратная связь по задаче с возможностью самоисправления</td></tr>
    </tbody></table></div></details>`;

    const srcSec = `<details id="src-details"><summary>Показать оригинал без изменений (${s.raw.length.toLocaleString("ru-RU")} символов)</summary><pre class="src">${esc(s.raw)}</pre></details>
      <div class="row">${state.ui.confirmDelete === id
        ? `<span>Удалить занятие, его анализы и упражнения без возможности восстановления?</span><button class="danger" data-action="delete-session" data-id="${esc(id)}">Да, удалить</button><button data-action="cancel-delete">Отмена</button>`
        : `<button class="danger" data-action="ask-delete" data-id="${esc(id)}">Удалить занятие</button>`}</div>`;

    const sec = (sid, title, html) => `<section class="sec" id="${sid}"><h2>${title}</h2>${html}</section>`;
    return head + summaryBlock + `<div class="report">
      <nav class="toc" aria-label="Оглавление">${toc.map(([t, l]) => `<button data-action="goto" data-target="${t}">${l}</button>`).join("")}</nav>
      <div class="grid">
        ${sec("sec-overview", "Обзор", tiles + (s.parser.warnings.length ? `<div class="banner warn"><strong>Ограничения данных</strong><ul class="plain">${s.parser.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : "") + (sum && sum.cefr.dimensions.length ? `<h3>Предварительный CEFR</h3>${cefrTable(sum.cefr)}` : ""))}
        ${sec("sec-conversation", "Диалог", `<p class="small muted">Подчёркивания: сплошное — ошибка, пунктир — совет по естественности, точки — возможная ошибка распознавания. Нажмите, чтобы открыть карточку.</p>${conv}`)}
        ${sec("sec-errors", "Ошибки", errorsSec)}
        ${sec("sec-corrections", "Исправления по репликам", corrections)}
        ${sec("sec-vocab", "Лексика", vocabSec)}
        ${sec("sec-grammar", "Грамматика и другие типы ошибок", grammarSec)}
        ${sec("sec-interview", "Интервью", interviewSec)}
        ${sec("sec-speech", "Беглость и произношение", `<p class="muted">Не оцениваются: в текстовой расшифровке нет пауз, темпа и звучания. Раздел появится, когда будет загрузка аудио.</p>`)}
        ${sec("sec-stats", "Статистика", statsSec)}
        ${sec("sec-exercises", "Упражнения", exSec)}
        ${sec("sec-next", "Следующие шаги", nextSec)}
        ${sec("sec-method", "Методика и уверенность", methodSec)}
        ${sec("sec-source", "Исходный текст", srcSec)}
      </div></div>`;
  }

  function issueCard(i, s, bankEntry, isDisputed) {
    const fb = (s.feedback || {})[i.id];
    return `<details class="issue" id="issue-${esc(i.id)}">
      <summary><span class="row"><span class="prio ${i.priority}">${i.priority}</span>${statusPill(i.status)}</span>
        <span><span class="ev">${i.n}. «${esc(i.evidence)}»</span>${i.minimalCorrection ? ` → <span class="fix">${esc(i.minimalCorrection)}</span>` : ""}</span>
        <span class="small muted">${esc(A.CATEGORY_RU[i.category] || i.category)}</span></summary>
      <div class="body">
        <dl class="kv">
          <dt>Объяснение</dt><dd>${esc(i.explanation)}</dd>
          ${i.rule ? `<dt>Правило</dt><dd>${esc(i.rule)}</dd>` : ""}
          ${i.alternatives.length ? `<dt>Альтернативы</dt><dd>${i.alternatives.map(esc).join("<br>")}</dd>` : ""}
          ${i.cause && i.cause.hypothesis ? `<dt>Вероятная причина</dt><dd>${esc(i.cause.hypothesis)} <span class="muted">(гипотеза, уверенность ${fmtNum(i.cause.confidence * 100, 0)}%)</span></dd>` : ""}
          <dt>Ключ ошибки</dt><dd><code>${esc(i.errorKey)}</code>${i.subcategory ? ` · ${esc(i.subcategory)}` : ""}</dd>
          <dt>Уверенность</dt><dd>${fmtNum(i.confidence * 100, 0)}%</dd>
          ${bankEntry ? `<dt>История</dt><dd>${bankEntry.count} раз в ${bankEntry.sessions} занятиях · <span class="pill ${MASTERY_PILL[bankEntry.status]}">${A.MASTERY_RU[bankEntry.status]}</span></dd>` : ""}
        </dl>
        <div class="row">
          <button class="ghost" data-action="goto" data-target="turn-${i.turn}">К реплике #${i.turn + 1}</button>
          <button data-action="feedback" data-id="${esc(s.id)}" data-issue="${esc(i.id)}" data-val="agree" ${fb === "agree" ? 'aria-pressed="true"' : ""}>${fb === "agree" ? "✓ Согласен" : "Согласен"}</button>
          <button data-action="feedback" data-id="${esc(s.id)}" data-issue="${esc(i.id)}" data-val="dispute" ${isDisputed ? 'aria-pressed="true"' : ""}>${isDisputed ? "✓ Не ошибка (исключено)" : "Не ошибка"}</button>
          ${A.ERROR_STATUSES.has(i.status) ? `<a href="#practice" data-action="train" data-key="${esc(i.errorKey)}">Тренировать</a>` : ""}
        </div>
      </div></details>`;
  }

  // ---------------------------------------------------------------- Банк ошибок
  function viewBank() {
    const all = bank();
    const f = state.ui.bank;
    const list = all.filter((e) => (!f.status || e.status === f.status) && (!f.prio || e.priority === f.prio) &&
      (!f.q || (e.errorKey + " " + e.rule + " " + e.explanation).toLowerCase().includes(f.q.toLowerCase())));
    return `<section class="grid">
      <div class="row between"><h1>Банк ошибок</h1>${state.downloads && all.length ? `<button data-action="export-bank">Скачать CSV</button>` : ""}</div>
      <p class="muted">Ошибки всех занятий, сгруппированные по ключу. Учитываются только подтверждённые и вероятные ошибки текущих версий анализа, кроме отмеченных «не ошибка».</p>
      <div class="tiles">${tile(all.length, "Типов ошибок")}${tile(all.filter((e) => e.sessions > 1).length, "Повторяются")}${tile(all.filter((e) => e.status === "practicing" || e.status === "improving").length, "В работе")}${tile(all.filter((e) => e.status === "mastered").length, "Усвоено")}</div>
      <div class="filters">
        <label class="field" for="b-st">Статус<select id="b-st" data-bank="status"><option value="">Все</option>${opts(A.MASTERY_RU, f.status)}</select></label>
        <label class="field" for="b-pr">Приоритет<select id="b-pr" data-bank="prio"><option value="">Все</option>${opts({ P0: "P0", P1: "P1", P2: "P2", P3: "P3" }, f.prio)}</select></label>
        <label class="field" for="b-q">Поиск<input id="b-q" data-bank="q" value="${esc(f.q)}"></label>
      </div>
      ${list.map((e) => `<details class="issue"><summary><span class="row"><span class="prio ${e.priority}">${e.priority}</span><span class="pill ${MASTERY_PILL[e.status]}">${A.MASTERY_RU[e.status]}</span></span>
          <span><code>${esc(e.errorKey)}</code><div class="small muted">${esc(e.rule || e.explanation)}</div></span>
          <span class="small muted num">${e.count} раз · ${e.sessions} зан.</span></summary>
        <div class="body">
          <dl class="kv"><dt>Тип</dt><dd>${esc(A.CATEGORY_RU[e.category] || e.category)}</dd><dt>Впервые / последний раз</dt><dd>${fmtDate(e.firstSeen)} / ${fmtDate(e.lastSeen)}</dd>
          <dt>Тренировка</dt><dd>${e.attempts} попыток, верно без подсказки: ${e.correctAttempts} (дней: ${e.correctDays})</dd><dt>Объяснение</dt><dd>${esc(e.explanation)}</dd></dl>
          <table><thead><tr><th>Занятие</th><th>Как было</th><th>Как правильно</th></tr></thead><tbody>
            ${e.occurrences.map((o) => `<tr><td><a href="#s-${esc(o.sessionId)}">${fmtDate(o.date)}</a> #${o.turn + 1}</td><td class="mono">${esc(o.evidence)}</td><td class="mono" style="color:var(--ok)">${esc(o.correction)}</td></tr>`).join("")}
          </tbody></table>
          <div class="row"><a href="#practice" data-action="train" data-key="${esc(e.errorKey)}">Тренировать</a></div>
        </div></details>`).join("") || `<div class="card"><p class="muted">${all.length ? "Ничего не найдено." : "Банк пуст — запустите анализ занятия."}</p></div>`}
      <details class="card"><summary>Как считается статус</summary><ul class="plain small">
        <li>Новая — встретилась в одном занятии. Повторяется — в двух и более.</li>
        <li>В тренировке — есть хотя бы одна попытка упражнения.</li>
        <li>Улучшается — верные ответы без подсказки в 2+ разных дня, хотя бы один в новом контексте.</li>
        <li>Усвоена — то же, и после последнего верного ответа ошибка не появлялась, в том числе в последнем занятии. Прочтение правила не считается.</li>
      </ul></details>
    </section>`;
  }

  // ---------------------------------------------------------------- Практика
  function viewPractice() {
    const key = state.ui.practiceKey;
    const all = Object.values(state.exercises);
    const due = dueExercises();
    // Карточки, на которые уже ответили в этом визите, остаются видны с результатом.
    const answered = all.filter((x) => state.ui.practice[x.id] && state.ui.practice[x.id].result);
    const base = key ? all.filter((x) => x.errorKey === key) : [...due, ...answered.filter((x) => !due.includes(x))];
    const list = base.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)));
    const attemptsToday = all.flatMap((x) => x.attempts || []).filter((t) => String(t.at).slice(0, 10) === today());
    const week = all.flatMap((x) => x.attempts || []).filter((t) => Date.now() - Date.parse(t.at) < 7 * 86400000);
    const acc = week.length ? week.filter((t) => t.verdict === "correct").length / week.length : null;
    const genBusy = state.ui.generating;
    const exam = state.settings.mode === "exam";
    return `<section class="grid">
      <h1>Практика</h1>
      <div class="tiles">${tile(due.length, "К повторению сегодня")}${tile(all.length, "Всего упражнений")}${tile(attemptsToday.length, "Попыток сегодня")}${tile(acc === null ? "—" : fmtNum(acc * 100, 0) + "%", "Верно за 7 дней", `${week.length} попыток`)}</div>
      <div class="row">
        <button class="primary" data-action="gen-ex" ${!state.sample || genBusy ? "disabled" : ""}>${genBusy ? "Создаю…" : "Новые упражнения по банку ошибок"}</button>
        ${key ? `<span class="chip">ошибка: ${esc(key)}</span><button class="ghost" data-action="train" data-key="">Показать все к повторению</button>` : ""}
        ${exam ? `<span class="pill warn">режим экзамена: подсказки скрыты</span>` : ""}
      </div>
      <p class="small muted">Интервалы повторения: 1, 3, 7, 14, 30 дней. Верно без подсказки — следующий интервал; с подсказкой или частично — завтра; неверно — сначала. Ответ сверяется с эталоном кодом, а если не совпал — проверяется Claude.</p>
      ${list.map((x) => exerciseCard(x, exam)).join("") || `<div class="card"><p class="muted">${all.length ? "На сегодня всё. Возвращайтесь завтра или создайте новые упражнения." : "Упражнений пока нет — они появятся после анализа занятия."}</p></div>`}
    </section>`;
  }

  function exerciseCard(x, exam) {
    const p = state.ui.practice[x.id] || {};
    const last = (x.attempts || [])[x.attempts.length - 1];
    return `<article class="card ex" id="ex-${esc(x.id)}">
      <div class="row between"><span class="row"><span class="pill accent">${esc(EX_TYPES[x.type] || x.type)}</span><code class="small">${esc(x.errorKey)}</code>${x.transfer ? `<span class="chip">новый контекст</span>` : ""}</span>
        <span class="small muted">${x.srs ? `повтор: ${fmtDate(x.srs.due)}` : ""}${last ? ` · прошлый раз: ${{ correct: "верно", partial: "частично", incorrect: "неверно" }[last.verdict]}` : ""}</span></div>
      <div class="prompt">${esc(x.prompt)}</div>
      ${!exam && x.hint ? (p.hint ? `<p class="small"><strong>Подсказка:</strong> ${esc(x.hint)}</p>` : `<div><button class="ghost" data-action="hint" data-id="${esc(x.id)}">Показать подсказку</button></div>`) : ""}
      <label class="hidden" for="ans-${esc(x.id)}">Ваш ответ</label>
      <textarea id="ans-${esc(x.id)}" data-answer="${esc(x.id)}" rows="2" placeholder="Ваш ответ">${esc(p.answer || "")}</textarea>
      <div class="row"><button class="primary" data-action="check" data-id="${esc(x.id)}" ${p.busy ? "disabled" : ""}>${p.busy ? "Проверяю…" : "Проверить"}</button></div>
      ${p.result ? `<div class="grid" role="status"><p><span class="verdict ${p.result.verdict}">${{ correct: "Верно", partial: "Частично", incorrect: "Неверно" }[p.result.verdict]}</span> ${esc(p.result.feedback)}</p>
        ${p.result.verdict !== "correct" ? `<p>Эталон: <span class="mono">${esc(x.answer)}</span></p>` : ""}${x.explanation ? `<p class="small muted">${esc(x.explanation)}</p>` : ""}<p class="small muted">Следующий повтор: ${fmtDate(p.result.due)}</p></div>` : ""}
    </article>`;
  }

  async function checkExercise(id) {
    const x = state.exercises[id];
    const p = state.ui.practice[id] || (state.ui.practice[id] = {});
    const answer = (p.answer || "").trim();
    if (!answer) { toast("Напишите ответ."); return; }
    p.busy = true;
    render();
    let res;
    try {
      if (A.exactMatch(x, answer)) res = { verdict: "correct", feedback: "Совпадает с эталоном.", method: "exact" };
      else if (state.sample) res = { ...A.validateCheck(await askJson(A.checkPrompt(x, answer, state.settings.feedbackLanguage), "quick")), method: "ai" };
      else res = { verdict: "incorrect", feedback: "Не совпадает с эталоном (AI-проверка недоступна).", method: "exact" };
    } catch (e) {
      p.busy = false;
      toast(e && e.code === "rate_limited" ? "Лимит запросов к Claude, попробуйте позже." : "Не удалось проверить ответ.");
      render();
      return;
    }
    const srs = A.schedule(x.srs, res.verdict, !!p.hint);
    const attempt = { at: nowIso(), answer, verdict: res.verdict, feedback: res.feedback, hinted: !!p.hint, method: res.method };
    p.result = { ...res, due: srs.due };
    p.busy = false;
    try {
      await patch("exercises", id, { srs, attempts: [...(x.attempts || []), attempt].slice(-20) });
    } catch { /* toast уже показан */ }
    render();
  }

  async function generateExercises() {
    const items = bank().filter((e) => e.status !== "mastered").slice(0, 5)
      .map((e) => ({ error_key: e.errorKey, category: e.category, examples: e.occurrences.slice(-2).map((o) => ({ evidence: o.evidence, correction: o.correction })) }));
    if (!items.length) { toast("Банк ошибок пуст — сначала проанализируйте занятие."); return; }
    state.ui.generating = true;
    render();
    try {
      const raw = await askJson(A.exercisesPrompt(items, state.settings.feedbackLanguage, Math.min(10, items.length * 2)), "default");
      const exs = A.validateExercises(raw);
      for (const ex of exs) {
        const xid = rid("x");
        await put("exercises", xid, { id: xid, ...ex, sourceSessionId: null, createdAt: nowIso(), srs: { box: 0, due: today() }, attempts: [] });
      }
      state.ui.practiceKey = "";
      toast(`Добавлено упражнений: ${exs.length}.`);
    } catch (e) {
      toast(e && e.code === "rate_limited" ? "Лимит запросов к Claude, попробуйте позже." : "Не удалось создать упражнения.");
    } finally {
      state.ui.generating = false;
      render();
    }
  }

  // ---------------------------------------------------------------- Настройки
  function viewSettings() {
    const s = state.settings;
    return `<section class="grid">
      <h1>Настройки</h1>
      <section class="card">
        <h2>Анализ</h2>
        <div class="form">
          <label class="field" for="st-lang">Язык объяснений<select id="st-lang" data-setting="feedbackLanguage">${opts({ ru: "Русский", mixed: "Русский + термины на английском", en: "Английский" }, s.feedbackLanguage)}</select></label>
          <label class="field" for="st-tier">Модель для разбора<select id="st-tier" data-setting="modelTier">${opts(TIERS, s.modelTier)}</select></label>
          <label class="field" for="st-order">Обычный формат расшифровки<select id="st-order" data-setting="preferredOrder"><option value="">Не задан</option>${opts({ reverse: "Обратный — новые сверху", chronological: "Прямой" }, s.preferredOrder || "")}</select></label>
        </div>
        <label class="check"><input type="checkbox" id="st-dis" data-setting="disfluencyAnalysis" ${s.disfluencyAnalysis ? "checked" : ""}> Анализировать паузы, повторы и запинки</label>
        <p class="small muted">По умолчанию выключено. По тексту причину повтора или паузы определить нельзя, поэтому они не считаются ошибками при любом значении. Отдельные показатели появятся только с аудио.</p>
        <p class="small muted">AI-вызовы идут через ваш аккаунт Claude и расходуют лимиты подписки, а не деньги по API. Первый вызов попросит разрешение.</p>
      </section>
      <section class="card">
        <h2>Данные</h2>
        <p>Занятий: ${Object.keys(state.sessions).length}, анализов: ${Object.keys(state.analyses).length}, упражнений: ${Object.keys(state.exercises).length}. ${state.base ? "Хранятся в личном разделе этой страницы — их видите только вы, даже если поделиться ссылкой." : "Хранилище недоступно — данные не сохраняются."}</p>
        <div class="row">${state.downloads ? `<button data-action="export-all">Скачать всё (JSON)</button>` : ""}
          ${state.ui.confirmWipe ? `<span>Удалить все занятия, анализы и упражнения?</span><button class="danger" data-action="wipe">Да, удалить всё</button><button data-action="cancel-wipe">Отмена</button>` : `<button class="danger" data-action="ask-wipe">Удалить все данные</button>`}</div>
      </section>
      <section class="card">
        <h2>О прототипе</h2>
        <p class="small">Это временная версия сервиса из репозитория <a href="https://github.com/projectbyrybakov/english_AI_analysator">english_AI_analysator</a>, работающая внутри Claude. Парсер тот же, что в основном приложении. Нет: еженедельных тестов, Interview Lab с живым интервьюером, графиков словаря по времени, экспорта в PDF (есть HTML-отчёт, его можно распечатать в PDF).</p>
      </section>
    </section>`;
  }

  // ---------------------------------------------------------------- экспорт
  async function save(filename, data) {
    if (!state.downloads) { toast("Скачивание недоступно в этом просмотре."); return; }
    try {
      await state.downloads.save({ filename, data });
    } catch (e) {
      if (e && e.code !== "declined") toast("Не удалось скачать: " + (e.message || e.code));
    }
  }
  const csvCell = (v) => `"${String(v === null || v === undefined ? "" : v).replace(/"/g, '""')}"`;
  function exportBank() {
    const rows = [["error_key", "category", "priority", "status", "count", "sessions", "first_seen", "last_seen", "attempts", "correct_attempts", "rule", "example", "correction"]];
    for (const e of bank()) {
      const o = e.occurrences[e.occurrences.length - 1] || {};
      rows.push([e.errorKey, e.category, e.priority, e.status, e.count, e.sessions, e.firstSeen, e.lastSeen, e.attempts, e.correctAttempts, e.rule, o.evidence, o.correction]);
    }
    save(`error-bank-${today()}.csv`, "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\n"));
  }
  function exportAll() {
    save(`english-analyst-${today()}.json`, JSON.stringify({ exportedAt: nowIso(), settings: state.settings, sessions: state.sessions, analyses: state.analyses, exercises: state.exercises }, null, 2));
  }
  function exportReport(id) {
    const s = state.sessions[id];
    const a = currentAnalysis(s);
    const res = a ? a.turnResults : {};
    const m = metricsOf(s, a);
    const disputed = new Set(s.disputed || []);
    const sum = a && a.summary;
    const turns = s.turns.map((t) => {
      const iss = res[t.index] ? res[t.index].issues.filter((i) => !disputed.has(i.id)) : [];
      return `<div class="t ${t.role}"><b>#${t.index + 1} ${t.role === "learner" ? "Вы" : "AI"}</b><p>${t.text ? esc(t.text) : "<i>текст не попал в копию</i>"}</p>${iss.length ? `<ul>${iss.map((i) => `<li>[${i.priority}] «${esc(i.evidence)}» → ${esc(i.minimalCorrection)} — ${esc(i.explanation)}</li>`).join("")}</ul>` : ""}${res[t.index] && res[t.index].naturalVersion ? `<p class="nat">Естественно: ${esc(res[t.index].naturalVersion)}</p>` : ""}</div>`;
    }).join("");
    const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>${esc(s.title)}</title><style>
      body{font:15px/1.5 -apple-system,Segoe UI,Arial,sans-serif;max-width:820px;margin:24px auto;padding:0 16px;color:#18202b}
      h1{font-size:22px}h2{font-size:17px;margin-top:24px;border-bottom:1px solid #ccc}.t{border-left:3px solid #ccc;padding:4px 10px;margin:8px 0}
      .t.learner{border-color:#1d7a4a}.t.tutor{border-color:#2c55a6}.nat{color:#1d5d8f}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}
      @media print{.t{break-inside:avoid}}</style></head><body>
      <h1>${esc(s.title)}</h1><p>${fmtDate(s.date)} · ${esc(SCENARIOS[s.scenario] || "")} · ${esc(ROLES[s.userRole] || "")}</p>
      ${sum ? `<h2>Сводка</h2><p><b>${esc(sum.headline)}</b></p><p>Сильные стороны:</p><ul>${sum.strengths.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><p>Главные проблемы:</p><ul>${sum.keyProblems.map((k) => `<li>${esc(k.title)} — ${esc(k.why)}</li>`).join("")}</ul><p>Следующий шаг:</p><ul>${sum.recommendations.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      <h2>Показатели</h2><table><tr><th>Слов</th><th>Ошибок</th><th>Вероятных</th><th>На 100 слов</th></tr><tr><td>${m.words}</td><td>${a ? m.confirmed : "—"}</td><td>${a ? m.likely : "—"}</td><td>${a ? fmtNum(m.errorsPer100) : "—"}</td></tr></table>
      ${sum && sum.cefr.dimensions.length ? `<h2>Предварительный CEFR</h2><table>${sum.cefr.dimensions.map((d) => `<tr><td>${esc(CEFR_RU[d.name] || d.name)}</td><td>${esc(d.range)}</td><td>${fmtNum(d.confidence * 100, 0)}%</td></tr>`).join("")}</table><p><small>${esc(sum.cefr.note)}</small></p>` : ""}
      ${sum && sum.interview.shortDraft ? `<h2>Ответ о себе (30–60 с)</h2><p>${esc(sum.interview.shortDraft)}</p>` : ""}
      <h2>Диалог и исправления</h2>${turns}
      <p><small>Анализ ${a ? "v" + a.version + ", " + esc(a.promptVersion) : "не выполнен"}. Повторы и запинки не считаются ошибками. Для PDF: откройте файл в браузере и выберите «Печать → Сохранить как PDF».</small></p>
      </body></html>`;
    save(`${(s.date || today())}-${s.title.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40)}.html`, html);
  }

  // ---------------------------------------------------------------- события
  function toast(msg) {
    state.toast = msg;
    render();
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { state.toast = ""; renderSoon(); }, 4000);
  }
  function currentTheme() {
    const t = document.documentElement.dataset.theme;
    if (t) return t;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function applyTheme() {
    if (state.settings.theme) document.documentElement.dataset.theme = state.settings.theme;
  }
  function scrollToId(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === "DETAILS") el.open = true;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    if (el.classList.contains("turn")) { el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1500); }
  }

  $app.addEventListener("click", async (ev) => {
    const mark = ev.target.closest("mark[data-issue]");
    if (mark) {
      const id = "issue-" + mark.dataset.issue;
      const s = state.ui.filters;
      if (!document.getElementById(id)) { Object.assign(s, { prio: "", cat: "", status: "", q: "", recurring: false }); render(); }
      scrollToId(id);
      return;
    }
    const el = ev.target.closest("[data-action]");
    if (!el) return;
    const act = el.dataset.action;
    const id = el.dataset.id;
    if (act === "goto") { ev.preventDefault(); scrollToId(el.dataset.target); }
    else if (act === "totop") window.scrollTo({ top: 0, behavior: "smooth" });
    else if (act === "role-panel") { state.ui.rolePanel = !state.ui.rolePanel; render(); }
    else if (act === "theme") { await saveSettings({ theme: currentTheme() === "dark" ? "light" : "dark" }); render(); }
    else if (act === "reparse") reparse(el.dataset.order);
    else if (act === "flip") reparse(state.draft.preview.appliedDirection === "reverse" ? "chronological" : "reverse");
    else if (act === "save-session") { el.disabled = true; saveSession(!!el.dataset.analyse); }
    else if (act === "analyse") runAnalysis(id);
    else if (act === "stop") { const r = state.running[id]; if (r) r.ctrl.abort(); }
    else if (act === "ask-delete") { state.ui.confirmDelete = id; render(); }
    else if (act === "cancel-delete") { state.ui.confirmDelete = null; render(); }
    else if (act === "delete-session") {
      state.ui.confirmDelete = null;
      try {
        for (const a of analysesFor(id)) await remove("analyses", a.id);
        for (const x of Object.values(state.exercises).filter((e) => e.sourceSessionId === id)) await remove("exercises", x.id);
        await remove("sessions", id);
        location.hash = "#sessions";
        toast("Занятие удалено.");
      } catch (e) { handleDbError(e); }
    }
    else if (act === "feedback") {
      const s = state.sessions[id];
      const val = el.dataset.val;
      const issue = el.dataset.issue;
      const feedback = { ...(s.feedback || {}) };
      let disputed = [...(s.disputed || [])];
      if (val === "dispute") {
        if (disputed.includes(issue)) { disputed = disputed.filter((x) => x !== issue); delete feedback[issue]; }
        else { disputed.push(issue); feedback[issue] = "dispute"; }
      } else {
        disputed = disputed.filter((x) => x !== issue);
        feedback[issue] = feedback[issue] === "agree" ? undefined : "agree";
        if (!feedback[issue]) delete feedback[issue];
      }
      try { await patch("sessions", id, { disputed, feedback }); } catch { /* показано */ }
      render();
    }
    else if (act === "train") { state.ui.practiceKey = el.dataset.key || ""; if (location.hash === "#practice") render(); }
    else if (act === "practice-session") { state.ui.practiceKey = ""; }
    else if (act === "hint") { (state.ui.practice[id] = state.ui.practice[id] || {}).hint = true; render(); }
    else if (act === "check") checkExercise(id);
    else if (act === "gen-ex") generateExercises();
    else if (act === "copy") {
      try { await navigator.clipboard.writeText(el.dataset.text); toast("Скопировано."); } catch { toast("Не удалось скопировать — выделите текст вручную."); }
    }
    else if (act === "export-bank") exportBank();
    else if (act === "export-all") exportAll();
    else if (act === "export-report") exportReport(id);
    else if (act === "ask-wipe") { state.ui.confirmWipe = true; render(); }
    else if (act === "cancel-wipe") { state.ui.confirmWipe = false; render(); }
    else if (act === "wipe") {
      state.ui.confirmWipe = false;
      try {
        for (const k of ["analyses", "exercises", "sessions"]) for (const did of Object.keys(state[k])) await remove(k, did);
        toast("Все данные удалены.");
      } catch (e) { handleDbError(e); }
      render();
    }
  });

  $app.addEventListener("input", (ev) => {
    const t = ev.target;
    if (t.dataset.draft) {
      state.draft[t.dataset.draft] = t.value;
      if (t.dataset.draft === "raw") state.draft.preview = null;
    } else if (t.dataset.answer) {
      (state.ui.practice[t.dataset.answer] = state.ui.practice[t.dataset.answer] || {}).answer = t.value;
    } else if (t.dataset.filter === "q") {
      state.ui.filters.q = t.value;
      clearTimeout(t._deb);
      t._deb = setTimeout(() => { render(); const el = document.getElementById("f-q"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 350);
    } else if (t.dataset.bank === "q") {
      state.ui.bank.q = t.value;
      clearTimeout(t._deb);
      t._deb = setTimeout(() => { render(); const el = document.getElementById("b-q"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 350);
    }
  });

  $app.addEventListener("change", async (ev) => {
    const t = ev.target;
    if (t.dataset.draft && t.tagName === "SELECT") {
      state.draft[t.dataset.draft] = t.value;
      if (t.dataset.draft !== "order") render();
    } else if (t.dataset.draftCheck) { state.draft[t.dataset.draftCheck] = t.checked; render(); }
    else if (t.dataset.roleIdx !== undefined) { state.draft.roles[Number(t.dataset.roleIdx)] = t.value; state.draft.confirmed = false; render(); }
    else if (t.dataset.setting) {
      const v = t.type === "checkbox" ? t.checked : t.value || (t.dataset.setting === "preferredOrder" || t.dataset.setting === "defaultMarket" ? null : t.value);
      await saveSettings({ [t.dataset.setting]: v === null && t.dataset.setting === "defaultMarket" ? "" : v });
      render();
    } else if (t.dataset.filter && t.dataset.filter !== "q") { state.ui.filters[t.dataset.filter] = t.value; render(); }
    else if (t.dataset.filterCheck) { state.ui.filters[t.dataset.filterCheck] = t.checked; render(); }
    else if (t.dataset.bank && t.dataset.bank !== "q") { state.ui.bank[t.dataset.bank] = t.value; render(); }
    else if (t.dataset.version) { state.ui.version[t.dataset.version] = t.value; render(); }
  });

  // ---------------------------------------------------------------- маршруты
  const NAMES = new Set(["home", "sessions", "new", "errors", "practice", "settings"]);
  function route() {
    const h = location.hash.replace(/^#/, "");
    if (h.startsWith("s-")) state.route = { name: "session", id: h.slice(2) };
    else state.route = { name: NAMES.has(h) ? h : "home", id: null };
    state.ui.rolePanel = false;
    state.ui.confirmDelete = null;
    if (state.route.name === "new" && !state.draft) state.draft = newDraft();
    render();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);
  route();
  connect();
})();
