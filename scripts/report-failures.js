const { loadResults, dnsStatus } = require("./lib/results.js");

const MAX_LISTED = 10;

const isCrash = (issues, exitCode) =>
  issues === null || issues === undefined
    ? true
    : issues.length === 0 && exitCode !== null && exitCode !== "0";

function describe(issues) {
  const lines = issues.slice(0, MAX_LISTED).map((i) => {
    const where = [i["file-path"], i.nsid].filter(Boolean).join(" ");
    return `${where ? `${where}: ` : ""}${i.message ?? i["lint-description"] ?? ""}`;
  });
  if (issues.length > MAX_LISTED) {
    lines.push(`...and ${issues.length - MAX_LISTED} more`);
  }
  return lines.join("\n");
}

/**
 * Decide which failures block the PR. Pure: no I/O.
 *
 * @param {object} results Results from loadResults
 * @param {{ breakingWarnings: boolean, dns: boolean }} blocking
 * @returns {{ title: string, message: string }[]}
 */
function evaluate(results, blocking) {
  const failures = [];

  if (isCrash(results.lint, results.lintExitCode)) {
    failures.push({
      title: "Lint failed to run",
      message: `goat lex lint produced no usable output (exit code ${results.lintExitCode ?? "unknown"}). See the job logs.`,
    });
  } else {
    const errors = results.lint.filter((i) => i["lint-level"] === "error");
    if (errors.length) {
      failures.push({ title: "Lint errors", message: describe(errors) });
    }
  }

  if (isCrash(results.breaking, results.breakingExitCode)) {
    failures.push({
      title: "Breaking-change check failed to run",
      message: `goat lex breaking produced no usable output (exit code ${results.breakingExitCode ?? "unknown"}). See the job logs.`,
    });
  } else {
    const breaking = results.breaking.filter(
      (i) => i["lint-level"] === "error" || blocking.breakingWarnings,
    );
    if (breaking.length) {
      failures.push({ title: "Breaking changes", message: describe(breaking) });
    }
  }

  const dns = dnsStatus(results.dnsText);
  // goat check-dns exits 0 on missing records; any exit code file means a crash.
  const dnsCrashed = results.dnsExitCode !== null || dns === "missing";
  if (dnsCrashed) {
    failures.push({
      title: "DNS check failed to run",
      message: `goat lex check-dns produced no usable output (exit code ${results.dnsExitCode ?? "unknown"}). See the job logs.`,
    });
  } else if (blocking.dns && dns === "failed") {
    failures.push({
      title: "DNS records missing",
      message: "Some lexicon NSIDs did not resolve via DNS. See the PR comment for the records to add.",
    });
  } else if (blocking.dns && dns === "unknown") {
    failures.push({
      title: "DNS check result unknown",
      message: "goat lex check-dns output was not recognised, so DNS resolution could not be confirmed.",
    });
  }

  return failures;
}

/** Escape per GitHub workflow-command rules. */
const escapeMessage = (s) =>
  String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

const escapeProperty = (s) =>
  escapeMessage(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

const flag = (value) => value !== "false";

async function main(argv, env) {
  const logsDir = argv[2];
  if (!logsDir) {
    console.error("usage: report-failures.js <logsDir>");
    return 2;
  }
  const results = await loadResults(logsDir);
  const failures = evaluate(results, {
    breakingWarnings: flag(env.BLOCK_BREAKING_WARNINGS),
    dns: flag(env.BLOCK_DNS),
  });
  for (const f of failures) {
    console.log(`::error title=${escapeProperty(f.title)}::${escapeMessage(f.message)}`);
  }
  return failures.length ? 1 : 0;
}

if (require.main === module) {
  main(process.argv, process.env).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(2);
    },
  );
}

module.exports = { evaluate, escapeMessage };
