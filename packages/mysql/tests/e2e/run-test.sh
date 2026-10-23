#!/usr/bin/env bash
set -euo pipefail

SUITE="${1:-mysql2}"
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

# Default image stays in docker-compose.yml. Other servers (MySQL 8.4, MariaDB)
# are a second compose file so podman-compose does not have to interpolate.
DEFAULT_MYSQL_IMAGE="docker.io/library/mysql:9.7"
MYSQL_IMAGE="${MYSQL_IMAGE:-$DEFAULT_MYSQL_IMAGE}"
if [[ ! "$MYSQL_IMAGE" =~ ^[A-Za-z0-9._:/-]+$ ]]; then
  echo -e "${RED}Invalid MYSQL_IMAGE: ${MYSQL_IMAGE}${NC}" >&2
  exit 1
fi

echo "Starting MySQL ${SUITE} e2e tests (${MYSQL_IMAGE})"

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

COMPOSE_FILES=(-f docker-compose.yml)
IMAGE_OVERRIDE=""
project_name="migration-lock-mysql-${SUITE}"
if [ "$MYSQL_IMAGE" != "$DEFAULT_MYSQL_IMAGE" ]; then
  IMAGE_OVERRIDE="$(mktemp /tmp/migration-lock-mysql-image.XXXXXX.yml)"
  cat > "$IMAGE_OVERRIDE" << EOF
services:
  mysql:
    image: ${MYSQL_IMAGE}
EOF
  COMPOSE_FILES+=(-f "$IMAGE_OVERRIDE")
  image_slug="$(printf '%s' "$MYSQL_IMAGE" | tr ':/.' '---' | tr -cd 'A-Za-z0-9-')"
  project_name="${project_name}-${image_slug}"
fi

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$project_name}"

cleanup() {
  "${COMPOSE[@]}" "${COMPOSE_FILES[@]}" down -v --timeout 5 >/dev/null 2>&1 || true
}
remove_override() {
  if [ -n "$IMAGE_OVERRIDE" ]; then
    rm -f "$IMAGE_OVERRIDE"
  fi
}
trap 'cleanup; remove_override' EXIT

cleanup
set +e
timeout 420 "${COMPOSE[@]}" "${COMPOSE_FILES[@]}" up -d --build mysql migrator-1 migrator-2 migrator-3 test-runner
up_status=$?
set -e
if [ "$up_status" -ne 0 ]; then
  echo -e "${RED}containers did not become ready (compose exit ${up_status})${NC}" >&2
  "${COMPOSE[@]}" "${COMPOSE_FILES[@]}" logs || true
  exit 1
fi

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
  "$ENGINE" ps -a --format '{{.Names}}' | grep -F "${COMPOSE_PROJECT_NAME}" | grep -E 'test-runner' | head -n1
}

container_name=""
for _ in $(seq 1 60); do
  container_name="$(find_runner || true)"
  [ -n "$container_name" ] && break
  sleep 1
done

if [ -z "$container_name" ]; then
  echo -e "${RED}test-runner did not start${NC}" >&2
  "${COMPOSE[@]}" "${COMPOSE_FILES[@]}" logs || true
  exit 1
fi

set +e
exit_code="$(timeout 240 "$ENGINE" wait "$container_name")"
wait_status=$?
set -e

if [ "$wait_status" -eq 124 ]; then
  echo -e "${RED}test-runner did not finish within 240s${NC}" >&2
  "${COMPOSE[@]}" "${COMPOSE_FILES[@]}" logs || true
  exit 1
fi

"${COMPOSE[@]}" "${COMPOSE_FILES[@]}" logs test-runner || true
echo "test-runner exit code: ${exit_code}"

if [ "$exit_code" = "0" ]; then
  echo -e "${GREEN}MySQL ${SUITE} e2e PASSED (${MYSQL_IMAGE})${NC}"
else
  "${COMPOSE[@]}" "${COMPOSE_FILES[@]}" logs migrator-1 migrator-2 migrator-3 || true
  echo -e "${RED}MySQL ${SUITE} e2e FAILED (${MYSQL_IMAGE})${NC}"
fi

exit "$exit_code"
