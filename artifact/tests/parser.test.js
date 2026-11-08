const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../parser.js");
const fs = require("node:fs");
const path = require("node:path");

const RAW = fs.readFileSync(path.join(__dirname, "../../backend/tests/fixtures/app_reverse_synthetic.txt"), "utf8");

test("JS parser restores reverse order like the Python parser", () => {
  const r = P.parseTranscript(RAW);
  assert.equal(r.appliedDirection, "reverse");
  assert.equal(r.confidenceLabel, "high");
  assert.ok(r.turns[0].text.startsWith("Hi, nice to meet you"));
  assert.ok(r.turns[r.turns.length - 1].text.startsWith("Sure. Short summary"));
  assert.equal(r.stats.learnerTurns, 6);
  assert.equal(r.stats.collapsedTutorTurns, 1);
  assert.equal(r.scenarioTitle, "собеседование в международную компанию на аналитика данных");
  assert.ok(r.turns.some((t) => t.flags.includes("question_missing")));
  for (const t of r.turns) assert.ok(!/Скрыть текст|Сменить роль|Показать текст/.test(t.text));
});

const PRIVATE = process.env.PRIVATE_FIXTURES_DIR;
test("private lessons parse without unknown roles", { skip: !PRIVATE }, () => {
  for (const f of fs.readdirSync(PRIVATE).filter((x) => x.endsWith(".txt"))) {
    const r = P.parseTranscript(fs.readFileSync(path.join(PRIVATE, f), "utf8"));
    assert.equal(r.stats.unknownTurns, 0, f);
    assert.equal(r.turns[0].role, "tutor", f);
  }
});
