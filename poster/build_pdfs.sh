#!/usr/bin/env bash
# Print the poster HTML pages to PDF with headless Chrome:
#   banner.html    -> gw-piano-banner.pdf        (1189 x 280 mm)
#   banner-a0.html -> gw-piano-banner-on-A0.pdf  (three banners on landscape A0, dotted cut lines)
# Set CHROME to use a different Chrome or Chromium binary.
set -euo pipefail
cd "$(dirname "$0")"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
for pair in "banner.html:gw-piano-banner.pdf" "banner-a0.html:gw-piano-banner-on-A0.pdf"; do
  src="${pair%%:*}" out="${pair##*:}"
  echo "Printing $src -> $out"
  # File access is needed so the A0 sheet can load banner.html in iframes; the time budget lets fonts and scripts finish.
  "$CHROME" --headless --disable-gpu --no-pdf-header-footer --allow-file-access-from-files \
    --virtual-time-budget=8000 --print-to-pdf="$PWD/$out" "file://$PWD/$src" 2>/dev/null
done
