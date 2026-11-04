"""Refresh the bundled GWOSC snapshot; builds never require network access."""
import datetime
import json
from pathlib import Path
from urllib.request import urlopen

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
        if far is None or far > 1:
            continue
        masses = [event.get("mass_1_source"), event.get("mass_2_source")]
        selected = [m for m in masses if isinstance(m, (int, float)) and m >= 3]
        if selected:
            events.append(dict(name=name, version=event["version"], masses=selected,
                               catalog=event["catalog.shortName"], url=event["jsonurl"]))
    return dict(source=URL, retrieved=datetime.date.today().isoformat(),
                selection="Latest event version; FAR <= 1/year; available source-frame component median masses >= 3 solar masses. Mass cut is a BH proxy, not a definitive classification. Missing masses omitted.", events=events)


if __name__ == "__main__":
    with urlopen(URL, timeout=60) as response:
        data = extract(json.load(response))
    Path("src/gw_piano/data/catalog.json").write_text(json.dumps(data, indent=2) + "\n")
