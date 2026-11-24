const {
  loadResults,
  dnsStatus,
  normalizeLexiconsDir,
  readBlocking,
  isCrash,
} = require("./lib/results.js");

/**
 *
 * @param {*} checks
 * @returns {Map<string, { nsid: string, "lint-description": string }[]>}
 */
function groupChecksByFile(checks) {
  return checks.reduce((byFile, check) => {
    const filePath = check["file-path"];
    const checks = byFile.get(filePath) ?? [];

    byFile.set(filePath, checks.concat(check));

    return byFile;
  }, new Map());
}

function formatChecks(checks) {
  const checksByFile = groupChecksByFile(checks);
  const output = [];

  for (let [file, checks] of checksByFile) {
    output.push(`* File: \`${file}\``);
    for (let check of checks) {
      output.push(`  * \`${check.nsid}\`: ${check["lint-description"]}`);
    }
  }

  return output.join("\n");
}

/**
 * Breaking-change issues usually have no "file-path", so group by nsid.
 *
 * @param {{ nsid: string, message: string }[]} changes
 * @returns {string}
 */
function formatChanges(changes) {
  const changesByNsid = changes.reduce((byNsid, change) => {
    const nsidChanges = byNsid.get(change.nsid) ?? [];

    byNsid.set(change.nsid, nsidChanges.concat(change));

    return byNsid;
  }, new Map());
  const output = [];

  for (let [nsid, nsidChanges] of changesByNsid) {
    for (let change of nsidChanges) {
      output.push(`* \`${nsid}\`: ${change.message}`);
    }
  }

  return output.join("\n");
}

// NSIDs come from untrusted PR files, so only render well-formed ones.
const NSID_PATTERN = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

// `goat lex status` prints one " <icon> <nsid>" line per lexicon.
const STATUS_LINE = /^\s*(\S+)\s+(\S+)\s*$/u;
const STATUS_BY_ICON = {
  "🟢": "unchanged",
  "🟣": "changed",
  "🟠": "new",
  "⭕": "remote-only",
};

/**
 * Parse `goat lex status` output into a Map of nsid -> status. Returns null if
 * any non-empty line isn't in the expected format, so callers can say the
 * status couldn't be determined instead of guessing.
 *
 * @param {string} text
 * @returns {Map<string, string> | null}
 */
function parseStatus(text) {
  const statuses = new Map();

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;

    const match = STATUS_LINE.exec(line);
    const status = match && STATUS_BY_ICON[match[1]];
    if (!status || !NSID_PATTERN.test(match[2])) return null;

    statuses.set(match[2], status);
  }

  return statuses;
}

/**
 * "lexicons/com/example/foo.json" -> "com.example.foo"
 *
 * @param {string} path
 * @param {string} lexiconsDir Normalized, ends in "/" (see normalizeLexiconsDir)
 * @returns {string | null}
 */
function nsidFromPath(path, lexiconsDir) {
  if (!path.startsWith(lexiconsDir) || !path.endsWith(".json")) return null;

  const inner = path.slice(lexiconsDir.length, -".json".length);
  const nsid = inner.split("/").join(".");

  return NSID_PATTERN.test(nsid) ? nsid : null;
}

/**
 * The "Lexicon Changes" section, or null if the PR touched no lexicon files.
 *
 * @param {{ nsids: unknown[], removed: unknown[] }} lexiconChanges
 * @param {string | null} statusText
 * @param {string} lexiconsDir Normalized lexicons directory prefix
 * @returns {string | null}
 */
function formatLexiconChanges(lexiconChanges, statusText, lexiconsDir) {
  const nsids = lexiconChanges.nsids.filter(
    (nsid) => typeof nsid === "string" && NSID_PATTERN.test(nsid),
  );
  const removed = lexiconChanges.removed
    .filter((path) => typeof path === "string")
    .map((path) => nsidFromPath(path, lexiconsDir))
    .filter(Boolean);

  if (!nsids.length && !removed.length) return null;

  const output = ["## 📝 Lexicon Changes"];
  const list = (title, items) => {
    if (!items.length) return;
    output.push(`**${title}**`);
    output.push(items.map((nsid) => `* \`${nsid}\``).join("\n"));
  };

  if (nsids.length) {
    const statuses = statusText === null ? null : parseStatus(statusText);

    if (statuses === null) {
      output.push(
        "Couldn't determine the publish status of the changed lexicons. Check the workflow logs.",
      );
      list("Changed in this PR", nsids);
    } else {
      // Only report NSIDs this PR touched; goat also lists other published
      // lexicons in the same group.
      const byStatus = (status) =>
        nsids.filter((nsid) => statuses.get(nsid) === status);
      const unknown = nsids.filter((nsid) => !statuses.has(nsid));

      list("🟠 New (not yet published)", byStatus("new"));
      list("🟣 Changed (differs from published)", byStatus("changed"));
      list("🟢 Unchanged (matches published)", byStatus("unchanged"));
      list("Status unknown", unknown);
    }
  }

  list("🗑️ Removed in this PR", removed);

  return output.join("\n\n");
}

/**
 * Put untrusted text in a code fence it cannot close: every backtick is
 * removed, so no run of backticks can appear inside.
 *
 * @param {string} text
 * @returns {string}
 */
