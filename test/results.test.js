const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  loadResults,
  dnsStatus,
  normalizeLexiconsDir,
  readBlocking,
} = require("../scripts/lib/results.js");

const FIXTURES = path.join(__dirname, "fixtures", "goat", "v0.2.9");
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");

test("dnsStatus: goat success output is ok", () => {
  assert.equal(dnsStatus(fixture("check-dns-ok.txt")), "ok");
});

test("dnsStatus: goat failure output is failed", () => {
  assert.equal(dnsStatus(fixture("check-dns-missing.txt")), "failed");
});

test("dnsStatus: empty or unrecognised text is unknown", () => {
  assert.equal(dnsStatus(""), "unknown");
  assert.equal(dnsStatus("something else"), "unknown");
});

test("dnsStatus: null is missing", () => {
  assert.equal(dnsStatus(null), "missing");
});

test("dnsStatus: failure wins over success", () => {
  const both = `${fixture("check-dns-ok.txt")}${fixture("check-dns-missing.txt")}`;
  assert.equal(dnsStatus(both), "failed");
});

test("normalizeLexiconsDir: accepts and normalizes valid values", () => {
  for (const v of ["lexicons", "lexicons/", "./lexicons/"]) {
    assert.equal(normalizeLexiconsDir(v), "lexicons/", v);
  }
  assert.equal(normalizeLexiconsDir("src/lexicons"), "src/lexicons/");
});

test("normalizeLexiconsDir: invalid values fall back to lexicons/", () => {
  for (const v of ["../x", "/abs", 5, "", "a\nb", "a b", "a/../b", undefined]) {
    assert.equal(normalizeLexiconsDir(v), "lexicons/", JSON.stringify(v));
  }
});

test("readBlocking: only a boolean false disables a gate", () => {
  assert.deepEqual(readBlocking({ blocking: { dns: false } }), {
    breakingWarnings: true,
    dns: false,
  });
  assert.deepEqual(readBlocking({ blocking: { dns: "false" } }), {
    breakingWarnings: true,
    dns: true,
  });
  assert.deepEqual(readBlocking(null), { breakingWarnings: true, dns: true });
});

test("readBlocking: breakingWarnings can be disabled", () => {
  assert.deepEqual(readBlocking({ blocking: { "breaking-warnings": false } }), {
    breakingWarnings: false,
    dns: true,
  });
});

test("readBlocking: camelCase breakingWarnings key in meta is ignored", () => {
  assert.deepEqual(readBlocking({ blocking: { breakingWarnings: false } }), {
    breakingWarnings: true,
    dns: true,
  });
});

test("loadResults: empty dir gives nulls and empty lexiconChanges", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "results-"));
  assert.deepEqual(await loadResults(dir), {
    meta: null,
    lint: null,
    lintExitCode: null,
    breaking: null,
    breakingExitCode: null,
    dnsText: null,
    dnsExitCode: null,
    statusText: null,
    lexiconChanges: { nsids: [], removed: [] },
  });
});

test("loadResults: missing dir behaves like empty", async () => {
  const results = await loadResults(path.join(os.tmpdir(), "no-such-dir-xyz"));
  assert.equal(results.lint, null);
});

test("loadResults: parses fixture files", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "results-"));
  const copy = (from, to) =>
    fs.copyFileSync(path.join(FIXTURES, from), path.join(dir, to));
  copy("lint.json", "lint.json");
  copy("breaking.json", "breaking.json");
  copy("check-dns-missing.txt", "check-dns.txt");
  copy("status.txt", "status.txt");
  fs.writeFileSync(path.join(dir, "lint-exit-code"), "1\n");
  fs.writeFileSync(path.join(dir, "check-dns-exit-code"), "2");
  fs.writeFileSync(path.join(dir, "meta.json"), '{"blocking":{"dns":false}}');
  fs.writeFileSync(
    path.join(dir, "lexicon-changes.json"),
    '{"nsids":["com.example.foo"],"removed":"nope"}',
  );

  const r = await loadResults(dir);
  assert.equal(r.lint.length, 1);
  assert.equal(r.lint[0].nsid, "com.example.bad");
  assert.deepEqual(r.breaking.map((b) => b["lint-level"]), ["error", "warn"]);
  assert.equal(dnsStatus(r.dnsText), "failed");
  assert.equal(r.lintExitCode, "1");
  assert.equal(r.dnsExitCode, "2");
  assert.equal(r.breakingExitCode, null);
  assert.match(r.statusText, /com\.example\.foo/);
  assert.deepEqual(r.meta, { blocking: { dns: false } });
  assert.deepEqual(r.lexiconChanges, {
    nsids: ["com.example.foo"],
    removed: [],
  });
});

test("loadResults: unparseable JSON is null, non-array lint is null", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "results-"));
  fs.writeFileSync(path.join(dir, "lint.json"), "not json");
  fs.writeFileSync(path.join(dir, "breaking.json"), '{"a":1}');
  fs.writeFileSync(path.join(dir, "meta.json"), "[1]");
  const r = await loadResults(dir);
  assert.equal(r.lint, null);
  assert.equal(r.breaking, null);
  assert.equal(r.meta, null);
});
