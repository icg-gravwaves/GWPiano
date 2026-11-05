"""Check physical scaling, generated audio, and the distributable site."""
import json
from pathlib import Path
import tempfile
import unittest
import wave
import zipfile

import lalsimulation as lalsim
import numpy as np
from gw_piano.cli import build
from gw_piano.synthesis import component_mass, note_frequency, synthesize


class InstrumentTests(unittest.TestCase):
    def test_note_and_mass_scaling(self):
        self.assertEqual(note_frequency(69), 440)
        self.assertAlmostEqual(component_mass(60) / component_mass(72), 2)
        for midi in range(21, 109):
            mass = component_mass(midi)
            self.assertAlmostEqual(lalsim.IMRPhenomDGetPeakFreq(mass, mass, 0, 0), note_frequency(midi), places=8)

    def test_audio(self):
        for midi in (21, 69, 108):
            samples = synthesize(midi)
            self.assertTrue(np.all(np.isfinite(samples)))
            self.assertAlmostEqual(float(np.max(np.abs(samples))), 0.9)
            self.assertEqual(samples[0], 0)
            self.assertEqual(samples[-1], 0)
            self.assertGreater(len(samples), 1000)

    def test_low_notes_are_capped(self):
        # A0 was ~6.8 s; trimming keeps 0.35 s before the peak plus the ringdown.
        self.assertLess(len(synthesize(21)) / 44100, 1.5)
        self.assertEqual(len(synthesize(69)), len(synthesize(69, max_seconds=10)))

    def test_distribution(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            build(output, 60, 62)
            manifest = json.loads((output / 'manifest.json').read_text())
            self.assertEqual(len(manifest['notes']), 3)
            self.assertEqual(manifest['pack']['count'], 88)
            with zipfile.ZipFile(output / 'gw-piano-sound-pack.zip') as pack:
                self.assertIsNone(pack.testzip())
                self.assertIn('GW-Piano.sfz', pack.namelist())
                pack_manifest = json.loads(pack.read('sound-pack-manifest.json'))
                self.assertEqual([note['midi'] for note in pack_manifest['notes']], list(range(21, 109)))
                self.assertEqual(len([name for name in pack.namelist() if name.endswith('.wav')]), 88)
                regions = pack.read('GW-Piano.sfz').decode()
                self.assertEqual(regions.count('<region>'), 88)
                for note in pack_manifest['notes']:
                    self.assertIn(note['file'], pack.namelist())
                    with wave.open(str(output / note['file'])) as wav:
                        self.assertEqual((wav.getnchannels(), wav.getsampwidth(), wav.getframerate()), (1, 2, 44100))
            catalog = json.loads((output / 'catalog.json').read_text())
            names = [event['name'] for event in catalog['events']]
            self.assertEqual(len(names), len(set(names)))
            self.assertTrue(all(m >= 3 for event in catalog['events'] for m in event['masses']))
            self.assertTrue((output / 'portsmouth.svg').is_file())

    def test_invalid_inputs(self):
        for midi in (-1, 128):
            with self.assertRaises(ValueError): note_frequency(midi)
        with self.assertRaises(ValueError): synthesize(69, ratio=0)
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError): build(Path(folder), 70, 60)
