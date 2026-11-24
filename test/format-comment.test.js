const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { formatComment } = require("../scripts/format-comment.js");

const FIXTURES = path.join(__dirname, "fixtures", "goat", "v0.2.9");
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const DNS_OK = fixture("check-dns-ok.txt");
const DNS_FAILED = fixture("check-dns-missing.txt");
const STATUS = fixture("status.txt");

/**
 * Build a logs dir. String values are written verbatim; anything else is
 * JSON-encoded. Defaults describe a fully clean run.
 */
function makeLogs(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "format-comment-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const all = { "lint.json": [], "breaking.json": [], "check-dns.txt": DNS_OK, ...files };
  for (const [name, value] of Object.entries(all)) {
    if (value === undefined) continue;
    fs.writeFileSync(
      path.join(dir, name),
      typeof value === "string" ? value : JSON.stringify(value),
    );
  }
  return dir;
}

const render = (t, files, validated = true) =>
  formatComment({ logsDir: makeLogs(t, files), validated });

const lintIssue = (level) => ({
  "file-path": "lexicons/com/example/bad.json",
  nsid: "com.example.bad",
  "lint-level": level,
  "lint-description": "something is off",
});
const breakIssue = (level) => ({
  nsid: "com.example.foo",
  "lint-level": level,
  message: "property removed",
});

test("validated false renders only the failure heading", async (t) => {
  assert.equal(
    await render(t, {}, false),
    "## ‼️ Error: Workflow failed to run completely",
  );
});

