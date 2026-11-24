# lexicon-actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Model:** Claude Opus, per Emelia (2026-11-24). Execution is subagent-driven, with a review after each task.

**Goal:** Port germ-network/lexicon's lexicon CI into reusable workflows (`validate`, `comment`, `publish`) plus a pinned, verified internal `setup-goat` action, then migrate germ onto them.

**Architecture:** Three `workflow_call` workflows own the security-critical job structure. Every job that needs our own files checks out lexicon-actions at `job.workflow_repository` + `job.workflow_sha` into `.lexicon-actions/`. Pass/fail logic and comment formatting live in plain Node scripts that share one results loader. That loader is the only place goat output is interpreted, and it's unit-tested against captured goat output.

**Tech Stack:** GitHub Actions (reusable workflows, composite action), Node 24 (CommonJS, `node:test`, no dependencies), bash and jq in workflow steps, goat `v0.2.9`, actionlint.

**Spec:** `docs/superpowers/specs/2026-11-24-lexicon-actions-design.md`

## Amendments (2026-11-24, after final review)

- A: check logs are written to `$RUNNER_TEMP/check-logs`; the artifact is renamed `lexicon-check-logs`.
- B: comment identity via an optional GitHub App (`app-id` / `app-private-key`); comments still use `gh pr comment --edit-last`, with no comment-tagging scheme.
- C: setup-goat is internal, at `.github/actions/setup-goat/` (with the checksums); no root action, no Marketplace.
- D: publish uses an ephemeral in-memory login (`GOAT_USERNAME`/`GOAT_PASSWORD` on `goat lex publish`); no login, check-auth or logout steps.
- E: the goat install logic lives in `scripts/install-goat.sh`; the action just calls it.
- F: `comment.yml` takes an optional `app-id` input and `app-private-key` secret and mints a GitHub App token (pull requests: write) for commenting; the optional `github-token` secret was dropped.

## Global Constraints

- Default `goat-version`: `v0.2.9`. It must match `^v[0-9]+\.[0-9]+\.[0-9]+$`, and anything else fails the job.
- Never interpolate `${{ inputs.* }}`, `${{ github.event.* }}` or artifact-derived values into `run:` scripts. Pass them through `env:`.
- No job that runs adopter or PR code has a write token. `comment.yml` never checks out the adopter's repo.
- Our-files checkout is always `repository: ${{ job.workflow_repository }}`, `ref: ${{ job.workflow_sha }}`, `path: .lexicon-actions`, `persist-credentials: false`.
- Pinned third-party actions: `actions/checkout@v6`, `actions/upload-artifact@v6`, `actions/download-artifact@v7`, `actions/setup-node@v4` with `node-version: "24.x"`.
- Required check names: `lexicon / detect-changes` and `lexicon / validate-changes` (caller job `lexicon`, reusable jobs `detect-changes` and `validate-changes`).
- Artifact name: `lexicon-check-logs` (files written under `$RUNNER_TEMP/check-logs`). `meta.json` shape: `{"pr": <int>, "finished": <bool>, "skipped"?: true, "blocking": {"breaking-warnings": <bool>, "dns": <bool>}, "lexicons-dir": "<string>"}`.
- A missing or non-boolean `blocking.*` means `true`. A missing or invalid `lexicons-dir` means `lexicons/`.
- Scripts take no npm dependencies. `package.json` exists only for `pnpm test`.
- Signed commits: `git commit` needs the 1Password agent socket, so run it **outside the Bash sandbox**. If Touch ID times out, stop and ask Emelia. Never use `--no-gpg-sign`.

## Review Focus

