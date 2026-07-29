#!/usr/bin/env bash
set -euo pipefail

# WASM Size Checker & Ceiling Enforcer for Soroban Smart Contracts
#
# Soroban protocol maximum contract code size is 131,072 bytes (128 KiB),
# per the network config setting `contract_max_size_bytes`. This script
# defaults to a conservative 65,536-byte (64 KiB) project budget, intentionally
# below the protocol maximum. (65,536 is the contract *data* entry limit, not
# the code limit.) Override via MAX_WASM_SIZE_BYTES; WASM_CEILING_BYTES is kept
# as a compatibility alias.
CEILING_BYTES="${MAX_WASM_SIZE_BYTES:-${WASM_CEILING_BYTES:-65536}}"

case "$CEILING_BYTES" in
    ''|*[!0-9]*)
        echo "Error: WASM ceiling must be a positive integer, got '$CEILING_BYTES'" >&2
        exit 1
        ;;
esac

STEP_SUMMARY_FILE="${GITHUB_STEP_SUMMARY:-/dev/null}"

format_bytes() {
    local bytes="$1"
    local kib
    kib=$(LC_ALL=C awk "BEGIN {printf \"%.2f\", $bytes/1024}")
    echo "${bytes} B (${kib} KiB)"
}

format_delta() {
    local delta="$1"
    if [ "$delta" -gt 0 ]; then
        echo "+${delta} B"
    elif [ "$delta" -lt 0 ]; then
        echo "${delta} B"
    else
        echo "0 B"
    fi
}

echo "=========================================="
echo "Soroban Contract WASM Size & Ceiling Check"
echo "Ceiling Limit: ${CEILING_BYTES} bytes"
echo "=========================================="

mkdir -p "$(dirname "$STEP_SUMMARY_FILE")" 2>/dev/null || true

{
    echo "### 📦 Soroban Contract WASM Size Report"
    echo ""
    echo "| Contract | Base Size | PR Size | Delta | Ceiling Limit | Status |"
    echo "| :--- | :--- | :--- | :--- | :--- | :--- |"
} >> "$STEP_SUMMARY_FILE"

HAS_FAILURE=0

if [ "$#" -eq 0 ]; then
    echo "Error: No contract WASM artifacts provided to check-wasm-size.sh" >&2
    exit 1
fi

# Process contract files provided as arguments in format:
# "name:pr_wasm_path[:base_wasm_path]"
for item in "$@"; do
    IFS=':' read -r name pr_path base_path <<< "$item"
    
    if [ ! -f "$pr_path" ]; then
        echo "Error: WASM file for '$name' not found at '$pr_path'" >&2
        exit 1
    fi

    pr_size=$(stat -c%s "$pr_path" 2>/dev/null || stat -f%z "$pr_path" 2>/dev/null || wc -c < "$pr_path")
    pr_size=$(echo "$pr_size" | tr -d ' ')

    base_size="N/A"
    delta_str="N/A"

    if [ -n "${base_path:-}" ] && [ -f "$base_path" ]; then
        b_size=$(stat -c%s "$base_path" 2>/dev/null || stat -f%z "$base_path" 2>/dev/null || wc -c < "$base_path")
        b_size=$(echo "$b_size" | tr -d ' ')
        base_size=$(format_bytes "$b_size")
        diff=$((pr_size - b_size))
        delta_str=$(format_delta "$diff")
    else
        base_size="N/A"
        delta_str="N/A"
        echo "  Note: no baseline WASM for '$name'; size delta unavailable (N/A)" >&2
    fi

    status_str="✅ Pass"
    if [ "$pr_size" -gt "$CEILING_BYTES" ]; then
        status_str="❌ Exceeds Ceiling"
        HAS_FAILURE=1
    fi

    pr_size_formatted=$(format_bytes "$pr_size")
    ceiling_formatted=$(format_bytes "$CEILING_BYTES")

    echo "Contract: $name"
    echo "  PR WASM Size : $pr_size_formatted"
    echo "  Base Size    : $base_size"
    echo "  Size Delta   : $delta_str"
    echo "  Ceiling Limit: $ceiling_formatted"
    echo "  Status       : $status_str"
    echo "------------------------------------------"

    echo "| \`$name\` | $base_size | $pr_size_formatted | $delta_str | $ceiling_formatted | $status_str |" >> "$STEP_SUMMARY_FILE"
done

if [ "$HAS_FAILURE" -ne 0 ]; then
    echo "Error: One or more contracts exceed the WASM size ceiling (${CEILING_BYTES} bytes)." >&2
    exit 1
fi

echo "All contract WASM sizes are within ceiling limits."