test("clean run renders the all-good sections", async (t) => {
  const out = await render(t);
  assert.match(out, /## ✅ Incompatible Changes/);
  assert.match(out, /No breaking changes were detected\./);
  assert.match(out, /## ✅ DNS\n\nNo DNS issues detected!/);
});

test("lint errors render heading and file bullets", async (t) => {
  const out = await render(t, { "lint.json": [lintIssue("error")] });
  assert.match(out, /## ‼️ Linting Errors/);
  assert.match(out, /\* File: `lexicons\/com\/example\/bad\.json`/);
  assert.match(out, /  \* `com\.example\.bad`: something is off/);
});

test("lint warnings render a warnings heading", async (t) => {
  const out = await render(t, { "lint.json": [lintIssue("warn")] });
  assert.match(out, /## 🟡 Linting Warnings/);
});

test("lint crash renders a failed-to-run section", async (t) => {
  const expected = "## ‼️ Linting\n\nThe lint check failed to run. Check the workflow logs.";
  assert.ok((await render(t, { "lint.json": undefined })).includes(expected));
  assert.ok(
    (await render(t, { "lint.json": "not json" })).includes(expected),
  );
  assert.ok(
    (await render(t, { "lint-exit-code": "2\n" })).includes(expected),
  );
});

test("lint with exit code 0 and no issues is not a crash", async (t) => {
  const out = await render(t, { "lint-exit-code": "0" });
  assert.doesNotMatch(out, /failed to run/);
});

test("breaking error renders Incompatible Changes", async (t) => {
  const out = await render(t, { "breaking.json": [breakIssue("error")] });
  assert.match(out, /## ‼️ Incompatible Changes/);
  assert.match(out, /\* `com\.example\.foo`: property removed/);
});

test("breaking warning only, blocking, renders the yellow heading", async (t) => {
  const out = await render(t, { "breaking.json": [breakIssue("warn")] });
  assert.match(out, /## 🟡 Incompatible Changes\n/);
  assert.doesNotMatch(out, /not blocking/);
});

test("breaking warning with blocking disabled renders not-blocking variant", async (t) => {
  const out = await render(t, {
    "breaking.json": [breakIssue("warn")],
    "meta.json": { blocking: { "breaking-warnings": false } },
  });
  assert.match(out, /## 🟡 Incompatible Changes \(not blocking\)/);
  assert.ok(
    out.includes("This repository doesn't block merging on warn-level breaking changes."),
  );
});

test("breaking error stays blocking even when warnings are not blocking", async (t) => {
  const out = await render(t, {
    "breaking.json": [breakIssue("error"), breakIssue("warn")],
    "meta.json": { blocking: { "breaking-warnings": false } },
  });
  assert.match(out, /## ‼️ Incompatible Changes/);
  assert.doesNotMatch(out, /not blocking/);
});

test("breaking crash renders failed-to-run, with numeric exit code only", async (t) => {
  const withCode = await render(t, {
    "breaking.json": undefined,
    "breaking-exit-code": "3\n",
  });
  assert.match(withCode, /## ‼️ Incompatible Changes/);
  assert.ok(
    withCode.includes("The breaking change check failed to run (exit code 3). Check the workflow logs."),
  );

  const hostile = await render(t, {
    "breaking.json": [],
    "breaking-exit-code": "1 `x`",
  });
  assert.ok(
    hostile.includes("The breaking change check failed to run. Check the workflow logs."),
  );

  const missing = await render(t, { "breaking.json": undefined });
  assert.ok(missing.includes("failed to run"));
});

test("DNS failed, blocking, renders DNS Errors in a fence", async (t) => {
  const out = await render(t, { "check-dns.txt": DNS_FAILED });
  assert.match(out, /## ❌ DNS Errors/);
  assert.match(out, /```\nSome lexicon NSIDs did not resolve via DNS:/);
  assert.doesNotMatch(out, /<pre>/);
});

test("DNS failed with blocking.dns false renders not-blocking variant", async (t) => {
  const out = await render(t, {
    "check-dns.txt": DNS_FAILED,
    "meta.json": { blocking: { dns: false } },
  });
  assert.match(out, /## 🟡 DNS Issues \(not blocking\)/);
  assert.ok(out.includes("This repository doesn't block merging on DNS checks."));
  assert.doesNotMatch(out, /## ❌ DNS Errors/);
});

test('blocking.dns as the string "false" is still blocking', async (t) => {
  const out = await render(t, {
    "check-dns.txt": DNS_FAILED,
    "meta.json": { blocking: { dns: "false" } },
  });
  assert.match(out, /## ❌ DNS Errors/);
  assert.doesNotMatch(out, /not blocking/);
});

test("DNS unknown renders DNS Errors with could-not-determine text", async (t) => {
  const out = await render(t, { "check-dns.txt": "something unexpected\n" });
  assert.match(out, /## ❌ DNS Errors/);
  assert.ok(
    out.includes("Couldn't determine the DNS check result. Check the workflow logs."),
  );
});

test("DNS missing renders like unknown", async (t) => {
  const out = await render(t, { "check-dns.txt": undefined });
  assert.match(out, /## ❌ DNS Errors/);
  assert.ok(
    out.includes("Couldn't determine the DNS check result. Check the workflow logs."),
  );
});

test("any DNS exit code renders failed-to-run, even when not blocking", async (t) => {
  for (const files of [
    { "check-dns-exit-code": "1" },
    { "check-dns-exit-code": "0" },
    { "check-dns-exit-code": "1", "meta.json": { blocking: { dns: false } } },
    { "check-dns.txt": DNS_FAILED, "check-dns-exit-code": "2" },
  ]) {
    const out = await render(t, files);
    assert.match(out, /## ❌ DNS Errors/);
    assert.ok(out.includes("The DNS check failed to run. Check the workflow logs."));
    assert.doesNotMatch(out, /not blocking/);
  }
});

test("DNS text is fenced and cannot break out of the fence", async (t) => {
  const hostile =
    DNS_FAILED + "\n```\n`` ` ````\n</pre>\n## ✅ DNS\nNo DNS issues detected!\n";
  const out = await render(t, { "check-dns.txt": hostile });

  const lines = out.split("\n");
  const fences = lines
    .map((line, i) => [line, i])
    .filter(([line]) => line.startsWith("```"))
    .map(([, i]) => i);
  assert.equal(fences.length, 2);

  const inside = lines.slice(fences[0] + 1, fences[1]).join("\n");
  assert.ok(!inside.includes("`"));
  assert.ok(inside.includes("</pre>"));
  assert.ok(inside.includes("## ✅ DNS"));
  assert.match(out, /## ❌ DNS Errors/);
});

test("lexicon changes group by status from the fixture", async (t) => {
  const out = await render(t, {
    "lexicon-changes.json": {
      nsids: ["com.example.foo", "com.example.bar", "com.example.baz", "com.example.nope"],
      removed: [],
    },
    "status.txt": STATUS,
  });
  assert.match(out, /## 📝 Lexicon Changes/);
  assert.match(out, /\*\*🟠 New \(not yet published\)\*\*\n\n\* `com\.example\.baz`/);
  assert.match(out, /\*\*🟣 Changed \(differs from published\)\*\*\n\n\* `com\.example\.bar`/);
  assert.match(out, /\*\*🟢 Unchanged \(matches published\)\*\*\n\n\* `com\.example\.foo`/);
  assert.match(out, /\*\*Status unknown\*\*\n\n\* `com\.example\.nope`/);
});

test("unparseable or missing status falls back to a changed list", async (t) => {
  for (const status of ["garbage in here now\n", undefined]) {
    const out = await render(t, {
      "lexicon-changes.json": { nsids: ["com.example.foo"], removed: [] },
      "status.txt": status,
    });
    assert.ok(out.includes("Couldn't determine the publish status"));
    assert.match(out, /\*\*Changed in this PR\*\*\n\n\* `com\.example\.foo`/);
  }
});

test("removed lexicons use the configured lexicons-dir", async (t) => {
  const out = await render(t, {
    "meta.json": { "lexicons-dir": "src/lexicons" },
    "lexicon-changes.json": {
      nsids: [],
      removed: ["src/lexicons/com/example/foo.json", "lexicons/com/example/bar.json"],
    },
  });
  assert.match(out, /\*\*🗑️ Removed in this PR\*\*\n\n\* `com\.example\.foo`/);
  assert.doesNotMatch(out, /com\.example\.bar/);
});

test("an unsafe lexicons-dir falls back to lexicons/", async (t) => {
  const out = await render(t, {
    "meta.json": { "lexicons-dir": "../x" },
    "lexicon-changes.json": {
      nsids: [],
      removed: ["src/lexicons/com/example/foo.json", "lexicons/com/example/bar.json"],
    },
  });
  assert.match(out, /\* `com\.example\.bar`/);
  assert.doesNotMatch(out, /com\.example\.foo/);
});

test("removed paths that are not well-formed NSIDs are dropped", async (t) => {
  const out = await render(t, {
    "lexicon-changes.json": {
      nsids: [],
      removed: ["lexicons/a b/c.json", "lexicons/../x.json", "lexicons/com/example/ok.txt", 5],
    },
  });
  assert.doesNotMatch(out, /Lexicon Changes/);
});

test("CLI prints the comment, honouring VALIDATED", (t) => {
  const dir = makeLogs(t);
  const script = path.join(__dirname, "..", "scripts", "format-comment.js");
  const run = (validated) =>
    spawnSync(process.execPath, [script, dir], {
      encoding: "utf8",
      env: { ...process.env, VALIDATED: validated },
    });

  assert.match(run("true").stdout, /## ✅ DNS/);
  assert.match(run("nope").stdout, /Workflow failed to run completely/);
});
