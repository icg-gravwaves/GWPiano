"""Read the notable detections defined for the website in web/landmarks.mjs."""
from importlib.resources import files
import re


def landmarks() -> list[dict]:
    """Each landmark's fields (name, label, title, text); label defaults to the catalog name."""
    src = files("gw_piano").joinpath("web/landmarks.mjs").read_text()
    block = src[src.index("landmarks = ["):src.index("];")]
    marks = []
    for entry in re.findall(r"\{(.*?)\}", block, re.S):
        fields = {k: v.replace("\\'", "'") for k, v in re.findall(r"(\w+): '((?:[^'\\]|\\.)*)'", entry)}
        fields.setdefault("label", fields["name"])
        marks.append(fields)
    return marks
