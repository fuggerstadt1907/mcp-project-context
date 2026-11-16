#!/usr/bin/env bash
# Creates one GitHub issue per ticket file in docs/tickets (except README.md).
# Requires the GitHub CLI (gh) and an authenticated session. Run from the repo root.
set -euo pipefail

for file in docs/tickets/[0-9][0-9]-*.md; do
  title=$(head -n 1 "$file" | sed 's/^# //')
  labels=$(grep -m1 '^Labels:' "$file" | sed 's/^Labels: *//' || true)
  body=$(tail -n +2 "$file")

  args=(--title "$title" --body "$body")
  if [[ -n "$labels" ]]; then
    IFS=',' read -ra parts <<< "$labels"
    for label in "${parts[@]}"; do
      label=$(echo "$label" | xargs)
      gh label create "$label" --force >/dev/null 2>&1 || true
      args+=(--label "$label")
    done
  fi

  gh issue create "${args[@]}"
done
