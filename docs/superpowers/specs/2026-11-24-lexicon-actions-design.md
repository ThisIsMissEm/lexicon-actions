# lexicon-actions: reusable CI for atproto lexicon repositories

Status: reviewed 2026-11-24. Builder items are decided. Open: goat signing-key
provenance, and the upstream setup-goat request.
Repo: `thisismissem/lexicon-actions` (new, MIT)
First adopter: `germ-network/lexicon`

## Intent

`germ-network/lexicon` now has a working, security-reviewed CI pipeline for atproto
lexicons:

- validation with goat (lint, breaking changes, DNS),
- a ⏳-then-results PR comment, posted by a privileged workflow that treats the PR's
  output as untrusted,
- a required-status-check-friendly job layout,
- publishing to the network on merge.

That repo was deliberately MIT-licensed so this could become reusable. The goal is to
let **anyone publishing atproto lexicons on GitHub** adopt the same pipeline by
committing three short workflow files, without copying, maintaining or re-deriving the
security-sensitive parts.

The repo will stay under Emelia's personal account (`thisismissem`) for the
foreseeable future, so adopters' `uses: thisismissem/...` references are stable.

## Goals

1. An adopter gets validation, PR comments and publishing by committing three thin
   caller workflows, plus one repo variable and one secret.
2. Everything security-critical lives in `lexicon-actions`, versioned, and can't be
   accidentally weakened by adopters:
   - never running PR code with a write token,
   - looking up the PR from trusted event data,
   - treating the artifact as untrusted data,
   - the failure fallback comment.
3. Fixes and improvements reach adopters through tags, without them re-copying files.
4. `germ-network/lexicon` migrates onto it, with no behaviour change visible in PRs
   other than DNS failures now blocking (see Migration).
5. The checks work as required status checks, documented with their exact check names.

## Non-goals (v1)

- Configurable comment wording or layout.
- Exposing the internal steps as composite actions for custom pipelines. Possible later;
  see Approaches.
- Non-GitHub CI systems.
- Lexicon code generation, docs generation, or anything beyond lint, breaking, DNS,
  status and publish.
- A GitHub Marketplace listing of the workflows themselves. Marketplace only lists
  actions; see "Left to the builder".

## Anti-goals (a failure even if it technically works)

- Any path where code from a PR (including a fork PR) runs with a write token or with
  `secrets.app-password` available.
- Adopters needing to copy or edit the comment or artifact-validation logic to make it
  work.
- An unpinned goat version, so that a goat release silently changes adopters' CI.
- A setup where the required check can hang forever on PRs that don't touch lexicons.

## Constraints (GitHub platform facts this design relies on)

- An action or reusable workflow can't add triggers. `on:` lives in the adopter's
  caller file.
- `workflow_run` workflows only run from the adopter's **default branch**, and refer to
  the checks workflow by its `name:`.
