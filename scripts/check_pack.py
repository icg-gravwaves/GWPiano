"""Check a built site before deploy: fail loudly if the sound pack is broken.

Usage: python scripts/check_pack.py dist
"""
from array import array
import io
import json
from pathlib import Path
import sys
import wave
import zipfile

EXPECTED_RATE = 44100
MIN_PEAK = 1000  # 16-bit samples; a normalised note peaks near 29 000.


def check(site: Path) -> list:
    errors = []
    pack_path = site / "gw-piano-sound-pack.zip"
    if not pack_path.is_file():
        return [f"missing {pack_path}"]
    manifest = json.loads((site / "sound-pack-manifest.json").read_text())
    expected = json.loads((site / "manifest.json").read_text())["pack"]["count"]
    if len(manifest["notes"]) != expected:
        errors.append(f"manifest lists {len(manifest['notes'])} notes, expected {expected}")

    with zipfile.ZipFile(pack_path) as pack:
        bad = pack.testzip()
        if bad:
            return errors + [f"corrupt ZIP member: {bad}"]
        names = set(pack.namelist())
        for required in ["GW-Piano.sfz", "sound-pack-manifest.json", "PACK-README.txt"]:
            if required not in names:
                errors.append(f"ZIP is missing {required}")
        wavs = sorted(name for name in names if name.endswith(".wav"))
        if len(wavs) != expected:
            errors.append(f"ZIP has {len(wavs)} WAVs, expected {expected}")
        for note in manifest["notes"]:
            if note["file"] not in names:
                errors.append(f"ZIP is missing {note['file']} ({note['name']})")
        if "GW-Piano.sfz" in names:
            sfz = pack.read("GW-Piano.sfz").decode()
            for line in sfz.splitlines():
                if "sample=" in line:
                    sample = line.split("sample=")[1].split()[0]
                    if sample not in names:
                        errors.append(f"SFZ refers to {sample}, which is not in the ZIP")
        for name in wavs:
            with wave.open(io.BytesIO(pack.read(name))) as audio:
                if (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) != (EXPECTED_RATE, 1, 2):
                    errors.append(f"{name}: expected 44.1 kHz mono 16-bit")
                    continue
                samples = array("h", audio.readframes(audio.getnframes()))
                if not samples:
                    errors.append(f"{name}: no audio")
                elif max(abs(min(samples)), max(samples)) < MIN_PEAK:
                    errors.append(f"{name}: silent or nearly silent")
    return errors


def main() -> None:
    site = Path(sys.argv[1] if len(sys.argv) > 1 else "dist")
    errors = check(site)
    if errors:
        print("Sound pack check FAILED:")
        for error in errors:
            print(f"  - {error}")
        sys.exit(1)
    print(f"Sound pack check passed for {site / 'gw-piano-sound-pack.zip'}")


if __name__ == "__main__":
    main()
