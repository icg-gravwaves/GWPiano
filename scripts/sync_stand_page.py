"""Copy the stand build guide into the website.

docs/stand-setup.html is the guide source. This writes src/gw_piano/web/stand.html
and its images, adding a link back to the keyboard. Prices and shop links are
kept out of the repository, so the script refuses to publish a page containing
either. Run after editing the guide, then rebuild.
Usage: python scripts/sync_stand_page.py
"""
from pathlib import Path
import re
import shutil
import sys

ROOT = Path(__file__).resolve().parent.parent
# External links allowed on the page: web fonts, the local kiosk server, the project repository
# and the official Raspberry Pi documentation.
ALLOWED_HOSTS = ("fonts.googleapis.com", "localhost", "github.com/icg-gravwaves/", "raspberrypi.com/")

guide = (ROOT / "docs" / "stand-setup.html").read_text()
web = ROOT / "src" / "gw_piano" / "web"

if "£" in guide:
    sys.exit("docs/stand-setup.html contains a price; keep prices out of the repository.")
external = [url for url in re.findall(r'https?://[^"\s<>]+', guide)
            if not any(host in url for host in ALLOWED_HOSTS)]
if external:
    sys.exit(f"docs/stand-setup.html contains external links (e.g. {external[0]}); keep shop links out of the repository.")

page = guide.replace('src="images/', 'src="stand-')
page = page.replace('<span class="eyebrow">Outreach stand build guide</span>',
                    '<a href="./" style="font-weight:600">← Back to GW Piano</a>\n  <span class="eyebrow">Outreach stand build guide</span>')
(web / "stand.html").write_text("<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">"
                                "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
                                + page + "\n</html>\n")
for name in ("stand", "screen-waveform", "screen-touch"):
    shutil.copyfile(ROOT / "docs" / "images" / f"{name}.png", web / f"stand-{name}.png")
print(f"Wrote {web / 'stand.html'}")
