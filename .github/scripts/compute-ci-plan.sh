#!/usr/bin/env bash
# Maps dorny/paths-filter outputs to CI plan (docs_only, run_unit, run_e2e, e2e_matrix).
# Set FILTER_<name>=true|false for each filter in .github/ci-path-filters.yml.
set -euo pipefail

TARGETS_FILE="${1:-.github/e2e-targets.json}"
NODE_VERSION="${E2E_NODE_VERSION:-26}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  emit() { printf '%s=%s\n' "$1" "$2" >>"$GITHUB_OUTPUT"; }
else
  emit() { printf '%s=%s\n' "$1" "$2"; }
fi

emit_matrix() {
  local json="$1"
  emit e2e_matrix "$json"
  if [ "$json" = "[]" ]; then
    emit run_e2e false
  else
    emit run_e2e true
  fi
}

is_true() {
  [ "${1:-false}" = "true" ]
}

# docs-only PR: markdown/docs paths changed and nothing in the code filter matched.
if is_true "${FILTER_DOCS:-false}" && ! is_true "${FILTER_CODE:-false}"; then
  emit docs_only true
  emit run_unit false
  emit run_e2e false
  emit e2e_matrix "[]"
  exit 0
fi

emit docs_only false

if ! is_true "${FILTER_CODE:-false}"; then
  emit run_unit true
  emit run_e2e false
  emit e2e_matrix "[]"
  exit 0
fi

emit run_unit true

if is_true "${FILTER_GLOBAL:-false}" || is_true "${FILTER_CORE:-false}"; then
  matrix_json="$(node "$SCRIPT_DIR/build-e2e-matrix.js" "$TARGETS_FILE" "$NODE_VERSION" all)"
  emit_matrix "$matrix_json"
  exit 0
fi

pkgs=()
for pkg in postgres mysql mssql cockroach yugabyte oracle sqlite typeorm sequelize mikroorm kysely knex; do
  var="FILTER_${pkg^^}"
  if is_true "${!var:-false}"; then
    pkgs+=("$pkg")
  fi
done

if [ "${#pkgs[@]}" -eq 0 ]; then
  emit run_e2e false
  emit e2e_matrix "[]"
  exit 0
fi

pkgs_csv="$(IFS=,; echo "${pkgs[*]}")"
matrix_json="$(node "$SCRIPT_DIR/build-e2e-matrix.js" "$TARGETS_FILE" "$NODE_VERSION" filter "$pkgs_csv")"
emit_matrix "$matrix_json"
