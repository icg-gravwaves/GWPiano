#!/usr/bin/env bash
# Regenerate the stand guide images:
#   docs/images/stand.png                        from the hand-drawn stand.svg, rendered with headless Chrome
#   docs/images/screen-waveform.png, screen-touch.png  screenshots of the real kiosk pages (needs dist/, see capture_screens.mjs)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
cd "$ROOT/docs/images"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
  --window-size=1420,1000 --screenshot="$PWD/stand.png" "file://$PWD/stand.svg" 2>/dev/null
CHROME="$CHROME" node "$ROOT/scripts/capture_screens.mjs"