- Reusable workflows run in the caller's context: the caller's repo, event,
  `GITHUB_TOKEN` and permissions (capped by the caller's `permissions:`).
- Secrets aren't visible to a reusable workflow unless the caller passes them
  (`secrets:` or `secrets: inherit`).
- Required status checks from a reusable workflow are named
  `<caller job id> / <reusable job id>`.
- A job skipped by `if:` counts as passing for a required check. A workflow that never
  starts leaves the check pending forever.
- `goat lex status` has no JSON output. Its text format is parsed strictly.
  `lint` and `breaking` have `--json`.

## Approaches considered

| | A. Reusable workflows + `setup-goat` action | B. Composite actions only | C. Template / copy-in |
|---|---|---|---|
| Adopter writes | 3 thin files (triggers, permissions, `uses:`) | Full workflows: jobs, gating, artifact upload, permissions | Copies our files once |
| Security-critical structure lives | In lexicon-actions, versioned | Partly in adopters' files | In adopters' files |
| Fixes reach adopters | Via tags | Via tags, for step logic only | Never |

**Chosen: A.** The hard parts are workflow and job structure (the two-workflow split,
`detect-changes` → `validate-changes` gating, per-job permissions and concurrency), and only a reusable
workflow can own those. B pushes that structure onto every adopter. C means a security
fix never reaches anyone. A can later call internal composite actions and expose them,
if custom pipelines turn out to be needed.

## Design

### Repository layout (`thisismissem/lexicon-actions`)

```
.github/workflows/
  validate.yml        # on: workflow_call
  comment.yml         # on: workflow_call
  publish.yml         # on: workflow_call
.github/actions/setup-goat/
  action.yml          # internal composite action: pinned + verified goat (not a public interface)
  goat-checksums.txt  # pinned per-version SHA-256s, read via $GITHUB_ACTION_PATH
scripts/format-comment.js
scripts/upsert-comment.sh
README.md             # adopter guide (below)
LICENSE               # MIT
```

Ported from `germ-network/lexicon` at `027cf5a`:
- `ci.yml` becomes `validate.yml`,
- `comment.yml` stays `comment.yml`,
- `cd.yml` becomes `publish.yml`,
- `scripts/format-comment.js` moves as is.

### Adopter's caller files (in their repo)

```yaml
# .github/workflows/lexicon-validation.yml
name: Validate lexicon          # comment caller references this name
on:
  pull_request:
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
permissions:
  contents: read
  pull-requests: read
jobs:
  lexicon:                      # check names: "lexicon / detect-changes", "lexicon / validate-changes"
    uses: thisismissem/lexicon-actions/.github/workflows/validate.yml@v1
    with:
      did: ${{ vars.LEXICON_DID }}
```

```yaml
# .github/workflows/lexicon-validation-comment.yml
on:
  workflow_run:
    workflows: ["Validate lexicon"]
    types: [requested, completed]
permissions: {}
jobs:
  comment:
    uses: thisismissem/lexicon-actions/.github/workflows/comment.yml@v1
    permissions:
      pull-requests: write
      actions: read
```

```yaml
# .github/workflows/lexicon-publish.yml
on:
  push:
    branches: [main]
    paths: ["lexicons/**"]
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: false   # never cancel a publish midway
permissions:
  contents: read
jobs:
  publish:
    uses: thisismissem/lexicon-actions/.github/workflows/publish.yml@v1
    with:
      did: ${{ vars.LEXICON_DID }}
    secrets:
      app-password: ${{ secrets.LEXICON_APP_PASSWORD }}
```

The README ships these three files verbatim, as the documented setup.

### Inputs

| Workflow | Input | Type | Default | Purpose |
|---|---|---|---|---|
| validate | `did` | string | required | DID of the account that publishes the lexicons. Passed to `goat lex check-dns --example-did` |
| | `goat-version` | string | pinned release (currently `v0.2.9`) | goat release to install |
| | `lexicons-dir` | string | `lexicons/` | Where lexicon JSON lives. Also drives the `detect-changes` path match |
| | `fail-on-breaking-warnings` | boolean | `true` | Whether warn-level breaking changes fail `validate-changes` |
| | `fail-on-dns` | boolean | `true` | Whether DNS failures fail `validate-changes` |
| comment | (none) | | | Reads everything it needs from the event and the artifact |
| publish | `did` | string | required | Login identity (`GOAT_USERNAME`; goat accepts a handle or DID) |
| | `goat-version` | string | as above | |
| | `lexicons-dir` | string | `lexicons/` | |
| | secret `app-password` | secret | required | App password for that account |

Using a single `did` for both the DNS hint and the publish login means adopters set
their publishing identity once, the DNS check and publishing can't disagree, and a
changeable handle isn't used.

Currently blocking: lint errors, breaking errors, breaking warnings (unless
`fail-on-breaking-warnings: false`), and DNS failures (unless `fail-on-dns: false`).
The lexicon-status step never blocks.

**The comment reflects the blocking settings (decided).** `validate` records them in
`meta.json`:

```json
{"pr": 12, "finished": true, "blocking": {"breaking-warnings": true, "dns": true}}
```

`format-comment.js` downgrades sections that don't block. For example, with
`fail-on-dns: false`, DNS failures render as `## 🟡 DNS Issues (not blocking)` with a
line explaining that the repository doesn't block merging on DNS checks. Warn-level
breaking changes are treated the same way when `fail-on-breaking-warnings: false`.

These values come from the untrusted artifact. That's acceptable, because they only
change the wording of the comment. The required check, computed in the validate run,
remains the source of truth for blocking. A missing or non-boolean `blocking` value
defaults to "blocking" (`true`), the stricter wording. This is part of the v1 artifact
contract, so it must be in place before `v1.0.0` is tagged.

### `setup-goat`: pinned and verified (decided)

Today both workflows download goat's *latest* release unverified. `setup-goat` will:

1. Download `goat_Linux_<arch>.tar.gz`, `goat_<ver>_checksums.txt` and
   `goat_<ver>_checksums.txt.sig` for the exact `goat-version` tag (default `v0.2.9`).
2. Verify the `.sig` against a goat release public key committed in lexicon-actions.
   goat's `.goreleaser.yaml` uses goreleaser's default `signs:` (`artifacts: checksum`,
   no `cmd`), which is a GPG detached signature.
3. Check the tarball's SHA-256 against `checksums.txt` (`sha256sum --check
   --ignore-missing`).
4. Fail the job on any mismatch. There's no fallback to an unverified install.

Open: **key provenance.** Find where Bluesky publishes the goat release-signing key (a
repo file, a keyserver or keys.openpgp.org, or a maintainer's GitHub GPG keys), and
record its fingerprint in the README. If no authoritative source exists, fall back to
pinning the per-version tarball SHA-256 inside `setup-goat` (checked at bump time), and
raise the missing key with goat upstream.

### Changes to `format-comment.js` (decided)

- **Lexicon directory is passed in.** `nsidFromPath` currently hardcodes `lexicons/`.
  `validate` records `lexicons-dir` in `meta.json`, and `comment` passes it to the
  script. Since `meta.json` comes from the untrusted artifact, the value is only used to
  strip a path prefix, never as a filesystem path. If it's missing or invalid, it falls
  back to `lexicons/`.
- **DNS output goes in a code fence.** `<pre>${dns}</pre>` becomes a ```` ``` ```` fence,
  with any backtick runs stripped from the text first so it can't close the fence. goat
  output is fairly trusted (it's maintained by Bluesky), but its text includes domains
  derived from the PR's NSIDs, so it isn't rendered as raw HTML or markdown.

### Behaviour

The behaviour stays as it is in `germ-network/lexicon` today:

- **validate**:
  - The `detect-changes` job lists PR files via the API. It decides whether lexicons, or the
    adopter's validation caller file, changed. When nothing relevant changed, it
    uploads a `lexicon-check-logs` artifact with `{pr, finished: true, skipped: true}`.
  - The `validate-changes` job (`needs: detect-changes`) runs lint, breaking (JSON), DNS, and the
    informational `goat lex status`, scoped to the changed files. It writes
    `meta.json` with `{pr, finished}` and uploads `lexicon-check-logs`. All check output is
    written under `$RUNNER_TEMP/check-logs`, never in the workspace.
  - **DNS detection (decided: blocks by default).** `goat lex check-dns` exits 0 even
    when records are missing (`lex_check_dns.go:60-91` in goat v0.2.9). So today in
    germ, DNS never blocks; only the comment notices, by matching "successfully". The
    `validate-changes` job must decide pass or fail from the output, not the exit code. It uses the
    same rule the comment uses, kept in one place, covered by fixture output, and
    re-checked whenever the default `goat-version` is bumped. A non-zero exit still
    counts as a failure. This is a deliberate behaviour change for germ; see Migration.
  - **Breaking warnings.** `goat lex breaking` exits non-zero on *any* issue, warnings
    included. So `fail-on-breaking-warnings: false` is decided from `lint-level` in
    `breaking.json`, not from the exit code. The same goes for lint.
  - "Report on failures" fails the job according to the blocking inputs. It should emit
    one `::error title=...::` annotation per failing check, an improvement over today's
    bare `exit 1`.
- **comment**:
  - The `gather` job finds the open PR whose head SHA matches, from trusted event data.
    It has read-only permissions.
  - The `in-progress` job posts ⏳ on `requested`.
  - The `publish` job, on `completed`:
    - Downloads the artifact. If it's missing, the run is treated as incomplete.
    - Validates `meta.json` with `jq`: `pr` must equal gather's number, and `finished`
      must be `true`.
    - Formats the comment with `format-comment.js` and posts it.
    - Replaces the ⏳ with a failure comment if any step fails.
    - Comment identity is a hidden marker, `<!-- lexicon-actions:validation -->`, ending
      every body. `scripts/upsert-comment.sh` updates the last comment that is Bot-authored
      (`.user.type == "Bot"`, so a user can't plant the marker) and contains it, or
      creates one. The failure fallback keeps an inline copy so it works even if the
      checkout failed. Optional `client-id` input and `app-private-key` secret: the two commenting
      jobs mint a GitHub App token (`actions/create-github-app-token`, pull requests:
      write only) and comment as `<app-name>[bot]`; otherwise they use `github.token`.
  - Cancelled runs are skipped. Concurrency is per job, keyed on head repo plus branch.
- **publish**: installs goat and runs `goat lex publish -u` with `GOAT_USERNAME` (`did`) and
  `GOAT_PASSWORD` (`app-password`) in that step's environment. goat logs in in memory, so there
  is no session file, check-auth step or logout step.

### Getting our own scripts at the right version (key technical risk)

Today `comment.yml` checks out the adopter's default branch to get a trusted
`format-comment.js`. In the reusable version, the script must come from
**lexicon-actions at the same ref the adopter pinned** (e.g. `@v1`), not from the
adopter's repo. Otherwise adopters would need a copy of the script, and versions would
drift.

Inside a reusable workflow, the default `actions/checkout` and `uses: ./...` refer to
the *caller's* repo. The builder must verify a supported way to resolve the called
workflow's own repo and ref, and use it to check out lexicon-actions at that ref.
Candidates to check: the `job.workflow_*` contexts, or the OIDC `job_workflow_ref`
claim. If no reliable mechanism exists, the fallback is to package `format-comment.js`
inside a composite action and reference it as
`thisismissem/lexicon-actions/format-comment@v1`. That needs a release process that keeps
the action ref in step with the workflow tag. Pick one and document why.

**Decided: `job.workflow_repository` + `job.workflow_sha`.** These contexts (shipped
2026-09-03, documented in the contexts reference) name the workflow file that defines
the current job. In a reusable workflow, that's the called file. Every job that needs
our files does:

```yaml
- uses: actions/checkout@v6
  with:
    repository: ${{ job.workflow_repository }}
    ref: ${{ job.workflow_sha }}
    path: .lexicon-actions
    persist-credentials: false
```

and then runs `.lexicon-actions/scripts/format-comment.js` or
`uses: ./.lexicon-actions/.github/actions/setup-goat` (the internal `setup-goat` action). Why:
- It's the exact commit the adopter resolved, whether they pinned `@v1` or a SHA, so
  the scripts can't drift from the workflow.
- It needs no token, because lexicon-actions is public.
- It needs no `@v1` refs inside lexicon-actions, so releases don't have to keep them in
  step. (That release step under "Versioning" is dropped.)
- Rejected: the `$/` self-repository syntax (changelog 2026-07-30). It's undocumented
  whether `$/` means the caller or the callee in a cross-repo `workflow_call`.
- Rejected: OIDC `job_workflow_sha`. It needs `id-token: write` in adopters' callers for
  no benefit.
- Not on GitHub Enterprise Server. Out of scope for v1.

### Versioning and releases

- Semver tags (`v1.0.0`) plus a moving major tag (`v1`). Adopters pin `@v1`, or a full
  SHA if they prefer.
- Breaking changes for adopters bump the major version. That covers renamed inputs,
  changed required-check names, a different artifact contract, and a changed default
  blocking behaviour.
- Bumping the pinned default `goat-version` counts as a minor release, with a changelog
  entry.
- No release step keeps internal refs in sync. Our own files are fetched at
  `job.workflow_sha` (see above).

### README (adopter guide)

1. What you get, with a screenshot of the comment.
2. Setup:
   - set the `LEXICON_DID` variable and the `LEXICON_APP_PASSWORD` secret,
   - add the three files,
   - add the `_lexicon` DNS records.
3. Required checks: add `lexicon / detect-changes` and `lexicon / validate-changes` with
   source GitHub Actions. Explain why both are needed: a failed `detect-changes` makes
   `validate-changes` skip, and a
   skipped check passes.
4. Inputs table.
5. The security model, briefly:
   - why there are two workflows,
   - that `pull_request` runs the PR's own caller file. Recommend CODEOWNERS on
     `.github/` with "Require review from Code Owners".
6. Fork PRs: what works and what doesn't (see "Left to the builder").

### Who does what, and in what order

Emelia does every step that needs an account or admin rights. Claude does code, signed
commits, pushes and tags, each with Emelia's OK. Claude never runs login or other auth
commands. In order:

1. **Emelia:** create the public `thisismissem/lexicon-actions` repo (MIT).
2. **Claude:** build the reusable workflows, `setup-goat`, `format-comment.js` and the
   README. Push, then tag `v1.0.0` and `v1`. The tag must exist before any caller can
   use `@v1`.
3. **Claude:** open germ's migration PR, with the caller files pointing at `@v1`.
4. **Emelia, in the same window as merging step 3:**
   - rename the variables and secrets,
   - switch the ruleset's required checks from `changes` and `check` to
     `lexicon / detect-changes` and `lexicon / validate-changes`.

   The migration PR itself reports the new names. Under the old ruleset it will show
   the old checks as pending, so merge it as an admin or switch the ruleset first.
5. **Both:** verify with throwaway PRs: a lexicon change, a non-lexicon change, and a
   publish on merge.

The plan should be built around these hand-off points, not as one uninterrupted
sequence.

### Migration of `germ-network/lexicon`

- Replace `ci.yml`, `comment.yml` and `cd.yml` with the three caller files.
- Delete `scripts/format-comment.js`.
- Rename `vars.DID` to `vars.LEXICON_DID`, and use it for publish in place of
  `vars.USERNAME`. Rename `secrets.APP_PASSWORD` to `secrets.LEXICON_APP_PASSWORD`, or
  map it in the caller file.
- Update the ruleset's required checks from `changes` and `check` to
  `lexicon / detect-changes` and `lexicon / validate-changes`. Do this in the same change window, or
  open PRs will block.
- **One deliberate behaviour change:** missing DNS records now fail `lexicon / validate-changes`
  (today they only show in the comment). Check germ's `_lexicon` records resolve before
  migrating, or set `fail-on-dns: false` in the caller for the transition.
- Verify with a throwaway PR, as was done with #19: the ⏳ comment, then results; a
  non-lexicon PR gets "No lexicon changes"; a push to `main` publishes.

## Left to the builder

- The mechanism for fetching lexicon-actions's own scripts at the matching ref (above).
- ~~Caller file relevance in `detect-changes`.~~ **Decided, staged:**
  - Baseline: any change under `.github/workflows/` counts as relevant. That doesn't
    depend on undocumented behaviour, and over-triggering costs only one goat run.
  - Upgrade: if the self-test confirms that `github.workflow_ref` inside the called
    workflow names the *caller* file, `detect-changes` matches that exact path. When parsing
    fails it falls back to the baseline.
  - This isn't an adopter-visible contract change, so it can ship in a minor release.
- ~~Behaviour of `vars.*` for fork PRs.~~ **Decided:** the documented caller files keep
  `did: ${{ vars.LEXICON_DID }}`. Setting identity through repo config, not hardcoding
  it in workflow files, is the hygiene the README should model. `validate` fails with a
  clear `::error::` when `did` is empty (the likely fork case; community reports say
  `vars` behave like secrets for forks, but the docs don't say). Still to verify
  empirically: whether `vars` and the `pulls/{n}/files` call work on a fork PR, and
  whether `workflow_run` `requested` waits for "Approve workflows to run". The README
  documents whatever turns out to be true.
- ~~Root `action.yml` for Marketplace.~~ **Decided 2026-11-24: internal action, not
  listed.** `setup-goat` lives at `.github/actions/setup-goat/` and is not a supported
  public interface (no `branding:`, no Marketplace listing). The reusable workflows use
  it through the `job.workflow_sha` checkout
  (`uses: ./.lexicon-actions/.github/actions/setup-goat`); this repo's own tests use
  `./.github/actions/setup-goat`. Existing alternatives checked on 2026-11-24, and none
  is usable:
  - `bluesky-social/github-actions` has no goat action.
  - `studio-b12/setup-goat` installs an unrelated tool, `studio-b12/goat`.
  - `mkizka/lex-publish` defaults to `latest`, doesn't verify, and interpolates its
    input into `run:`.
  - `birbhouse-games/lexicon-tools` fetches `latest` unverified.

  **Pending upstream (2026-11-24):** Emelia has asked bnewbold whether Bluesky would
  host an official setup-goat action. If they do, and it pins the version and verifies
  the release, the reusable workflows use it, pinned by SHA, and lexicon-actions drops
  its internal action and offers our implementation upstream. That also settles key
  provenance.
- ~~Testing strategy.~~ **Decided: self-test in this repo.**
  - lexicon-actions has its own three caller files, which call its workflows through
    `./.github/workflows/...`. Fixture lexicons live in `test/lexicons/` (passed as
    `lexicons-dir`). Unit tests cover `format-comment.js` and the DNS and breaking
    parsers, using captured goat output.
  - Known gap: same-repo calls make `job.workflow_repository` equal the caller's repo,
    and `workflow_run` only fires from the default branch. The cross-repo behaviours
    (callee checkout, `github.workflow_ref`, `workflow_run` name matching, required
    check names, fork `vars`) are first verified in germ's migration, at step 5 of
    "Who does what". That step must explicitly check each of them, and record the
    results in the README.
- ~~Job ID naming.~~ **Decided:** the caller job is `lexicon`, and the reusable jobs are
  `detect-changes` and `validate-changes`. So the required checks are
  `lexicon / detect-changes` and `lexicon / validate-changes`. Renaming them later is a
  major version.
