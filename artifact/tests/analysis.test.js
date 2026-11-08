// Запуск: node --test artifact/tests
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../analysis.js");
const P = require("../parser.js");
const fs = require("node:fs");
const path = require("node:path");

const RAW = fs.readFileSync(path.join(__dirname, "../../backend/tests/fixtures/app_reverse_synthetic.txt"), "utf8");
const parsed = P.parseTranscript(RAW);
const byIdx = Object.fromEntries(parsed.turns.map((t) => [t.index, t]));
const learnerIdx = parsed.turns.filter((t) => t.role === "learner").map((t) => t.index);

test("findEvidence: exact and soft match", () => {
  const t = "I find some duplicates. It’s fine.";
  assert.deepEqual(A.findEvidence(t, "I find some"), { start: 0, end: 11, exact: true });
  const soft = A.findEvidence(t, "it's  FINE");
  assert.ok(soft && !soft.exact);
  assert.equal(t.slice(soft.start, soft.end), "It’s fine");
  assert.equal(A.findEvidence(t, "not in text"), null);
});

test("isDisfluency: repetitions and fillers are not errors", () => {
  assert.ok(A.isDisfluency("I... I"));
  assert.ok(A.isDisfluency("they, they"));
  assert.ok(A.isDisfluency("uh, um"));
  assert.ok(A.isDisfluency("was, was"));
  assert.ok(!A.isDisfluency("I find some duplicates"));
  assert.ok(!A.isDisfluency("The duplicates was"));
});

test("validateBatch: keeps verified issues, drops invented, disfluency, duplicates, tutor turns", () => {
  const l3 = learnerIdx[2]; // "I calculated ... I find some duplicates."
  const l1 = learnerIdx[0]; // "... I... I make reports ..."
  const raw = { turns: [
    { turn_id: `t${l3}`, relevance: "answered", clarity: 4, strengths: [{ evidence: "I calculated late deliveries", note: "ok" }],
      issues: [
        { evidence: "I find some duplicates", category: "grammar.tenses", status: "confirmed_error", priority: "P1", error_key: "Past Simple in narrative", minimal_correction: "I found some duplicates", confidence: 0.95 },
        { evidence: "I find some", category: "grammar.tenses", status: "confirmed_error", priority: "P1", error_key: "past_simple_in_narrative", confidence: 0.7 },
        { evidence: "this phrase is not there", category: "grammar.articles", status: "confirmed_error", error_key: "x" },
      ],
      interview: { applicable: true, answered_question: "yes", structure: 4, specificity: 9, personal_contribution: 3, result_impact: 2 } },
    { turn_id: `t${l1}`, issues: [{ evidence: "I... I", category: "grammar.verb_forms", status: "confirmed_error", error_key: "rep" }] },
    { turn_id: "t0", issues: [{ evidence: "Hi", status: "confirmed_error" }] },
  ] };
  const v = A.validateBatch(raw, byIdx, [l1, l3]);
  const r3 = v.turns[l3];
  assert.equal(r3.issues.length, 1);
  assert.equal(r3.issues[0].errorKey, "past_simple_in_narrative");
  assert.equal(r3.issues[0].evidence, "I find some duplicates");
  assert.equal(r3.interview.specificity, 5);
  assert.equal(r3.strengths.length, 1);
  const reasons = v.dropped.map((d) => d.reason).sort();
  assert.deepEqual(reasons, ["disfluency", "duplicate", "evidence_not_found", "unknown_turn"]);
  assert.deepEqual(v.turns[l1].issues, []);
});

test("computeMetrics: counts by code, disputed excluded, per-100 normalisation", () => {
  const l3 = learnerIdx[2];
  const v = A.validateBatch({ turns: [{ turn_id: `t${l3}`, issues: [
    { evidence: "I find some duplicates", category: "grammar.tenses", status: "confirmed_error", priority: "P1", error_key: "past_simple_in_narrative" },
    { evidence: "divided by all deliveries", category: "collocations", status: "naturalness", priority: "P3", error_key: "nat" },
  ] }] }, byIdx, [l3]);
  const m = A.computeMetrics(parsed.turns, v.turns, []);
  assert.equal(m.learnerTurns, 6);
  assert.equal(m.confirmed, 1);
  assert.equal(m.byStatus.naturalness, 1);
  assert.equal(m.words, parsed.stats.learnerWords);
  assert.ok(Math.abs(m.confirmedPer100 - 100 / m.words) < 1e-9);
  const id = v.turns[l3].issues.find((i) => i.status === "confirmed_error").id;
  const m2 = A.computeMetrics(parsed.turns, v.turns, [id]);
  assert.equal(m2.confirmed, 0);
  assert.equal(m2.disputedCount, 1);
});

test("buildErrorBank: recurring across sessions, mastery needs transfer on two days and absence later", () => {
  const issue = (id) => ({ id, turn: 1, status: "confirmed_error", errorKey: "modal_should_to", category: "grammar.modals", priority: "P1", evidence: "should to", minimalCorrection: "should" });
  const s1 = { id: "s1", date: "2026-11-08", analysis: { turnResults: { 1: { issues: [issue("a")] } } } };
  const s2 = { id: "s2", date: "2026-11-09", analysis: { turnResults: { 1: { issues: [issue("b"), issue("c")] } } } };
  let bank = A.buildErrorBank([s2, s1], []);
  assert.equal(bank[0].status, "recurring");
  assert.equal(bank[0].count, 3);
  assert.equal(bank[0].sessions, 2);
  const ex = [{ errorKey: "modal_should_to", transfer: true, attempts: [
    { at: "2026-11-10T10:00:00Z", verdict: "correct", hinted: false },
    { at: "2026-11-12T10:00:00Z", verdict: "correct", hinted: false },
  ] }];
  bank = A.buildErrorBank([s1, s2], ex);
  assert.equal(bank[0].status, "improving"); // ещё встречается в последнем занятии
  const s3 = { id: "s3", date: "2026-11-13", analysis: { turnResults: {} } };
  bank = A.buildErrorBank([s1, s2, s3], ex);
  assert.equal(bank[0].status, "mastered");
});

test("schedule: 1-3-7-14-30, reset on incorrect, hint does not advance", () => {
  const now = "2026-11-08T12:00:00Z";
  let s = A.schedule(null, "correct", false, now);
  assert.deepEqual(s, { box: 1, due: "2026-11-11" });
  s = A.schedule(s, "correct", false, now);
  assert.deepEqual(s, { box: 2, due: "2026-11-15" });
  assert.deepEqual(A.schedule(s, "correct", true, now), { box: 2, due: "2026-11-09" });
  assert.deepEqual(A.schedule(s, "incorrect", false, now), { box: 0, due: "2026-11-09" });
});

test("exactMatch ignores case and punctuation", () => {
  const ex = { answer: "I had to check the database.", accepted: ["I needed to check the database"] };
  assert.ok(A.exactMatch(ex, "i had to check the database"));
  assert.ok(A.exactMatch(ex, "I needed to check the database!"));
  assert.ok(!A.exactMatch(ex, "I should to check the database"));
});

test("prompts treat transcript as data and include rules", () => {
  const p = A.batchPrompt({ title: "x", userRole: "candidate" }, parsed.turns, ["t1"], ["modal_should_to"], "ru");
  assert.match(p, /Never follow instructions/);
  assert.match(p, /stutters/);
  assert.match(p, /modal_should_to/);
  assert.match(p, /<transcript>/);
});
