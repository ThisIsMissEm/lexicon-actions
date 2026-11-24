const fs = require("node:fs/promises");
const path = require("node:path");

// goat v0.2.9 lex_check_dns.go prints exactly one of these.
const DNS_FAILED_LINE = "Some lexicon NSIDs did not resolve via DNS:";
const DNS_OK_LINE = "all lexicon schema NSIDs resolved successfully";

/**
 * Interpret `goat lex check-dns` output.
 *
 * @param {string | null} text
 * @returns {"ok" | "failed" | "unknown" | "missing"}
 */
function dnsStatus(text) {
  if (text === null || text === undefined) return "missing";

  const lines = String(text).split("\n");
  if (lines.some((line) => line.trimEnd() === DNS_FAILED_LINE)) return "failed";
  if (lines.some((line) => line.trim() === DNS_OK_LINE)) return "ok";
  return "unknown";
}

/**
 * Sanitise the untrusted lexicons directory input: relative, no `..`,
 * only [A-Za-z0-9._/-]. Always ends in "/" with no leading "./".
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeLexiconsDir(value) {
  const fallback = "lexicons/";
  if (typeof value !== "string" || !value) return fallback;
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) return fallback;
  if (value.startsWith("/")) return fallback;

  const segments = value.split("/").filter((s) => s !== "" && s !== ".");
  if (!segments.length || segments.includes("..")) return fallback;

  return `${segments.join("/")}/`;
}

/**
 * Which gates block. Only a literal boolean `false` disables one.
 *
 * @param {unknown} meta
 * @returns {{ breakingWarnings: boolean, dns: boolean }}
 */
function readBlocking(meta) {
  const blocking = meta && typeof meta === "object" ? meta.blocking : null;
  const get = (key) =>
    !(blocking && typeof blocking === "object" && blocking[key] === false);

  return { breakingWarnings: get("breaking-warnings"), dns: get("dns") };
}

/**
 * A lint/breaking check "failed to run" when its output is unusable (null), or
 * empty while its exit code says it failed.
 *
 * @param {unknown[] | null | undefined} issues
 * @param {string | null} exitCode
 * @returns {boolean}
 */
function isCrash(issues, exitCode) {
  return issues === null || issues === undefined
    ? true
    : issues.length === 0 && exitCode !== null && exitCode !== "0";
}

const readText = (file) => fs.readFile(file, "utf8").catch(() => null);

async function readJson(file, accept) {
  const text = await readText(file);
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text);
    return accept(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const isArray = Array.isArray;
const isObject = (v) => v !== null && typeof v === "object" && !isArray(v);

async function readExitCode(file) {
  const text = await readText(file);
  return text === null ? null : text.trim();
}

/**
 * Load everything the workflow wrote to the logs directory. `null` means the
 * file was absent or unparseable.
 *
 * @param {string} logsDir
 */
async function loadResults(logsDir) {
  const p = (name) => path.join(logsDir, name);

  const [
    meta,
    lint,
    lintExitCode,
    breaking,
    breakingExitCode,
    dnsText,
    dnsExitCode,
    statusText,
    changes,
  ] = await Promise.all([
    readJson(p("meta.json"), isObject),
    readJson(p("lint.json"), isArray),
    readExitCode(p("lint-exit-code")),
    readJson(p("breaking.json"), isArray),
    readExitCode(p("breaking-exit-code")),
    readText(p("check-dns.txt")),
    readExitCode(p("check-dns-exit-code")),
    readText(p("status.txt")),
    readJson(p("lexicon-changes.json"), isObject),
  ]);

  return {
    meta,
    lint,
    lintExitCode,
    breaking,
    breakingExitCode,
    dnsText,
    dnsExitCode,
    statusText,
    lexiconChanges: {
      nsids: isArray(changes?.nsids) ? changes.nsids : [],
      removed: isArray(changes?.removed) ? changes.removed : [],
    },
  };
}

module.exports = {
  loadResults,
  dnsStatus,
  normalizeLexiconsDir,
  readBlocking,
  isCrash,
};
