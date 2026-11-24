# lexicon-actions

Reusable GitHub Actions workflows for repositories that publish
[AT Protocol lexicons](https://atproto.com/specs/lexicon), built on Bluesky's
[`goat`](https://github.com/bluesky-social/goat) CLI.

> **Status: pre-release.** There are no tagged releases yet, so `@v1` doesn't
> exist until the first tag is pushed. Until then, reference a full commit SHA.

## What it will do

By committing three short caller workflows, a lexicon repository gets:

- **Validation on pull requests:** `goat lex lint`, breaking-change detection against
  the published lexicons, DNS record checks (`_lexicon` TXT records for each NSID suffix), and the publish status of each changed lexicon.
- **A results comment on each pull request,** posted by a separate privileged workflow that never runs code from the pull request and treats its output as untrusted.
- **Checks that work as required status checks,** including on pull requests that don't touch lexicons.
- **Publishing on merge** with `goat lex publish`.
- **goat pinned to an exact version and verified** before it runs.

This is extracted from the CI tooling I setup for [`germ-network/lexicon`](https://github.com/germ-network/lexicon).

## What you get

<!-- screenshot: PR comment -->

Each pull request gets one comment. It shows a pending note when validation
starts, then is edited to the results: lint, breaking changes, DNS and lexicon
status. Pull requests that don't touch lexicons get a "no lexicon changes" note
and passing checks.

## Setup

### 1. Variable and secret

In the repository settings, under Secrets and variables, then Actions:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `LEXICON_DID` | The DID of the account that publishes your lexicons |
| Secret | `LEXICON_APP_PASSWORD` | An app password for that account |

The DID is a variable, not a hardcoded string in the workflow files, so the
publishing identity is repository configuration and the workflow files stay
identical across repositories. A DID isn't secret.

Create the app password in your account's settings. Never use the main account
password: an app password can be revoked on its own, and it can't change account
settings.

### 2. Caller files

Add these three files. The first file's `name:` must match the `workflows:` entry in the second.

`.github/workflows/lexicon-validation.yml`

```yaml
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

`.github/workflows/lexicon-validation-comment.yml`

```yaml
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

`.github/workflows/lexicon-publish.yml`

```yaml
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

Keep the caller job id `lexicon` in the validation file: it is part of the
required check names below. The comment workflow only runs from your default
branch, so it takes effect once the files are merged.

### 3. DNS records

For each NSID authority, add a TXT record that points at your DID:

```
_lexicon.<authority>  TXT  "did=<your DID>"
```

The authority is the NSID with its last segment dropped and the rest reversed.
For `com.example.thing.record`, it's `thing.example.com`, so the record name is
`_lexicon.thing.example.com`. See the
[lexicon spec](https://atproto.com/specs/lexicon#lexicon-publication-and-resolution)
for the details.

## Required checks

In your branch protection or ruleset, require both of these, with source
GitHub Actions:

- `lexicon / detect-changes`
- `lexicon / validate-changes`

You need both. `validate-changes` runs only after `detect-changes` succeeds. If
`detect-changes` fails, `validate-changes` is skipped, and a skipped check counts
as passing. Requiring only `validate-changes` would let a broken
`detect-changes` through.

The validation workflow has no path filter, so both checks always appear, even
on pull requests that don't touch lexicons. Nothing hangs pending.

## Inputs

### `validate.yml`

| Input | Type | Default | Description |
| --- | --- | --- | --- |
| `did` | string, required | | DID of the account that publishes the lexicons. Passed to `goat lex check-dns --example-did`. |
| `goat-version` | string | `v0.2.9` | goat release tag to install. |
| `lexicons-dir` | string | `lexicons/` | Directory containing the lexicon JSON files. |
| `fail-on-breaking-warnings` | boolean | `true` | Whether warn-level breaking changes fail validate-changes. |
| `fail-on-dns` | boolean | `true` | Whether DNS failures fail validate-changes. |

`lexicons-dir` must be a relative path of letters, digits, `.`, `_`, `-` and
`/`, with no `..` segment and no segment starting with `-`. Anything else fails
`detect-changes`.

### `comment.yml`

It reads everything it needs from the triggering event and the
`lexicon-check-logs` artifact. Both inputs below are optional.

| Input | Type | Default | Description |
| --- | --- | --- | --- |
| `app-id` | string | `""` | ID of a GitHub App to post the comment as. When empty, comments post as `github-actions[bot]`. |
| secret `app-private-key` | secret, optional | | Private key of that App. Required when `app-id` is set. |

To comment as your own App:

1. Create a GitHub App with the repository permission Pull requests: Read & write,
   and install it on the repository.
2. Copy the numeric **App ID** from the App's settings page and store it as a variable (`LEXICON_APP_ID`). Store a generated private key
   as a secret (`LEXICON_APP_KEY`).
3. Pass them from the comment caller:

   ```yaml
   jobs:
     comment:
       uses: thisismissem/lexicon-actions/.github/workflows/comment.yml@v1
       permissions:
         pull-requests: write
         actions: read
       with:
         app-id: ${{ vars.LEXICON_APP_ID }}
       secrets:
         app-private-key: ${{ secrets.LEXICON_APP_KEY }}
   ```

Comments then appear as `<app-name>[bot]`. The workflow mints a short-lived token
with only `pull-requests: write`, scoped to the current repository.

### `publish.yml`

| Input | Type | Default | Description |
| --- | --- | --- | --- |
| `did` | string, required | | DID of the account that publishes the lexicons. Used as the login identity. goat logs in in memory for the publish step only, so no session file is written. |
| `goat-version` | string | `v0.2.9` | goat release tag to install. |
| `lexicons-dir` | string | `lexicons/` | Directory containing the lexicon JSON files. |
| secret `app-password` | secret, required | | App password for the publishing account. |

### `goat-version`

`goat-version` must be a version listed in
[`goat-checksums.txt`](.github/actions/setup-goat/goat-checksums.txt), so that file
works as an allowlist: an unlisted version fails the job and the error names the
supported ones. The `goat-version` input of the workflows is passed straight
through, so the same rule applies.

## What blocks

`validate-changes` fails, and so blocks a required check, on:

- lint errors,
- breaking-change errors,
- breaking-change warnings, unless `fail-on-breaking-warnings: false`,
- DNS failures, unless `fail-on-dns: false`,
- any check that fails to run. This always blocks.

`goat lex status` is informational and never blocks.

`goat lex check-dns` exits 0 even when records are missing, so this workflow
decides from its output, not its exit code. The same applies to warn-level
breaking changes, which are decided from the JSON output. The comment shows
sections that don't block as "not blocking".

## Security model

- **Two workflows.** Validation runs on `pull_request` with a read-only token and
  no secrets, so it's safe for untrusted PR code to influence. Commenting needs
  write access, so it runs separately from `workflow_run`, in the context of your
  default branch. It never checks out or runs code from the pull request.
- **The artifact is untrusted.** The comment workflow finds the PR from trusted
  event data, not from the artifact. It validates the artifact's `meta.json` and
  renders its contents as data. The artifact can change the wording of the
  comment, never whether a check passes.
- **`pull_request` runs the PR's own caller file.** A pull request can edit
  `.github/workflows/lexicon-validation.yml` and that edited copy runs. It can't
  reach secrets or write access that way, but it can make the check pass.
  Add a `CODEOWNERS` entry for `.github/` and turn on "Require review from Code
  Owners" in your branch protection.
- **goat is verified.** Each supported goat release has its SHA-256 pinned in
  `.github/actions/setup-goat/goat-checksums.txt`. The internal setup-goat action downloads the tarball for exactly the requested
  version, checks it against the pinned hash, and fails on any mismatch. There is
  no unverified fallback.
- **Our own scripts match your pin.** The workflows fetch their scripts at the
  commit you referenced (`@v1` or a SHA), not from your repository.

## Fork PRs

**To be confirmed.** Not yet tested against a real fork PR.

Repository variables likely aren't available to pull requests from forks, so
`vars.LEXICON_DID` would be empty and `validate-changes` fails with a "Missing
did" error. A maintainer may also need to approve first-time contributors'
workflow runs before anything starts. This section will be updated once it's
checked.

## Known limitations

- The comment workflow updates the most recent PR comment made by its posting identity
  (`gh pr comment --edit-last`). With the default token that identity is
  `github-actions[bot]`, shared with every other workflow that comments using
  `GITHUB_TOKEN`. If other workflows in your repository also comment on pull requests
  that way, they can overwrite each other's comments. To avoid that, set up a GitHub App
  and pass `app-id` and `app-private-key` so lexicon-actions comments under its own
  identity; see [the App setup steps](#commentyml).
- Linux runners only (x86_64 and arm64).

## Maintainers: bumping goat

1. Run `scripts/pin-goat.sh vX.Y.Z` and append its output to
   `.github/actions/setup-goat/goat-checksums.txt`:

   ```sh
   scripts/pin-goat.sh vX.Y.Z >> .github/actions/setup-goat/goat-checksums.txt
   ```

   The script downloads the release's checksums file and signature, and verifies
   the signature against bnewbold's signing subkey
   (`0C8E4A0DA8E9990872952B3B084425E080357D53`; see [`keys/README.md`](keys/README.md)).
   It prints lines only on success and never edits files itself.
2. Update the default `goat-version` in `.github/actions/setup-goat/action.yml`,
   `.github/workflows/validate.yml` and `.github/workflows/publish.yml`.
3. Re-check the DNS and breaking-change parsers against the new goat output.

Bumping the default `goat-version` is a minor release.

## Versioning

Semver tags (`v1.0.0`) plus a moving major tag (`v1`). Pin `@v1`, or a full
commit SHA if you prefer.

These are breaking changes and bump the major version:

- renamed or removed inputs,
- changed required check names,
- a different artifact contract,
- a changed default blocking behaviour.

Bumping the default `goat-version` is a minor release, with a changelog entry.

## Design

See the [design spec](docs/superpowers/specs/2026-11-24-lexicon-actions-design.md).

## License

[MIT](LICENSE)
