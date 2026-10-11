#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
export SMOKE_PREFIX="tdarr-review-smoke-$$-$(date +%s)-${RANDOM}-${RANDOM}"
cleanup() {
  # Exact names AND ownership labels; never enumerate or remove unrelated objects.
  for suffix in review integration recovery; do
    name="${SMOKE_PREFIX}-${suffix}"
    owner="$(docker inspect --format '{{index .Config.Labels "org.tdarr-review.smoke"}}' "$name" 2>/dev/null || true)"
    if [[ "$owner" == "$SMOKE_PREFIX" ]]; then docker rm -f "$name" >/dev/null 2>&1 || true; fi
  done
  for suffix in review-data recovery-data; do
    name="${SMOKE_PREFIX}-${suffix}"
    owner="$(docker volume inspect --format '{{index .Labels "org.tdarr-review.smoke"}}' "$name" 2>/dev/null || true)"
    if [[ "$owner" == "$SMOKE_PREFIX" ]]; then docker volume rm "$name" >/dev/null 2>&1 || true; fi
  done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
node tools/docker-smoke.mjs
