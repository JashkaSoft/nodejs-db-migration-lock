#!/usr/bin/env bash
# Sourced by packages/*/tests/e2e/run-test.sh.
# Selects the Node image for built services and, when DB_IMAGE is set,
# swaps the database service image. podman-compose merges this file over
# docker-compose.yml, so the suite files stay free of ${VAR} interpolation.

e2e_matrix_begin() {
  NODE_VERSION="${NODE_VERSION:-26}"
  if [[ ! "$NODE_VERSION" =~ ^[0-9]+$ ]]; then
    echo "Invalid NODE_VERSION: ${NODE_VERSION}" >&2
    exit 1
  fi

  if [ -n "${DB_IMAGE:-}" ]; then
    if [[ ! "$DB_IMAGE" =~ ^[A-Za-z0-9._:/-]+$ ]]; then
      echo "Invalid database image: ${DB_IMAGE}" >&2
      exit 1
    fi
    if [ -z "${DB_SERVICE:-}" ]; then
      echo "DB_SERVICE is required when DB_IMAGE is set" >&2
      exit 1
    fi
  fi

  E2E_MATRIX_OVERRIDE="$(mktemp /tmp/migration-lock-e2e-matrix.XXXXXX.yml)"
  {
    printf 'services:\n'
    local svc
    for svc in migrator-1 migrator-2 migrator-3 test-runner; do
      printf '  %s:\n' "$svc"
      printf '    build:\n'
      printf '      args:\n'
      printf '        NODE_VERSION: "%s"\n' "$NODE_VERSION"
    done
    if [ -n "${DB_IMAGE:-}" ]; then
      printf '  %s:\n' "$DB_SERVICE"
      printf '    image: %s\n' "$DB_IMAGE"
    fi
  } > "$E2E_MATRIX_OVERRIDE"

  if [ -z "${COMPOSE_FILES+x}" ]; then
    COMPOSE_FILES=(-f docker-compose.yml)
  fi
  COMPOSE_FILES+=(-f "$E2E_MATRIX_OVERRIDE")

  if [ -n "${DB_IMAGE:-}" ]; then
    echo "e2e matrix: Node ${NODE_VERSION}, ${DB_SERVICE} image ${DB_IMAGE}"
  else
    echo "e2e matrix: Node ${NODE_VERSION}"
  fi
}

e2e_matrix_project_name() {
  local name="$1"
  if [ "$NODE_VERSION" != "26" ]; then
    name="${name}-node${NODE_VERSION}"
  fi
  if [ -n "${DB_IMAGE:-}" ]; then
    local image_slug
    image_slug="$(printf '%s' "$DB_IMAGE" | tr ':/.' '---' | tr -cd 'A-Za-z0-9-')"
    name="${name}-${image_slug}"
  fi
  printf '%s\n' "$name"
}

e2e_matrix_remove_override() {
  if [ -n "${E2E_MATRIX_OVERRIDE:-}" ]; then
    rm -f "$E2E_MATRIX_OVERRIDE"
  fi
}
