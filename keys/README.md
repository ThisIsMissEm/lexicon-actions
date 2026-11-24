# keys

`goat-release.asc` is the public key used by `scripts/pin-goat.sh` to verify goat release checksums. The action never reads it at runtime.

| Item | Value |
| --- | --- |
| Owner | bryan newbold (bnewbold@robocracy.org) |
| Primary key | `3F468108EE58663CB95AE9DC0C9337BCEC3932B9` |
| Signing subkey [S] | `0C8E4A0DA8E9990872952B3B084425E080357D53` |
| Expires | 2032-02-29 |

`pin-goat.sh` accepts only signatures made by the signing subkey fingerprint above.

## Provenance

The key ID `0C9337BCEC3932B9` is registered on GitHub user `bnewbold`. GitHub's `.gpg` export for that user is broken, so the full key was fetched from the Ubuntu keyserver:

    https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x3F468108EE58663CB95AE9DC0C9337BCEC3932B9

It was imported into a temporary keyring and exported with `gpg --export --armor`. Check it with:

    gpg --show-keys --with-subkey-fingerprints keys/goat-release.asc
