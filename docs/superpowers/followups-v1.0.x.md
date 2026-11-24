# Follow-ups after v1.0.0

These are open items from the v1.0.0 build reviews (2026-11-24). Every one was triaged
as safe to ship. None changes the adopter contract.

## Hardening (patch releases)

- validate.yml: a rename *within* the lexicons dir drops the old NSID from the "Removed"
  list in the comment (informational only).
- validate.yml: set `LC_ALL=C` for the bash character-class check. The `lexicon-files`
  output could hit the 1 MB output limit on huge PRs (fails closed).
- comment.yml: attacker-chosen text reaches stdout (`ls -R`, `cat comment.txt`) and is
  parsed for `::` workflow commands. The impact is negligible today. Wrap those steps in
  `::stop-commands::` or drop `ls -R`.
- comment.yml: the cross-repo checkout runs with no `contents` permission. That's fine
  while lexicon-actions is public; confirm during the first adopter rollout.
- format-comment.js: bare URLs autolink and `:emoji:` shortcodes render in PR-derived
  text.
- action.yml tests:
  - the negative tests pass on any failure (assert `goat-path` is empty);
  - the `grep -F 0.2.9` version check would match `0.2.90`;
  - duplicate table lines resolve as "last wins";
  - `goat-bin` isn't cleaned before extraction (self-hosted runners).
- pin-goat:
  - the CI `diff <(script) <(grep)` passes if both sides are empty (capture the output first);
  - the grep dots are unescaped;
  - gpg verify stderr is discarded;
  - a gpg-agent can linger;
  - the wrong-signer path isn't exercised.
- Tests:
  - temp dirs in `test/results.test.js` aren't cleaned up;
  - there are no CLI tests for report-failures' exit-2 paths or for garbage `BLOCK_*` values;
  - `describe()` gives an empty message when an issue has neither `message` nor `lint-description`;
  - null elements in lint.json/breaking.json throw (fails closed).
- README:
  - say `did=` takes the full `did:plc:…`;
  - the fixture README cites approximate goat line numbers.
- All GitHub-owned actions are pinned by major tag, not SHA.
