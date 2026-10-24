#!/usr/bin/env bash
# Emits GitHub Actions outputs: docs_only, run_unit, run_e2e, e2e_matrix (JSON).
set -euo pipefail

BASE_REF="${1:?base ref required, e.g. origin/main}"
TARGETS_FILE="${2:-.github/e2e-targets.json}"
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

mapfile -t CHANGED < <(git diff --name-only "${BASE_REF}...HEAD" 2>/dev/null || git diff --name-only "${BASE_REF}" HEAD)

if [ "${#CHANGED[@]}" -eq 0 ]; then
  emit docs_only false
  emit run_unit true
  matrix_json="$(node "$SCRIPT_DIR/build-e2e-matrix.js" "$TARGETS_FILE" "$NODE_VERSION" all)"
  emit_matrix "$matrix_json"
  exit 0
fi

docs_only=true
for path in "${CHANGED[@]}"; do
  case "$path" in
    *.md | LICENSE | .github/pull_request_template.md | .cursor/* | .vscode/*)
      continue
      ;;
    *)
      docs_only=false
      break
      ;;
  esac
done

if [ "$docs_only" = true ]; then
  emit docs_only true
  emit run_unit false
  emit run_e2e false
  emit e2e_matrix "[]"
  exit 0
fi

emit docs_only false
emit run_unit true

run_all=false
declare -A touched=()

for path in "${CHANGED[@]}"; do
  case "$path" in
    packages/core/*)
      run_all=true
      ;;
    packages/*/*)
      pkg="${path#packages/}"
      pkg="${pkg%%/*}"
      touched["$pkg"]=1
      ;;
    package.json | package-lock.json | lerna.json | tsconfig.json | .github/workflows/* | .github/e2e-targets.json | .github/scripts/*)
      run_all=true
      ;;
    examples/*)
      run_all=true
      ;;
  esac
done

if [ "$run_all" = true ]; then
  matrix_json="$(node "$SCRIPT_DIR/build-e2e-matrix.js" "$TARGETS_FILE" "$NODE_VERSION" all)"
  emit_matrix "$matrix_json"
  exit 0
fi

if [ "${#touched[@]}" -eq 0 ]; then
  emit run_e2e false
  emit e2e_matrix "[]"
  exit 0
fi

pkgs_csv="$(printf '%s,' "${!touched[@]}")"
pkgs_csv="${pkgs_csv%,}"
matrix_json="$(node "$SCRIPT_DIR/build-e2e-matrix.js" "$TARGETS_FILE" "$NODE_VERSION" filter "$pkgs_csv")"
emit_matrix "$matrix_json"
