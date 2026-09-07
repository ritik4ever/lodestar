#!/usr/bin/env bash
# Apply (or update) the "Protect main" repository ruleset.
# Requires repo admin permissions and the GitHub CLI (`gh`).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RULESET_FILE="${ROOT}/.github/rulesets/main-protection.json"
OWNER_REPO="${OWNER_REPO:-Stellar-Ecosystem/lodestar}"
RULESET_NAME="Protect main"

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh (GitHub CLI) is required" >&2
  exit 1
fi

if [[ ! -f "${RULESET_FILE}" ]]; then
  echo "error: missing ruleset file at ${RULESET_FILE}" >&2
  exit 1
fi

EXISTING_ID="$(
  gh api "repos/${OWNER_REPO}/rulesets" --jq \
    ".[] | select(.name == \"${RULESET_NAME}\") | .id" \
    2>/dev/null || true
)"

apply() {
  local method="$1"
  local path="$2"
  if ! gh api --method "${method}" "${path}" --input "${RULESET_FILE}" >/dev/null; then
    echo "error: failed to ${method} ruleset on ${OWNER_REPO}." >&2
    echo "This endpoint requires repository admin access. Ask a maintainer to run this script." >&2
    exit 1
  fi
}

if [[ -n "${EXISTING_ID}" ]]; then
  echo "Updating ruleset ${RULESET_NAME} (id=${EXISTING_ID}) on ${OWNER_REPO}..."
  apply PUT "repos/${OWNER_REPO}/rulesets/${EXISTING_ID}"
else
  echo "Creating ruleset ${RULESET_NAME} on ${OWNER_REPO}..."
  apply POST "repos/${OWNER_REPO}/rulesets"
fi

echo "Verifying active rules on main..."
gh api "repos/${OWNER_REPO}/rules/branches/main" --jq '
  [
    .[]
    | {
        type: .type,
        checks: (.parameters.required_status_checks // null),
        reviews: (.parameters.required_approving_review_count // null),
        strict: (.parameters.strict_required_status_checks_policy // null)
      }
  ]
'

echo "Done. Branch protection for main is active."