function fenced(text) {
  return `\`\`\`\n${text.replace(/`+/g, "").trimEnd()}\n\`\`\``;
}

/**
 * The DNS section. Mirrors report-failures.js: any exit code, or missing
 * output, is a crash that always blocks; an unrecognised result blocks only
 * when DNS is blocking.
 *
 * @param {{ dnsText: string | null, dnsExitCode: string | null }} results
 * @param {boolean} blocking
 * @returns {string[]}
 */
function formatDns({ dnsText, dnsExitCode }, blocking) {
  const status = dnsStatus(dnsText);

  if (dnsExitCode !== null) {
    return ["## ❌ DNS Errors", "The DNS check failed to run. Check the workflow logs."];
  }
  if (status === "ok") {
    return ["## ✅ DNS", "No DNS issues detected!"];
  }

  const notBlocking = [
    "## 🟡 DNS Issues (not blocking)",
    "This repository doesn't block merging on DNS checks.",
  ];

  if (status === "failed") {
    return blocking
      ? ["## ❌ DNS Errors", fenced(dnsText)]
      : [...notBlocking, fenced(dnsText)];
  }

  const unknown = "Couldn't determine the DNS check result. Check the workflow logs.";
  // "missing" always blocks (report-failures treats it as a crash).
  if (status === "unknown" && !blocking) return [...notBlocking, unknown];
  return ["## ❌ DNS Errors", unknown];
}

/**
 * Render the PR comment from the logs the check workflow produced. The logs
 * are untrusted, so everything read from them is validated or fenced.
 *
 * @param {{ logsDir: string, validated: boolean }} options
 * @returns {Promise<string>}
 */
async function formatComment({ logsDir, validated }) {
  if (!validated) {
    return "## ‼️ Error: Workflow failed to run completely";
  }

  let output = [];

  const results = await loadResults(logsDir);
  const blocking = readBlocking(results.meta);
  const lexiconsDir = normalizeLexiconsDir(results.meta?.["lexicons-dir"]);
  const { lint, breaking: changes, breakingExitCode } = results;

  const lexiconSection = formatLexiconChanges(
    results.lexiconChanges,
    results.statusText,
    lexiconsDir,
  );
  if (lexiconSection) {
    output.push(lexiconSection);
  }

  if (isCrash(lint, results.lintExitCode)) {
    output.push("## ‼️ Linting");
    output.push("The lint check failed to run. Check the workflow logs.");
  } else if (lint.length) {
    const errors = lint.filter((check) => check["lint-level"] === "error");
    const warnings = lint.filter((check) => check["lint-level"] === "warn");

    if (errors.length) {
      output.push("## ‼️ Linting Errors");
    } else if (warnings.length) {
      output.push("## 🟡 Linting Warnings");
    } else {
      output.push("## ✅ Linting");
    }

    if (errors.length || warnings.length) {
      const lintOutput = [];

      if (errors.length) {
        lintOutput.push("### Errors:\n");
        lintOutput.push(formatChecks(errors));

        if (warnings.length) lintOutput.push("\n");
      }

      if (warnings.length) {
        lintOutput.push("### Warnings:\n");
        lintOutput.push(formatChecks(warnings));
      }

      output.push(lintOutput.join("\n"));
    } else {
      output.push("No linting issues found.");
    }
  }

  if (isCrash(changes, breakingExitCode)) {
    // The file is untrusted, so only print it if it is purely numeric.
    const code =
      breakingExitCode !== null && /^[0-9]+$/.test(breakingExitCode)
        ? ` (exit code ${breakingExitCode})`
        : "";

    output.push("## ‼️ Incompatible Changes");
    output.push(
      `The breaking change check failed to run${code}. Check the workflow logs.`,
    );
  } else if (changes.length) {
    const hasErrors = changes.some(
      (change) => change["lint-level"] === "error",
    );
    const notBlocking = !hasErrors && !blocking.breakingWarnings;

    output.push(
      hasErrors
        ? "## ‼️ Incompatible Changes"
        : notBlocking
          ? "## 🟡 Incompatible Changes (not blocking)"
          : "## 🟡 Incompatible Changes",
    );
    if (notBlocking) {
      output.push(
        "This repository doesn't block merging on warn-level breaking changes.",
      );
    }
    output.push(
      hasErrors
        ? "These changes aren't backwards compatible with the published lexicons: records that are valid today could become invalid, and existing clients may reject new records. Published lexicons should only change in backwards compatible ways, like adding optional fields. For a breaking change, publish a new NSID instead (for example `com.example.fooV2`)."
        : "These changes may not be backwards compatible with the published lexicons. Check that existing records and clients will still work with them.",
    );
    output.push(formatChanges(changes));
  } else {
    output.push("## ✅ Incompatible Changes");
    output.push("No breaking changes were detected.");
  }

  output.push(...formatDns(results, blocking.dns));

  return output.join("\n\n");
}

module.exports = { formatComment, nsidFromPath };

if (require.main === module) {
  formatComment({
    logsDir: process.argv[2],
    validated: process.env.VALIDATED === "true",
  }).then(
    (comment) => console.log(comment),
    (err) => {
      console.error(err);
      process.exit(2);
    },
  );
}
