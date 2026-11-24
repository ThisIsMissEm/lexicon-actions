const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { evaluate, escapeMessage } = require("../scripts/report-failures.js");

const FIXTURES = path.join(__dirname, "fixtures", "goat", "v0.2.9");
const DNS_OK = fs.readFileSync(path.join(FIXTURES, "check-dns-ok.txt"), "utf8");
const DNS_FAILED = fs.readFileSync(path.join(FIXTURES, "check-dns-missing.txt"), "utf8");

const clean = (overrides = {}) => ({
  meta: null,
  lint: [],
  lintExitCode: null,
  breaking: [],
  breakingExitCode: null,
  dnsText: DNS_OK,
  dnsExitCode: null,
  statusText: null,
  lexiconChanges: { nsids: [], removed: [] },
  ...overrides,
});
const ALL = { breakingWarnings: true, dns: true };
const titles = (results, blocking = ALL) =>
  evaluate(results, blocking).map((f) => f.title);

const issue = (level) => ({
  nsid: "com.example.foo",
  "file-path": "lexicons/com/example/foo.json",
  "lint-level": level,
  message: "something",
});

test("clean results produce no failures", () => {
  assert.deepEqual(titles(clean()), []);
});

test("lint error blocks", () => {
  assert.deepEqual(
    titles(clean({ lint: [issue("error")], lintExitCode: "1" })),
    ["Lint errors"],
  );
});

test("lint warnings alone do not block", () => {
  assert.deepEqual(
    titles(clean({ lint: [issue("warn")], lintExitCode: "1" })),
    [],
  );
});

test("lint crash (empty array, exit code present) fails to run", () => {
  assert.deepEqual(titles(clean({ lint: [], lintExitCode: "255" })), [
    "Lint failed to run",
  ]);
});

test("lint output missing entirely fails to run", () => {
  assert.deepEqual(titles(clean({ lint: null, lintExitCode: null })), [
    "Lint failed to run",
  ]);
});

test("breaking error blocks", () => {
  assert.deepEqual(
    titles(clean({ breaking: [issue("error")], breakingExitCode: "1" })),
    ["Breaking changes"],
  );
});

test("breaking warning blocks only when breakingWarnings is true", () => {
  const r = clean({ breaking: [issue("warn")], breakingExitCode: "1" });
  assert.deepEqual(titles(r, ALL), ["Breaking changes"]);
  assert.deepEqual(titles(r, { breakingWarnings: false, dns: true }), []);
});

test("breaking crash fails to run", () => {
  assert.deepEqual(titles(clean({ breaking: [], breakingExitCode: "1" })), [
    "Breaking-change check failed to run",
  ]);
});

test("DNS failed blocks only when dns is true", () => {
  const r = clean({ dnsText: DNS_FAILED });
  assert.deepEqual(titles(r, ALL), ["DNS records missing"]);
  assert.deepEqual(titles(r, { breakingWarnings: true, dns: false }), []);
});

test("DNS unknown output blocks when dns is true", () => {
  assert.deepEqual(titles(clean({ dnsText: "weird output" })), [
    "DNS check result unknown",
  ]);
  assert.deepEqual(
    titles(clean({ dnsText: "weird output" }), {
      breakingWarnings: true,
      dns: false,
    }),
    [],
  );
});

test("DNS crash fails to run regardless of dns setting", () => {
  const off = { breakingWarnings: true, dns: false };
  for (const blocking of [ALL, off]) {
    assert.deepEqual(
      titles(clean({ dnsText: "", dnsExitCode: "1" }), blocking),
      ["DNS check failed to run"],
    );
  }
});

test("DNS exit code present is a single crash failure whatever the text", () => {
  const off = { breakingWarnings: true, dns: false };
  for (const dnsText of [DNS_FAILED, DNS_OK]) {
    for (const blocking of [ALL, off]) {
      assert.deepEqual(
        titles(clean({ dnsText, dnsExitCode: "1" }), blocking),
        ["DNS check failed to run"],
      );
    }
  }
});

test("DNS output missing with no exit code fails to run regardless of setting", () => {
  const off = { breakingWarnings: true, dns: false };
  for (const blocking of [ALL, off]) {
    assert.deepEqual(
      titles(clean({ dnsText: null, dnsExitCode: null }), blocking),
      ["DNS check failed to run"],
    );
  }
});

test("failure messages name the offending NSIDs", () => {
  const [failure] = evaluate(
    clean({ lint: [issue("error")], lintExitCode: "1" }),
    ALL,
  );
  assert.match(failure.message, /com\.example\.foo/);
});

test("escapeMessage escapes %, CR and LF", () => {
  assert.equal(escapeMessage("a%b\r\nc"), "a%25b%0D%0Ac");
});

test("CLI exits 1 and prints annotations", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "report-failures-"));
  try {
    fs.writeFileSync(path.join(dir, "lint.json"), "[]");
    fs.writeFileSync(path.join(dir, "breaking.json"), "[]");
    fs.writeFileSync(path.join(dir, "check-dns.txt"), DNS_FAILED);

    const run = spawnSync(
      process.execPath,
      [path.join(__dirname, "..", "scripts", "report-failures.js"), dir],
      { encoding: "utf8", env: { ...process.env, BLOCK_DNS: "true" } },
    );
    assert.equal(run.status, 1);
    assert.match(run.stdout, /^::error title=DNS records missing::/m);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI exits 0 when the only failure is a non-blocking DNS finding", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "report-failures-"));
  try {
    fs.writeFileSync(path.join(dir, "lint.json"), "[]");
    fs.writeFileSync(path.join(dir, "breaking.json"), "[]");
    fs.writeFileSync(path.join(dir, "check-dns.txt"), DNS_FAILED);

    const run = spawnSync(
      process.execPath,
      [path.join(__dirname, "..", "scripts", "report-failures.js"), dir],
      { encoding: "utf8", env: { ...process.env, BLOCK_DNS: "false" } },
    );
    assert.equal(run.status, 0);
    assert.equal(run.stdout, "");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
