#!/usr/bin/env bash
# Regenerate the docs mock-up SVGs and render them to PNG with headless Chrome.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python "$ROOT/scripts/render_mockups.py" "$ROOT"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
cd "$ROOT/docs/images"
for spec in stand:1420,1000 screen-waveform:1280,800 screen-touch:1280,720; do
  name=${spec%%:*}; size=${spec#*:}
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --window-size="$size" --screenshot="$PWD/$name.png" "file://$PWD/$name.svg" 2>/dev/null
done