1. **goat crashes before writing JSON:** a non-zero exit with an empty or missing `lint.json`/`breaking.json` must fail as "failed to run", never pass as "no issues". Tested in Task 2.
2. **A future goat changes `check-dns` wording:** output matching neither known line must count as DNS failure ("couldn't determine"), never as success. Tested in Task 1.
3. **`lexicons-dir` spellings** (`lexicons`, `lexicons/`, `./lexicons/`, `src/lexicons`) must all map removed files to NSIDs and match the same changed files. Tested in Tasks 1 and 3.
4. **Untrusted `meta.json`** with `"blocking": {"dns": "false"}`, `"lexicons-dir": "../x"`, or `"lexicons-dir": 5` must fall back to the strict or default values. Tested in Task 3.
5. **DNS text containing backtick runs**, a hostile `</pre>`, or a fake `## ✅` heading must stay inside the code fence. Tested in Task 3.

---

## File Structure

```
scripts/install-goat.sh              # Task 4: goat install logic (pinned + verified)
.github/actions/setup-goat/action.yml  # Task 4: internal composite action = setup-goat
keys/goat-release.asc               # Task 4 (variant A) or
.github/actions/setup-goat/goat-checksums.txt  # Task 4 (variant B): pinned per-version SHA-256s
scripts/lib/results.js              # Task 1: load + interpret goat output (single source of truth)
scripts/report-failures.js          # Task 2: blocking decision + ::error annotations (validate)
scripts/format-comment.js           # Task 3: PR comment markdown (comment)
test/results.test.js                # Task 1
test/report-failures.test.js        # Task 2
test/format-comment.test.js         # Task 3
test/fixtures/goat/v0.2.9/*         # Task 1: captured goat output
test/lexicons/**                    # Task 8: fixture lexicons for self-test
.github/workflows/validate.yml      # Task 5
.github/workflows/comment.yml       # Task 6
.github/workflows/publish.yml       # Task 7
.github/workflows/test.yml          # Tasks 1, 4: unit tests, actionlint, setup-goat tests
.github/workflows/self-validate.yml # Task 8: name "Self-test: Validate lexicon"
.github/workflows/self-comment.yml  # Task 8
package.json                        # Task 1
README.md                           # Task 9 (adopter guide)
```

---

## Phase 1: Build (Claude, in this repo)

Hand-off step 1 is done: the repo exists, and `main` tracks `origin/main` at `ae60503` plus `18f89db`.

### Task 1: Results loader and DNS rule

**Files:**
- Create: `package.json`, `scripts/lib/results.js`, `test/results.test.js`, `test/fixtures/goat/v0.2.9/{check-dns-ok.txt,check-dns-missing.txt,lint.json,breaking.json,status.txt}`, `.github/workflows/test.yml`

**Interfaces:**
- Produces:
  - `loadResults(logsDir: string) -> Promise<Results>`
  - `dnsStatus(text: string | null) -> "ok" | "failed" | "unknown" | "missing"`
  - `normalizeLexiconsDir(value: unknown) -> string` (always ends in `/`, no leading `./`; invalid → `"lexicons/"`)
  - `readBlocking(meta: unknown) -> { breakingWarnings: boolean, dns: boolean }`
  - `Results = { meta: object|null, lint: Issue[]|null, lintExitCode: string|null, breaking: Issue[]|null, breakingExitCode: string|null, dnsText: string|null, dnsExitCode: string|null, statusText: string|null, lexiconChanges: {nsids: unknown[], removed: unknown[]} }`
  - `null` means the file was absent or unparseable. Exit-code files are `logs/{lint,breaking,check-dns}-exit-code`, written only on a non-zero exit.

