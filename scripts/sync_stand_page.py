"""Copy the stand guides into the website.

docs/stand-setup.html (parts and one-off setup) and docs/stand-day.html (running
the stand at an event) are the guide sources. This writes
src/gw_piano/web/stand.html and stand-day.html with their images, adding a link
back to the keyboard. Prices and shop links are kept out of the repository, so
the script refuses to publish a page containing either. Run after editing a
guide, then rebuild.
Usage: python scripts/sync_stand_page.py
"""
from pathlib import Path
import re
import shutil
import sys

ROOT = Path(__file__).resolve().parent.parent
# External links allowed on the pages: web fonts, the local kiosk server, the project repository
# and the official Raspberry Pi documentation.
ALLOWED_HOSTS = ("fonts.googleapis.com", "localhost", "github.com/icg-gravwaves/", "raspberrypi.com/")
# Guide source -> published page name.
PAGES = {"stand-setup.html": "stand.html", "stand-day.html": "stand-day.html"}

web = ROOT / "src" / "gw_piano" / "web"
for source, target in PAGES.items():
    guide = (ROOT / "docs" / source).read_text()
    if "£" in guide:
        sys.exit(f"docs/{source} contains a price; keep prices out of the repository.")
    external = [url for url in re.findall(r'https?://[^"\s<>]+', guide)
                if not any(host in url for host in ALLOWED_HOSTS)]
    if external:
        sys.exit(f"docs/{source} contains external links (e.g. {external[0]}); keep shop links out of the repository.")
    page = guide.replace('src="images/', 'src="stand-')
    # Every stand page shows the GW Piano logo, linked back to the keyboard, above its eyebrow line.
    # The logo is drawn for a dark background, so it sits on a dark badge in both themes.
    page = page.replace('  <span class="eyebrow">Outreach stand',
                        '  <a href="./" aria-label="Back to GW Piano" style="justify-self:start;background:#0e1120;'
                        'border-radius:12px;padding:10px 16px;line-height:0">'
                        '<img src="gw-piano-dark.svg" alt="GW Piano" height="64" style="height:64px;width:auto"></a>\n'
                        '  <a href="./" style="font-weight:600">← Back to GW Piano</a>\n  <span class="eyebrow">Outreach stand', 1)
    (web / target).write_text("<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">"
                              "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
                              + page + "\n</html>\n")
    print(f"Wrote {web / target}")
for name in ("stand", "screen-waveform", "screen-touch"):
    shutil.copyfile(ROOT / "docs" / "images" / f"{name}.png", web / f"stand-{name}.png")
