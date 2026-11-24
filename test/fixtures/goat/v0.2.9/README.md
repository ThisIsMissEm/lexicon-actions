# goat v0.2.9 fixtures

| File | Provenance |
| --- | --- |
| `check-dns-ok.txt` | Verbatim from the `fmt.Println` success line in goat v0.2.9 `lex_check_dns.go` (~line 63). |
| `check-dns-missing.txt` | Verbatim from the `fmt.Print*` calls in goat v0.2.9 `lex_check_dns.go` (~lines 67-88), with one missing group `com.example.foo.` and `--example-did did:plc:example` (so the "substituting your account DID" note is absent). |
| `lint.json` | Captured with locally installed goat 0.2.8: `goat lex lint --json <dir> 2>/dev/null \| jq --slurp` over a scratch lexicon missing a primary description. `file-path` rewritten to `lexicons/com/example/bad.json` for stability. |
| `breaking.json` | Hand-written (`goat lex breaking` compares against the live network). Fields `nsid`, `lint-level`, `message` as read by germ-network/lexicon `format-comment.js`; one `error`, one `warn`. |
| `status.txt` | Hand-written in goat's `lex status` format (` <icon> <nsid>`). |
