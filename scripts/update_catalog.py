"""Refresh the bundled GWOSC snapshot; builds never require network access."""
import datetime
import json
from pathlib import Path
from urllib.request import urlopen
import lal

URL = "https://gwosc.org/eventapi/jsonfull/GWTC/"


def extract(raw):
    latest = {}
    for event in raw["events"].values():
        name = event["commonName"]
        if name not in latest or event["version"] > latest[name]["version"]:
            latest[name] = event
    events = []
    for name, event in sorted(latest.items()):
        far = event.get("far")
        confident = event["catalog.shortName"].endswith("-confident")
        if (far is None and not confident) or (far is not None and far > 1):
            continue
        masses = [event.get("mass_1_source"), event.get("mass_2_source")]
        selected = [m for m in masses if isinstance(m, (int, float)) and m >= 3]
        if selected:
            events.append(dict(name=name, version=event["version"], masses=selected,
                               catalog=event["catalog.shortName"], url=event["jsonurl"],
                               gps=event["GPS"], utc=datetime.datetime(*lal.GPSToUTC(int(event["GPS"]))[:6], tzinfo=datetime.timezone.utc).isoformat()))
    return dict(source=URL, retrieved=datetime.date.today().isoformat(),
                selection="Latest event version; FAR <= 1/year, or confident-catalog classification when FAR is unavailable; available source-frame component median masses >= 3 solar masses. Mass cut is a BH proxy, not a definitive classification. Missing masses omitted.", events=events)


if __name__ == "__main__":
    with urlopen(URL, timeout=60) as response:
        data = extract(json.load(response))
    Path("src/gw_piano/data/catalog.json").write_text(json.dumps(data, indent=2) + "\n")
