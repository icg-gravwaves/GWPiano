"""Build a self-contained website and sampler pack."""
import argparse
import json
from importlib.resources import files
from pathlib import Path
import zipfile

from .synthesis import component_mass, note_frequency, note_name, synthesize, write_wav


def build(output: Path, low: int = 48, high: int = 84, ratio: float = 0.12,
          pack_low: int = 21, pack_high: int = 108) -> None:
    if not 0 <= pack_low <= low <= high <= pack_high <= 127:
        raise ValueError("Require 0 <= pack_low <= low <= high <= pack_high <= 127")
    output.mkdir(parents=True, exist_ok=True)
    audio = output / "audio"
    audio.mkdir(exist_ok=True)
    notes = []
    regions = ["// One-shot equal-tempered inspiral samples", "<group> loop_mode=one_shot amp_veltrack=100"]
    for midi in range(pack_low, pack_high + 1):
        filename = f"{midi:03d}_{note_name(midi).replace('#', 's')}.wav"
        write_wav(audio / filename, synthesize(midi, ratio))
        notes.append(dict(midi=midi, name=note_name(midi), frequency=note_frequency(midi), mass=component_mass(midi), file=f"audio/{filename}"))
        regions.append(f"<region> sample=audio/{filename} key={midi} pitch_keycenter={midi}")
    pack_manifest = dict(notes=notes, ratio=ratio, sample_rate=44100, mass_frame="zero-redshift",
                    model="IMRPhenomD; equal mass; zero spins; note frequency = merger-ringdown f_peak")
    manifest = dict(pack_manifest, notes=[note for note in notes if low <= note["midi"] <= high],
                    pack=dict(low=pack_low, high=pack_high, count=len(notes),
                              first=note_name(pack_low), last=note_name(pack_high)))
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (output / "sound-pack-manifest.json").write_text(json.dumps(pack_manifest, indent=2) + "\n")
    (output / "GW-Piano.sfz").write_text("\n".join(regions) + "\n")
    (output / "PACK-README.txt").write_text(
        "GW Piano — synthetic inspiral sonification, not detector data.\n"
        "44.1 kHz / 16-bit / mono WAV. A4=440 Hz. Filename prefix is MIDI note.\n"
        "IMRPhenomD merger-ringdown f_peak matches the note; full FFT peak may differ.\n"
        "Equal masses, zero spins, zero redshift. Physical merger and ringdown.\n"
        "Load GW-Piano.sfz in an SFZ sampler, or map WAVs manually. Hardware formats vary.\n"
        "Samples are licensed CC0-1.0: https://creativecommons.org/publicdomain/zero/1.0/\n")
    with zipfile.ZipFile(output / "gw-piano-sound-pack.zip", "w", zipfile.ZIP_DEFLATED) as pack:
        for item in [*(audio / Path(n["file"]).name for n in notes), output / "GW-Piano.sfz", output / "sound-pack-manifest.json", output / "PACK-README.txt"]:
            pack.write(item, item.relative_to(output))
    (output / "catalog.json").write_bytes(files("gw_piano").joinpath("data/catalog.json").read_bytes())
    for item in files("gw_piano").joinpath("web").iterdir():
        (output / item.name).write_bytes(item.read_bytes())
    (output / ".nojekyll").touch()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("dist"))
    parser.add_argument("--low", type=int, default=48, help="Lowest MIDI note (default C3)")
    parser.add_argument("--high", type=int, default=84, help="Highest MIDI note (default C6)")
    parser.add_argument("--pack-low", type=int, default=21, help="Pack lowest MIDI note (default A0)")
    parser.add_argument("--pack-high", type=int, default=108, help="Pack highest MIDI note (default C8)")
    parser.add_argument("--ratio", type=float, default=0.12, help="Starting frequency / model f_peak")
    args = parser.parse_args()
    try:
        build(args.output, args.low, args.high, args.ratio, args.pack_low, args.pack_high)
    except ValueError as error:
        parser.error(str(error))
    print(f"Built keyboard and sound pack in {args.output.resolve()}")


if __name__ == "__main__":
    main()
