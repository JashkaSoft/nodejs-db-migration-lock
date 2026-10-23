#!/usr/bin/env bash
set -euo pipefail

SUITE="${1:-typeorm}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUITE_DIR="${SCRIPT_DIR}/${SUITE}"

if [ ! -f "${SUITE_DIR}/docker-compose.yml" ]; then
  echo "Unknown mysql e2e suite: ${SUITE}" >&2
  exit 1
fi

cd "$SUITE_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "Starting MySQL ${SUITE} e2e tests"

if command -v podman-compose >/dev/null 2>&1 && podman info >/dev/null 2>&1; then
  COMPOSE=(podman-compose)
  ENGINE=podman
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  COMPOSE=(docker compose)
  ENGINE=docker
else
  echo -e "${RED}Need podman-compose or docker compose.${NC}" >&2
  exit 1
fi

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-migration-lock-mysql-${SUITE}}"

cleanup() {
  "${COMPOSE[@]}" down -v --timeout 5 >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup
"${COMPOSE[@]}" up -d --build mysql migrator-1 migrator-2 migrator-3 test-runner

find_runner() {
  local candidates=(
    "${COMPOSE_PROJECT_NAME}_test-runner_1"
    "${COMPOSE_PROJECT_NAME}-test-runner-1"
  )
  for name in "${candidates[@]}"; do
    if "$ENGINE" inspect "$name" >/dev/null 2>&1; then
      printf '%s\n' "$name"
      return 0
    fi
  done
  "$ENGINE" ps -a --format '{{.Names}}' | grep -E 'test-runner' | head -n1
}

container_name=""
for _ in $(seq 1 60); do
  container_name="$(find_runner || true)"
  [ -n "$container_name" ] && break
  sleep 1
done

if [ -z "$container_name" ]; then
  echo -e "${RED}test-runner did not start${NC}" >&2
  "${COMPOSE[@]}" logs || true
  exit 1
fi

set +e
exit_code="$("$ENGINE" wait "$container_name")"
set -e

"${COMPOSE[@]}" logs test-runner || true
echo "test-runner exit code: ${exit_code}"

if [ "$exit_code" = "0" ]; then
  echo -e "${GREEN}MySQL ${SUITE} e2e PASSED${NC}"
else
  "${COMPOSE[@]}" logs migrator-1 migrator-2 migrator-3 || true
  echo -e "${RED}MySQL ${SUITE} e2e FAILED${NC}"
fi

exit "$exit_code"
