#!/usr/bin/env bash
# Rasterize SVG icons in assets/icons/ to PNG@96/144/192.
# Requires: rsvg-convert (brew install librsvg).
set -euo pipefail

cd "$(dirname "$0")/.."
ICONS_DIR="assets/icons"

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "error: rsvg-convert not found. Install with: brew install librsvg" >&2
  exit 1
fi

shopt -s nullglob
svgs=("$ICONS_DIR"/*.svg)
if [ ${#svgs[@]} -eq 0 ]; then
  echo "no SVGs in $ICONS_DIR; nothing to do."
  exit 0
fi

for svg in "${svgs[@]}"; do
  base=$(basename "$svg" .svg)
  for size in 96 144 192; do
    out="$ICONS_DIR/${base}@${size}.png"
    rsvg-convert -h "$size" "$svg" > "$out"
    echo "rendered $out"
  done
done
