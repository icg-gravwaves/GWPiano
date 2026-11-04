"""Run browser module checks through the package's standard test entry point."""
from pathlib import Path
import shutil
import subprocess
import unittest


class MusicalAudioTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node.js 18+ is needed for audio-processing tests")
    def test_musical_audio(self):
        result = subprocess.run(
            ["node", "--test", *map(str, sorted(Path(__file__).parent.glob("*.test.mjs")))],
            capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
