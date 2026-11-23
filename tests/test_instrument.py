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
from gw_piano.synthesis import component_mass, musical_sample, note_frequency, synthesize


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
        # Short high notes peak before the cap and are left untouched.
        self.assertEqual(len(synthesize(84)), len(synthesize(84, max_seconds=10)))

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
                self.assertEqual(len([name for name in pack.namelist() if name.endswith('.wav')]), 176)
                regions = pack.read('GW-Piano.sfz').decode()
                self.assertEqual(regions.count('<region>'), 176)
                self.assertIn('locc20=0 hicc20=63', regions)
                self.assertIn('locc20=64 hicc20=127', regions)
                for single in ('GW-Piano-Scientific.sfz', 'GW-Piano-Musical.sfz'):
                    self.assertEqual(pack.read(single).decode().count('<region>'), 88)
                for note in pack_manifest['notes']:
                    self.assertIn(note['file'], pack.namelist())
                    self.assertIn(note['musical_file'], pack.namelist())
                    with wave.open(str(output / note['file'])) as wav:
                        self.assertEqual((wav.getnchannels(), wav.getsampwidth(), wav.getframerate()), (1, 2, 44100))
            catalog = json.loads((output / 'catalog.json').read_text())
            names = [event['name'] for event in catalog['events']]
            self.assertEqual(len(names), len(set(names)))
            self.assertTrue(all(m > 0 for event in catalog['events'] for m in event['masses']))
            self.assertTrue((output / 'portsmouth.svg').is_file())
            for page in ('kiosk-live.html', 'kiosk-controls.html', 'kiosk.mjs', 'stand.html', 'stand-day.html'):
                self.assertTrue((output / page).is_file(), page)
            self.assertNotIn('£', (output / 'stand.html').read_text())
            self.assertNotIn('£', (output / 'stand-day.html').read_text())

    def test_musical_sample(self):
        samples = synthesize(69)
        result = musical_sample(samples, note_frequency(69))
        self.assertAlmostEqual(float(np.max(np.abs(result))), 0.9)
        self.assertEqual(result[0], 0)
        self.assertEqual(result[-1], 0)
        # Chirp segment (up to 140 ms) less the 20 ms crossfade, then the 350 ms tail.
        self.assertLessEqual(len(result), round(0.47 * 44100))
        self.assertGreater(len(result), round(0.35 * 44100))
        with self.assertRaises(ValueError): musical_sample(samples, 30000)

    def test_invalid_inputs(self):
        for midi in (-1, 128):
            with self.assertRaises(ValueError): note_frequency(midi)
        with self.assertRaises(ValueError): synthesize(69, ratio=0)
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError): build(Path(folder), 70, 60)
