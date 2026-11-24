# lexicon-actions

Reusable GitHub Actions workflows for repositories that publish
[AT Protocol lexicons](https://atproto.com/specs/lexicon), built on Bluesky's
[`goat`](https://github.com/bluesky-social/goat) CLI.

> **Status: in design. Not ready to use yet.** There are no tagged releases, so
> `@v1` doesn't exist yet.

## What it will do

By committing three short caller workflows, a lexicon repository gets:

- **Validation on pull requests:** `goat lex lint`, breaking-change detection against
  the published lexicons, DNS record checks (`_lexicon` TXT records for each NSID suffix), and the publish status of each changed lexicon.
- **A results comment on each pull request,** posted by a separate privileged workflow that never runs code from the pull request and treats its output as untrusted.
- **Checks that work as required status checks,** including on pull requests that don't touch lexicons.
- **Publishing on merge** with `goat lex publish`.
- **goat pinned to an exact version and verified** before it runs.

This is extracted from the CI tooling I setup for [`germ-network/lexicon`](https://github.com/germ-network/lexicon).

## Design

See the [design spec](docs/superpowers/specs/2026-11-24-lexicon-actions-design.md).

## License

[MIT](LICENSE)
