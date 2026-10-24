#!/usr/bin/env bash
set -euo pipefail

SUITE="${1:-postgres}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
# shellcheck disable=SC1091
source "${REPO_ROOT}/scripts/e2e-matrix.sh"
SUITE_DIR="${SCRIPT_DIR}/${SUITE}"

if [ ! -f "${SUITE_DIR}/docker-compose.yml" ]; then
  echo "Unknown typeorm e2e suite: ${SUITE}" >&2
  echo "Expected ${SUITE_DIR}/docker-compose.yml" >&2
  exit 1
fi

cd "$SUITE_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

if [ "$SUITE" = "mysql" ]; then
  DB_SERVICE=mysql
else
  DB_SERVICE=postgres
fi

echo "Starting TypeORM ${SUITE} e2e tests"
echo "=================================================="

if command -v podman-compose >/dev/null 2>&1 && podman info >/dev/null 2>&1; then
  COMPOSE=(podman-compose)
  ENGINE=podman
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  COMPOSE=(docker compose)
  ENGINE=docker
else
  echo -e "${RED}Need podman-compose or docker compose, with a running engine.${NC}" >&2
  exit 1
fi

e2e_matrix_begin

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(e2e_matrix_project_name "migration-lock-typeorm-${SUITE}")}"

cleanup() {
  "${COMPOSE[@]}" "${COMPOSE_FILES[@]}" down -v --timeout 5 >/dev/null 2>&1 || true
}
trap 'cleanup; e2e_matrix_remove_override' EXIT

echo "Cleaning up previous runs..."
cleanup

echo "Building and starting containers..."
"${COMPOSE[@]}" "${COMPOSE_FILES[@]}" up -d --build "${DB_SERVICE}" migrator-1 migrator-2 migrator-3 test-runner

find_runner() {
  local candidates=(
    "${COMPOSE_PROJECT_NAME}_test-runner_1"
    "${COMPOSE_PROJECT_NAME}-test-runner-1"
  )
  local name
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
  if [ -n "$container_name" ]; then
    break
  fi
  sleep 1
done

if [ -z "$container_name" ]; then
  echo -e "${RED}test-runner container did not start${NC}" >&2
  "$ENGINE" ps -a || true
  "${COMPOSE[@]}" "${COMPOSE_FILES[@]}" logs || true
  exit 1
fi

echo "Waiting for ${container_name}..."
set +e
exit_code="$("$ENGINE" wait "$container_name")"
wait_status=$?
set -e

if [ "$wait_status" -ne 0 ] || [ -z "$exit_code" ]; then
  echo -e "${RED}Failed to wait for test-runner${NC}" >&2
  "${COMPOSE[@]}" "${COMPOSE_FILES[@]}" logs test-runner || true
  exit 1
fi

echo "=================================================="
echo "Verifier logs:"
"${COMPOSE[@]}" "${COMPOSE_FILES[@]}" logs test-runner || true
echo "=================================================="
echo "test-runner exit code: ${exit_code}"

if [ "$exit_code" = "0" ]; then
  echo -e "${GREEN}TypeORM ${SUITE} e2e PASSED${NC}"
else
  echo "Migrator logs:"
  "${COMPOSE[@]}" "${COMPOSE_FILES[@]}" logs migrator-1 migrator-2 migrator-3 || true
  echo -e "${RED}TypeORM ${SUITE} e2e FAILED (exit ${exit_code})${NC}"
fi

exit "$exit_code"