- [ ] **Step 1: Create the fixtures.** Write `check-dns-ok.txt` and `check-dns-missing.txt` verbatim from the `fmt.Print*` calls in goat `v0.2.9` `lex_check_dns.go:63-88` (use `did:plc:example` for the DID). Capture `lint.json`, `breaking.json` and `status.txt` by running the local goat over a scratch dir with one deliberately bad lexicon (`goat lex lint --json <dir> | jq --slurp`). Note in a `test/fixtures/goat/v0.2.9/README.md` how each fixture was produced.
- [ ] **Step 2: Write the failing tests** in `test/results.test.js`:
  - `dnsStatus(ok fixture) === "ok"`
  - `dnsStatus(missing fixture) === "failed"`
  - `dnsStatus("") === "unknown"` and `dnsStatus("something else") === "unknown"`
  - `dnsStatus(null) === "missing"`
  - a text with both the success and failure lines → `"failed"`
  - `normalizeLexiconsDir` maps `"lexicons"`, `"lexicons/"` and `"./lexicons/"` → `"lexicons/"`, and `"src/lexicons"` → `"src/lexicons/"`. `"../x"`, `"/abs"`, `5`, `""`, `"a\nb"` and `"a b"` → `"lexicons/"`. Allowed characters: `[A-Za-z0-9._/-]`, and no `..` segment.
  - `readBlocking({blocking:{dns:false}})` → `{breakingWarnings:true, dns:false}`. `readBlocking({blocking:{dns:"false"}})` → both `true`. `readBlocking(null)` → both `true`.
  - `loadResults` on a temp dir: an empty dir gives all `null` plus empty `lexiconChanges`, and the fixture files are parsed.
- [ ] **Step 3: Run.** `pnpm test` → FAIL (module not found). `package.json`: `{"private": true, "type": "commonjs", "scripts": {"test": "node --test test/"}}`.
- [ ] **Step 4: Implement `scripts/lib/results.js`.** DNS rule: `"failed"` if any line equals `Some lexicon NSIDs did not resolve via DNS:`. Otherwise `"ok"` if any trimmed line equals `all lexicon schema NSIDs resolved successfully`. Otherwise `"unknown"`.
- [ ] **Step 5: Run.** `pnpm test` → PASS.
- [ ] **Step 6: Add `.github/workflows/test.yml`.** Triggers: `pull_request` and `push` to `main`. `permissions: contents: read`. Job `unit`: checkout, setup-node, `node --test test/`. Job `actionlint`: download the pinned `rhysd/actionlint` release `v1.7.7` `linux_amd64.tar.gz`, verify it against the release's `checksums.txt`, then run `actionlint`. Locally: `actionlint` → no output.
- [ ] **Step 7: Commit** `feat: results loader with goat v0.2.9 DNS rule` (outside the sandbox).

### Task 2: Blocking decision (`report-failures.js`)

**Files:**
- Create: `scripts/report-failures.js`, `test/report-failures.test.js`

**Interfaces:**
- Consumes: `loadResults`, `dnsStatus`, `readBlocking` (Task 1).
- Produces:
  - `evaluate(results: Results, blocking: {breakingWarnings: boolean, dns: boolean}) -> Failure[]`, where `Failure = { title: string, message: string }`.
  - CLI: `node scripts/report-failures.js <logsDir>`. Reads blocking from env `BLOCK_BREAKING_WARNINGS` and `BLOCK_DNS` (`"true"`/`"false"`; anything else means `true`). Prints one `::error title=<title>::<message>` per failure, and exits 1 if there are any failures, else 0.

