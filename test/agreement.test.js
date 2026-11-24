const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { evaluate } = require("../scripts/report-failures.js");
const { formatComment } = require("../scripts/format-comment.js");
const { loadResults, readBlocking } = require("../scripts/lib/results.js");

// The check's exit status (report-failures) and the PR comment (format-comment)
// are computed separately. This asserts they never disagree about whether, and
// where, something blocks.

const FIXTURES = path.join(__dirname, "fixtures", "goat", "v0.2.9");
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");

const issue = (level) => ({
  nsid: "com.example.foo",
  "file-path": "lexicons/com/example/foo.json",
  "lint-level": level,
  "lint-description": "x",
  message: "x",
});

// Each shape is the set of files written for one check; undefined = absent.
const issueShapes = (stem) => ({
  none: { [`${stem}.json`]: "[]" },
  warn: { [`${stem}.json`]: JSON.stringify([issue("warn")]) },
  error: { [`${stem}.json`]: JSON.stringify([issue("error")]) },
  "crash-null": {},
  "crash-exit": { [`${stem}.json`]: "[]", [`${stem}-exit-code`]: "2" },
});
const DNS_SHAPES = {
  ok: { "check-dns.txt": fixture("check-dns-ok.txt") },
  failed: { "check-dns.txt": fixture("check-dns-missing.txt") },
  unknown: { "check-dns.txt": "something unexpected\n" },
  missing: {},
  "exit-code": { "check-dns.txt": fixture("check-dns-ok.txt"), "check-dns-exit-code": "1" },
};

// failure title prefix -> the comment section it must be reflected in
const SECTIONS = [
  ["Lint", "Linting"],
  ["Breaking", "Incompatible Changes"],
  ["DNS", "DNS"],
];

test("evaluate() and formatComment() agree on what blocks", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agreement-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  let n = 0;
  for (const [lintName, lint] of Object.entries(issueShapes("lint")))
    for (const [brkName, brk] of Object.entries(issueShapes("breaking")))
      for (const [dnsName, dns] of Object.entries(DNS_SHAPES))
        for (const bw of [true, false])
          for (const blockDns of [true, false]) {
            const label = `lint=${lintName} breaking=${brkName} dns=${dnsName} bw=${bw} blockDns=${blockDns}`;
            const dir = path.join(root, String(n++));
            fs.mkdirSync(dir);
            const meta = { blocking: { "breaking-warnings": bw, dns: blockDns } };
            const files = { ...lint, ...brk, ...dns, "meta.json": JSON.stringify(meta) };
            for (const [name, text] of Object.entries(files)) {
              fs.writeFileSync(path.join(dir, name), text);
            }

            const results = await loadResults(dir);
            const failures = evaluate(results, readBlocking(results.meta));
            const comment = await formatComment({ logsDir: dir, validated: true });
            const headings = comment.split("\n").filter((l) => l.startsWith("## "));
            const alarming = (h) => /‼️|❌/.test(h);

            if (!failures.length) {
              assert.deepEqual(headings.filter(alarming), [], label);
              continue;
            }
            for (const [prefix, section] of SECTIONS) {
              if (!failures.some((f) => f.title.startsWith(prefix))) continue;
              const own = headings.filter((h) => h.includes(section));
              assert.ok(!own.some((h) => h.includes("(not blocking)")), `${label}: ${own}`);
              assert.ok(
                own.some((h) => alarming(h) || h.includes("(blocking)")),
                `${label}: no blocking heading for ${section}: ${own}`,
              );
            }
          }
  assert.equal(n, 500);
});
