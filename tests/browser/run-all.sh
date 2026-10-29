#!/bin/sh
# Alle Browser-Tests nacheinander; bricht beim ersten Fehler ab.
set -e
cd "$(dirname "$0")"
for t in sidebar pages drop-merge outline-detect ocr signing optimize; do
  echo "== $t"
  node "$t.cjs"
done
