#!/usr/bin/env bash

branch=""
while true; do
  IFS= read -r -s -n 1 key || exit 0
  case "$key" in
    $'\e')
      exit 0
      ;;
    "")
      break
      ;;
    $'\177'|$'\b')
      if [[ -n "$branch" ]]; then
        branch="${branch%?}"
        printf '\b \b'
      fi
      ;;
    *)
      branch+="$key"
      printf '%s' "$key"
      ;;
  esac
done
printf '\n'
[[ -n "$branch" ]] || exit 0

B="${HERDR_BIN_PATH:-herdr}"
exec "$B" worktree create \
  --branch "$branch" \
  --base main \
  --focus
