#!/usr/bin/env bash
# Create or update the validation comment on a pull request.
#
# Usage: scripts/upsert-comment.sh <body-file>
# Env:   GH_TOKEN, REPO (owner/name), PULL_REQUEST (number), MARKER (hidden
#        marker line identifying our comment).
#
# The comment to update is the LAST comment that is both authored by a Bot
# and contains MARKER. The `.user.type == "Bot"` check is a security
# boundary: a PR author could post a comment containing the marker, and a
# write token is able to edit other users' comments. Users can't be Bots, so
# requiring it means we only ever edit comments posted by an app or
# github-actions[bot], never one a user wrote.
#
# The body is sent from a file (`-F body=@file`), never interpolated into argv.
set -euo pipefail

[ "$#" -eq 1 ] || {
  echo "usage: upsert-comment.sh <body-file>" >&2
  exit 2
}
body_file="$1"
[ -f "$body_file" ] || {
  echo "upsert-comment: body file not found: $body_file" >&2
  exit 2
}

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${REPO:?REPO is required}"
: "${PULL_REQUEST:?PULL_REQUEST is required}"
: "${MARKER:?MARKER is required}"

if [[ ! "$PULL_REQUEST" =~ ^[0-9]+$ ]]; then
  echo "upsert-comment: PULL_REQUEST must be a number" >&2
  exit 2
fi

# Ensure the body ends with the marker line, without mutating the caller's file.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
body="$work/body.md"
cp "$body_file" "$body"
if ! grep -qxF -- "$MARKER" "$body"; then
  printf '\n%s\n' "$MARKER" >> "$body"
fi

# --paginate prints one JSON array per page; `jq -s add` joins them.
comment_id="$(gh api --paginate "repos/$REPO/issues/$PULL_REQUEST/comments" \
  | jq -rs --arg marker "$MARKER" \
    'add // [] | map(select(.user.type == "Bot" and ((.body // "") | contains($marker)))) | last | .id // empty')"

if [ -n "$comment_id" ]; then
  if [[ ! "$comment_id" =~ ^[0-9]+$ ]]; then
    echo "upsert-comment: unexpected comment id from the API" >&2
    exit 1
  fi
  gh api --method PATCH "repos/$REPO/issues/comments/$comment_id" -F "body=@$body" >/dev/null
  echo "Updated comment $comment_id"
else
  gh api --method POST "repos/$REPO/issues/$PULL_REQUEST/comments" -F "body=@$body" >/dev/null
  echo "Created comment"
fi
