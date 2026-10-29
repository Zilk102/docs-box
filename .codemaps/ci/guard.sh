#!/bin/sh
# codemaps:file v1.1.66
# Runs the CodeMaps guard in any CI. Usage: sh .codemaps/ci/guard.sh [base-ref]
# The base ref defaults to $CODEMAPS_GUARD_BASE, then origin/main. Needs git (with history), node
# 22, tar, curl or wget, and sha256sum or shasum. See docs/CI_GUARD.md in the CodeMaps repo.
set -eu

GUARD_URL="https://github.com/Zilk102/CodeMaps/releases/download/v1.1.66/codemaps-guard-1.1.66.tgz"
BASE="${1:-${CODEMAPS_GUARD_BASE:-origin/main}}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

download() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL -o "$2" "$1"; else wget -q -O "$2" "$1"; fi
}

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

download "$GUARD_URL" "$WORK/codemaps-guard.tgz"
download "$GUARD_URL.sha256" "$WORK/codemaps-guard.tgz.sha256"
expected="$(cut -d' ' -f1 "$WORK/codemaps-guard.tgz.sha256")"
actual="$(checksum "$WORK/codemaps-guard.tgz")"
if [ "$expected" != "$actual" ]; then
  echo "codemaps-guard.tgz does not match its sha256 ($expected expected, $actual found)" >&2
  exit 1
fi
tar -xzf "$WORK/codemaps-guard.tgz" -C "$WORK"

# Shallow or single-branch clones lack the base branch: fetch it when it is missing.
if ! git rev-parse --verify --quiet "$BASE^{commit}" >/dev/null; then
  git fetch --quiet origin "${BASE#origin/}"
fi

node "$WORK/guard/guard.mjs" check --base "$BASE" --format text