- [ ] **Step 1: Write the failing tests.** Each test is a `Results` literal → expected titles:
  - clean results → `[]`
  - a lint issue with `lint-level: "error"` → `["Lint errors"]`
  - lint warnings only → `[]`
  - `lint: []` with `lintExitCode: "255"` → `["Lint failed to run"]` (Review Focus 1)
  - `lint: null` with `lintExitCode: null` → `["Lint failed to run"]`
  - a breaking error → `["Breaking changes"]`
  - a breaking warning: with `breakingWarnings: true` → `["Breaking changes"]`; with `false` → `[]`
  - `breaking: []` with `breakingExitCode: "1"` → `["Breaking-change check failed to run"]`
  - DNS `"failed"`: with `dns: true` → `["DNS records missing"]`; with `false` → `[]`
  - DNS `"unknown"` with `dns: true` → `["DNS check result unknown"]` (Review Focus 2)
  - `dnsExitCode: "1"` → `["DNS check failed to run"]`, **regardless of the `dns` setting** (a crash isn't a DNS finding)
  - CLI test: spawn the script with a fixture logs dir. It exits 1, and stdout matches `/^::error title=DNS records missing::/m`.
- [ ] **Step 2: Run.** `pnpm test` → FAIL.
- [ ] **Step 3: Implement `evaluate` and the CLI.** Annotation messages have `%`, `\r` and `\n` escaped as `%25`, `%0D` and `%0A`, per GitHub's workflow-command escaping.
- [ ] **Step 4: Run.** `pnpm test` → PASS.
- [ ] **Step 5: Commit** `feat: blocking decision and failure annotations`.

### Task 3: Port `format-comment.js`

**Files:**
- Create: `scripts/format-comment.js` (port of germ's `scripts/format-comment.js` at `027cf5a`), `test/format-comment.test.js`

**Interfaces:**
- Consumes: `loadResults`, `dnsStatus`, `readBlocking`, `normalizeLexiconsDir` (Task 1).
- Produces:
  - `formatComment({ logsDir: string, validated: boolean }) -> Promise<string>`
  - CLI: `node scripts/format-comment.js <logsDir>`, with env `VALIDATED` (`"true"` means validated). Prints the markdown to stdout.

- [ ] **Step 1: Write the failing tests.** Port today's behaviour as tests first, then add the new behaviour:
  - `validated: false` → exactly `## ‼️ Error: Workflow failed to run completely`
  - lint errors → contains `## ‼️ Linting Errors` and `` * File: `lexicons/...` ``
  - breaking error → `## ‼️ Incompatible Changes`; warning only, blocking → `## 🟡 Incompatible Changes`
  - breaking warning with `meta.blocking["breaking-warnings"] === false` → `## 🟡 Incompatible Changes (not blocking)` plus the line `This repository doesn't block merging on warn-level breaking changes.`
  - DNS failed, blocking → `## ❌ DNS Errors`; with `meta.blocking.dns === false` → `## 🟡 DNS Issues (not blocking)` plus `This repository doesn't block merging on DNS checks.`
  - DNS `"unknown"` → `## ❌ DNS Errors` plus `Couldn't determine the DNS check result. Check the workflow logs.`
  - DNS text is in a ```` ``` ```` fence. Input containing ```` ``` ````, `` `` ``, `</pre>` and `\n## ✅ DNS` → the output has exactly two lines starting with ```` ``` ```` around the DNS block, and no `` ` `` inside it (Review Focus 5). Every backtick run is removed.
  - `meta.blocking.dns === "false"` (a string) → blocking wording (Review Focus 4)
  - Removed `src/lexicons/com/example/foo.json` with `meta["lexicons-dir"] = "src/lexicons"` → `🗑️ Removed in this PR` lists `com.example.foo`. With `lexicons-dir` set to `"../x"`, `src/lexicons/...` is not listed, and `lexicons/com/example/bar.json` is (Review Focus 3, 4).
  - Status parsing: the `status.txt` fixture yields the 🟠/🟣/🟢 groups. Non-matching text → `Couldn't determine the publish status`.
- [ ] **Step 2: Run.** `pnpm test` → FAIL.
- [ ] **Step 3: Implement.** Copy germ's file, then:
  - read inputs via `loadResults(logsDir)`
  - replace `process.env.CI && !validated` with the `validated` parameter
  - make `nsidFromPath(path, lexiconsDir)` use the normalized prefix (string `startsWith`, not a regex built from input)
  - add the not-blocking variants above
  - change the CLI entry to print `formatComment({logsDir: argv[2], validated: env.VALIDATED === "true"})`
- [ ] **Step 4: Run.** `pnpm test` → PASS.
- [ ] **Step 5: Commit** `feat: port format-comment with blocking wording and fenced DNS output`.

### Task 4: `setup-goat` internal action ⚠️ starts with a gate

**Files:**
- Create: `.github/actions/setup-goat/action.yml`, plus `keys/goat-release.asc` (variant A) **or** `.github/actions/setup-goat/goat-checksums.txt` (variant B)
- Modify: `.github/workflows/test.yml` (add `setup-goat` jobs)

**Interfaces:**
- Produces: composite action with input `goat-version` (default `v0.2.9`) and output `goat-path`. It installs `goat` on `PATH`. Supports `runner.os == 'Linux'` with `runner.arch` `X64` → `x86_64` and `ARM64` → `arm64`. Anything else fails with `::error::`.

- [ ] **Step 1: Find the signing key.**
  - Download `goat_0.2.9_checksums.txt.sig` and run `gpg --list-packets` on it (`--list-packets` prints the signature's metadata, including the signer's key ID) to get the key ID.
  - Look for that key at: a key file in `bluesky-social/goat`, `https://github.com/<bluesky maintainer>.gpg` (start with `bnewbold`), and `keys.openpgp.org`.
  - Also check whether Bluesky has answered the upstream setup-goat request (spec, "Pending upstream").
- [ ] **Step 2: GATE: Emelia picks the variant.** Report the key ID, where it was found (or that it wasn't), and the fingerprint. **Stop and wait.**
  - Variant A: the key is published somewhere authoritative.
  - Variant B: it isn't. Pin per-version SHA-256s.
  - If Bluesky now hosts an action that pins and verifies goat, skip this task. Instead, reference their action by SHA in Tasks 5 and 7.
- [ ] **Step 3: Add the failing test jobs** to `test.yml`:
  - `setup-goat` on a matrix of `ubuntu-latest` and `ubuntu-24.04-arm`: `uses: ./.github/actions/setup-goat`, then assert that `goat -v` prints `goat version 0.2.9`.
  - `setup-goat-bad-version`: `uses: ./.github/actions/setup-goat` with `goat-version: "v0.2.9; echo pwned"`, `continue-on-error: true`, then assert the step outcome was `failure`.
  - `setup-goat-tampered` (variant B only): point at a version missing from `goat-checksums.txt`, and assert failure.
- [ ] **Step 4: Implement `action.yml`.**
  - Validate the version against the Global Constraints regex, via `env`.
  - Download from `https://github.com/bluesky-social/goat/releases/download/$VERSION/...` with `curl -fsSL`. No token is needed.
  - Variant A: `gpg --no-default-keyring --keyring <tmp> --import keys/goat-release.asc`, then `gpg --verify` the `.sig`, then `sha256sum --check --ignore-missing`.
  - Variant B: look up `<version> <arch> <sha256>` in `goat-checksums.txt` (relative to `${{ github.action_path }}`), then `sha256sum --check`.
  - Extract the tarball to `$RUNNER_TEMP/goat-bin`, and append that dir to `$GITHUB_PATH`.
- [ ] **Step 5: Verify locally.** `actionlint` passes clean. In CI, the jobs pass on the first push of this branch, which happens in Phase 2.
- [ ] **Step 6: Commit** `feat: setup-goat root action with pinned, verified goat`.

### Task 4b: `scripts/pin-goat.sh`, a maintainer tool for new goat releases

Added at Emelia's request (2026-11-24), after she chose variant B (pinned SHA-256s) at
the Task 4 gate.

**Files:**
- Create: `scripts/pin-goat.sh`, `keys/goat-release.asc` (bnewbold's public key, used only by this tool; it is never used at action runtime)

**Interfaces:**
- Produces: `scripts/pin-goat.sh <version>`, e.g. `scripts/pin-goat.sh v0.2.10`.
  - Validates `<version>` against `^v[0-9]+\.[0-9]+\.[0-9]+$`.
  - Downloads `goat_<ver-without-v>_checksums.txt` and its `.sig` into a `mktemp -d` dir.
  - Verifies the signature with `gpg --homedir <tmp> --status-fd 1 --verify`, against `keys/goat-release.asc` imported into a temporary keyring. It requires a `[GNUPG:] VALIDSIG` line whose signing-key fingerprint is exactly `0C8E4A0DA8E9990872952B3B084425E080357D53`. A good signature from any other key fails, naming the key.
  - Prints `<version> x86_64 <sha256>` and `<version> arm64 <sha256>` to stdout, ready to append to `goat-checksums.txt`.
  - Exits non-zero on any failure, cleans up its temp dir, and never modifies repo files.
  - Requires `curl`, `gpg` and `sha256sum` or `shasum -a 256`. It must run on macOS and Linux.

- [ ] **Step 1:** Export the key: `gpg --export --armor 3F468108EE58663CB95AE9DC0C9337BCEC3932B9` from a temp keyring populated from `keyserver.ubuntu.com`, into `keys/goat-release.asc`. Add `keys/README.md` with the primary and signing-subkey fingerprints, where the key comes from (GitHub user bnewbold's registered key ID `0C9337BCEC3932B9`; the full key is on keyserver.ubuntu.com), and its expiry (2032-02-29).
- [ ] **Step 2:** Run `scripts/pin-goat.sh v0.2.9`. Its output must equal the two v0.2.9 lines in `goat-checksums.txt` (`diff <(scripts/pin-goat.sh v0.2.9) <(grep '^v0.2.9 ' goat-checksums.txt)` prints nothing). `scripts/pin-goat.sh 0.2.9` exits non-zero with a usage message.
- [ ] **Step 3:** Add a `pin-goat` job to `test.yml` that runs `scripts/pin-goat.sh v0.2.9` and diffs its output against `goat-checksums.txt`. That catches table drift and key breakage. `shellcheck scripts/pin-goat.sh` must pass, if shellcheck is installed.
- [ ] **Step 4: Commit** `feat: pin-goat maintainer tool for verifying goat releases`.

### Task 5: `validate.yml`

**Files:**
- Create: `.github/workflows/validate.yml` (port of germ's `ci.yml`)

**Interfaces:**
- Consumes: `.github/actions/setup-goat/action.yml` (Task 4), `scripts/report-failures.js` (Task 2).
- Produces: `on: workflow_call` with these inputs:
  - `did` (string, required)
  - `goat-version` (string, default `v0.2.9`)
  - `lexicons-dir` (string, default `lexicons/`)
  - `fail-on-breaking-warnings` (boolean, default `true`)
  - `fail-on-dns` (boolean, default `true`)

  Jobs are `detect-changes` and `validate-changes`. It writes the `lexicon-check-logs` artifact using the `meta.json` shape in Global Constraints.

- [ ] **Step 1: `detect-changes`.**
  - Port germ's `changes` job.
  - The relevance test is `.filename | startswith($dir) or startswith(".github/workflows/")`, with `$dir` the normalized `lexicons-dir` passed via `--arg`. Lexicon files are the ones that start with `$dir` and end with `.json`.
  - Normalize the input in bash with the same rules as `normalizeLexiconsDir`. If it's invalid, fail with `::error title=Invalid lexicons-dir::`.
  - On a skip, `meta.json` also carries `blocking` and `lexicons-dir`.
- [ ] **Step 2: `validate-changes`.**
  - Start by checking `did`: if it's empty, `::error title=Missing did::did input is empty. Set the LEXICON_DID repository variable. Fork pull requests may not receive repository variables.`, then exit 1.
  - Steps: checkout the caller repo, then checkout our files (Global Constraints), `uses: ./.lexicon-actions` with `goat-version`, and setup-node.
  - Set `env: LEXICONS_DIR` at job level.
  - Run lint, breaking and check-dns each as `set -o pipefail; goat lex … | tee logs/X || echo $? > logs/X-exit-code`, so the step itself succeeds and the exit code is recorded. Lint and breaking pipe through `jq --slurp`.
  - The status step is a port, as is.
  - `meta.json`: `finished` is true when the lint, breaking and DNS steps all ran (`success` outcomes). Add `blocking` and `lexicons-dir` from inputs, passed via env and built with `jq --argjson`.
  - Upload `lexicon-check-logs` (from `$RUNNER_TEMP/check-logs`). Last step: `node .lexicon-actions/scripts/report-failures.js "$LOGS_DIR"`, with `BLOCK_*` from inputs via env.
- [ ] **Step 3: Verify.** `actionlint` passes clean, and `grep -n '\${{' .github/workflows/validate.yml` shows no expression inside a `run:` block.
- [ ] **Step 4: Commit** `feat: reusable validate workflow`.

### Task 6: `comment.yml`

**Files:**
- Create: `.github/workflows/comment.yml` (port of germ's `comment.yml`)

**Interfaces:**
- Consumes: `scripts/format-comment.js` CLI (Task 3).
- Produces: `on: workflow_call`, no inputs. Jobs `gather`, `in-progress` and `publish` are as in germ.

- [ ] **Step 1: Port it.** Keep `gather` and `in-progress` verbatim, including the job-level permissions and the concurrency groups. In `publish`:
  - replace the adopter checkout with our-files checkout (Global Constraints). The adopter's repo is never checked out.
  - replace the `github-script` step with `node .lexicon-actions/scripts/format-comment.js logs > comment.txt`, using env `VALIDATED`
  - keep the artifact download, the jq `meta.json` validation, the skipped comment, and the failure fallback comment unchanged
- [ ] **Step 2: Verify.** `actionlint` passes clean. `grep -n 'actions/checkout' -A3` shows only `job.workflow_repository`.
- [ ] **Step 3: Commit** `feat: reusable comment workflow`.

### Task 7: `publish.yml`

**Files:**
- Create: `.github/workflows/publish.yml` (port of germ's `cd.yml`)

**Interfaces:**
- Produces: `on: workflow_call` with inputs `did` (required), `goat-version` and `lexicons-dir`, and secret `app-password` (required). Job `publish`.

- [ ] **Step 1: Port it.**
  - Steps: checkout the caller, checkout our files, `uses: ./.lexicon-actions/.github/actions/setup-goat`, then `goat lex publish -u` with `GOAT_USERNAME`, `GOAT_PASSWORD` and `LEXICONS_DIR` in that step's env (in-memory login).
  - No login, check-auth or logout steps: no session file is written.
  - Fail early, with `::error title=Missing did::`, if `did` is empty.
- [ ] **Step 2: Verify.** `actionlint` passes clean.
- [ ] **Step 3: Commit** `feat: reusable publish workflow`.

### Task 8: Self-test callers and fixture lexicons

**Files:**
- Create: `test/lexicons/fyi/unobvious/lexiconactions/selftest/example.json` (a valid record lexicon), `.github/workflows/self-validate.yml`, `.github/workflows/self-comment.yml`

- [ ] **Step 1: Write the callers.**
  - `self-validate.yml`: `name: "Self-test: Validate lexicon"`, `on: pull_request`, caller job `lexicon` → `uses: ./.github/workflows/validate.yml` with:
    - `did: did:plc:lexiconactionsselftest` (a literal; add a comment saying adopters use `vars.LEXICON_DID`)
    - `lexicons-dir: test/lexicons`
    - `fail-on-dns: false` (the fixture NSID has no `_lexicon` record, so this exercises the non-blocking wording)
  - `self-comment.yml`: `workflow_run` on `["Self-test: Validate lexicon"]` → `uses: ./.github/workflows/comment.yml`, with the caller permissions from the spec. There's no self-publish, because there's no account. `publish.yml` is first exercised in germ (Phase 4).
- [ ] **Step 2: Verify locally.** `actionlint` passes clean, and `goat lex lint --lexicons-dir test/lexicons` exits 0.
- [ ] **Step 3: Commit** `test: self-test callers and fixture lexicons`.

### Task 9: README adopter guide

**Files:**
- Modify: `README.md` (keep Emelia's existing intro wording; replace "Status" when tagging)

- [ ] **Step 1: Write the sections in the spec's "README" order:**
  - what you get (screenshot placeholder)
  - setup: `LEXICON_DID`, `LEXICON_APP_PASSWORD`, the three caller files verbatim from the spec (job id `lexicon`), and `_lexicon` DNS records
  - required checks `lexicon / detect-changes` and `lexicon / validate-changes`, and why both are needed
  - the inputs table
  - the security model, including the CODEOWNERS recommendation
  - fork PRs, marked "to be confirmed in Phase 4"
  - ~~`setup-goat` standalone usage~~ (dropped: it is an internal action), plus the key fingerprint (variant A) or the pinned-checksum note (variant B)
  - versioning
- [ ] **Step 2: Verify.** The caller YAML blocks pass actionlint: paste them into a scratch dir and run `actionlint <file>`.
- [ ] **Step 3: Commit** `docs: adopter guide`.

---

## Phase 2: Release (gate: Emelia's OK at each push or tag)

### Task 10: Push, self-test, tag

- [ ] **Step 1:** Ask Emelia before pushing `main`. Then `git push origin main`. This is SSH, so it may prompt for Touch ID; run it outside the sandbox.
- [ ] **Step 2:** `test.yml` is green on `main`, checked with `gh run list --workflow test.yml --limit 1`. If `gh` can't authenticate here, ask Emelia to check the Actions tab.
- [ ] **Step 3:** Self-test PR. Branch `selftest/fixture-change`, edit the description in `test/lexicons/.../example.json`, push, open a PR. Expected:
  - a ⏳ comment, then a results comment with `## 🟡 DNS Issues (not blocking)`
  - checks `lexicon / detect-changes` and `lexicon / validate-changes` both pass
  - record the exact check names shown and the `github.workflow_ref` value (add `echo "$GITHUB_WORKFLOW_REF"` to `detect-changes` temporarily, or read it from the logs)
  - close the PR without merging
- [ ] **Step 3b:** Prepare the release commit.
  - Remove the README's pre-release Status banner, and change "What it will do" to "What it does".
  - Update the spec's Status line.
  - Commit `docs: release v1.0.0`, so the tag lands on a commit whose README matches it.
- [ ] **Step 4:** Ask Emelia, then create and push the tags: `git tag -s v1.0.0 -m v1.0.0 && git tag -s v1 -m v1 && git push origin v1.0.0 v1`.

## Phase 3: germ migration (Claude, **separate session launched from the germ-network/lexicon checkout**)

### Task 11: Migration PR

- [ ] **Step 1:** Branch `ci/lexicon-actions`.
  - Replace `ci.yml`, `comment.yml` and `cd.yml` with the spec's three caller files pinned to `@v1`. The validation caller keeps `name: Validate lexicon`, and the callers are `lexicon-validation.yml`, `lexicon-validation-comment.yml` and `lexicon-publish.yml`.
  - Delete `scripts/format-comment.js`.
- [ ] **Step 2:** Check that germ's `_lexicon` records resolve: `goat lex check-dns` locally prints `all lexicon schema NSIDs resolved successfully`. If they don't, set `fail-on-dns: false` and tell Emelia.
- [ ] **Step 3:** Commit and push, then open the PR. The body lists Emelia's Phase 4 steps.

## Phase 4: Cut-over and verification

### Task 12: Emelia: settings (same window as merging Task 11)

- [ ] Create `LEXICON_DID` (the value of today's `DID`) and `LEXICON_APP_PASSWORD`.
- [ ] Switch the ruleset's required checks from `changes`/`check` to `lexicon / detect-changes`/`lexicon / validate-changes`.
- [ ] Merge the migration PR (as admin, if the old checks show as pending).
- [ ] After that, delete `DID`, `USERNAME` and `APP_PASSWORD`.

### Task 13: Both: verify, and record results in the README

- [ ] A lexicon-change PR: ⏳ then results; the checks pass.
- [ ] A non-lexicon PR: `## ✅ No lexicon changes`; the checks pass.
- [ ] Merge a lexicon change: publish runs and `goat lex status` shows 🟢.
- [ ] A fork PR (from a personal fork): record whether `vars.LEXICON_DID` arrives, whether `pulls/{n}/files` works, and whether the comment waits for "Approve workflows to run".
- [ ] Record the `github.workflow_ref` finding from Task 10 Step 3. If it names the caller file, open a follow-up for the exact-match upgrade (spec, "Caller file relevance").
- [ ] Update the README's fork section with what was observed, then commit.
