"""Copy the stand build guide into the website without prices.

docs/stand-setup.html is the internal guide (with costs). This writes
src/gw_piano/web/stand.html plus its images, removing price and source
columns, the totals row, the costs paragraphs and every £ figure, and
adding a link back to the keyboard. Run after editing the guide, then rebuild.
Usage: python scripts/sync_stand_page.py
"""
from pathlib import Path
import re
import shutil
import sys

ROOT = Path(__file__).resolve().parent.parent
guide = (ROOT / "docs" / "stand-setup.html").read_text()
web = ROOT / "src" / "gw_piano" / "web"

page = guide.replace("<h2>Shopping list and costs</h2>", "<h2>Parts list</h2>")
# Drop price/source header cells, then the 3rd and 4th cell of every body row.
page = page.replace("<th>Price</th><th>Source</th>", "")
page = re.sub(r"(<tr><td>.*?</td><td>.*?</td>)<td class=\"num\">.*?</td><td>.*?</td></tr>", r"\1</tr>", page)
page = re.sub(r"\s*<tfoot>.*?</tfoot>", "", page, flags=re.S)
# Remove any paragraph that quotes a price.
page = re.sub(r"\s*<p>[^<]*(?:<(?!/p>)[^<]*)*£.*?</p>", "", page, flags=re.S)
page = page.replace("table{border-collapse:collapse;width:100%;min-width:620px", "table{border-collapse:collapse;width:100%;min-width:420px")
page = page.replace('src="images/', 'src="stand-')
page = page.replace('<span class="eyebrow">Outreach stand build guide</span>',
                    '<a href="./" style="font-weight:600">← Back to GW Piano</a>\n  <span class="eyebrow">Outreach stand build guide</span>')
if "£" in page:
    sys.exit("A price is still present in the public stand page; mark it for removal in this script.")
(web / "stand.html").write_text("<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">"
                                "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
                                + page + "\n</html>\n")
for name in ("stand", "screen-waveform", "screen-touch"):
    shutil.copyfile(ROOT / "docs" / "images" / f"{name}.png", web / f"stand-{name}.png")
print(f"Wrote {web / 'stand.html'}")
