"""Check selection and timing metadata in the GWOSC snapshot extractor."""
import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location(
    "update_catalog", Path(__file__).resolve().parents[1] / "scripts/update_catalog.py"
)
CATALOG = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CATALOG)


class CatalogTests(unittest.TestCase):
    def event(self, far=None, catalog="GWTC-2.1-confident"):
        return {"commonName": "GW150914", "version": 4, "far": far,
                "mass_1_source": 34.6, "mass_2_source": 30,
                "catalog.shortName": catalog, "jsonurl": "https://gwosc.org/",
                "GPS": 1126259462.4}

    def test_confident_classification_covers_missing_far(self):
        result = CATALOG.extract({"events": {"event": self.event()}})
        self.assertEqual(result["events"][0]["gps"], 1126259462.4)
        self.assertTrue(result["events"][0]["utc"].startswith("2015-09-14"))

    def test_missing_far_without_confident_classification_is_omitted(self):
        result = CATALOG.extract({"events": {"event": self.event(catalog="GWTC-marginal")}})
        self.assertEqual(result["events"], [])

    def test_reported_far_cut_applies_to_confident_catalog(self):
        result = CATALOG.extract({"events": {"event": self.event(far=2)}})
        self.assertEqual(result["events"], [])
