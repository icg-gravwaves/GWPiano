"""Build a self-contained website and sampler pack."""
import argparse
import json
from importlib.resources import files
from pathlib import Path
import zipfile

from .synthesis import MAX_SECONDS, component_mass, musical_sample, note_frequency, note_name, synthesize, write_wav


def build(output: Path, low: int = 48, high: int = 84, ratio: float = 0.12,
          pack_low: int = 21, pack_high: int = 108, max_seconds: float = MAX_SECONDS) -> None:
    if not 0 <= pack_low <= low <= high <= pack_high <= 127:
        raise ValueError("Require 0 <= pack_low <= low <= high <= pack_high <= 127")
    output.mkdir(parents=True, exist_ok=True)
    audio = output / "audio"
    audio.mkdir(exist_ok=True)
    musical_audio = output / "audio-musical"
    musical_audio.mkdir(exist_ok=True)
    notes = []
    scientific, musical = [], []
    for midi in range(pack_low, pack_high + 1):
        filename = f"{midi:03d}_{note_name(midi).replace('#', 's')}.wav"
        samples = synthesize(midi, ratio, max_seconds=max_seconds)
        write_wav(audio / filename, samples)
        write_wav(musical_audio / filename, musical_sample(samples, note_frequency(midi)))
        notes.append(dict(midi=midi, name=note_name(midi), frequency=note_frequency(midi), mass=component_mass(midi),
                          file=f"audio/{filename}", musical_file=f"audio-musical/{filename}"))
        scientific.append(f"<region> sample=audio/{filename} key={midi} pitch_keycenter={midi}")
        musical.append(f"<region> sample=audio-musical/{filename} key={midi} pitch_keycenter={midi}")
    group = "<group> loop_mode=one_shot amp_veltrack=100"
    sfz_files = {
        # CC20 0-63 selects scientific mode (the default before any CC arrives), 64-127 musical mode.
        "GW-Piano.sfz": ["// GW Piano: CC20 0-63 = scientific, 64-127 = musical", "<control> set_cc20=0",
                         "// Scientific: full model waveform", f"{group} locc20=0 hicc20=63", *scientific,
                         "// Musical: chirp peak crossfaded into a synthetic decaying sine", f"{group} locc20=64 hicc20=127", *musical],
        "GW-Piano-Scientific.sfz": ["// GW Piano scientific mode: full model waveform", group, *scientific],
        "GW-Piano-Musical.sfz": ["// GW Piano musical mode: chirp peak with synthetic sine tail", group, *musical],
    }
    pack_manifest = dict(notes=notes, ratio=ratio, max_seconds=max_seconds, sample_rate=44100, mass_frame="zero-redshift",
                    model="IMRPhenomD; equal mass; zero spins; note frequency = merger-ringdown f_peak")
    manifest = dict(pack_manifest, notes=[note for note in notes if low <= note["midi"] <= high],
                    pack=dict(low=pack_low, high=pack_high, count=len(notes),
                              first=note_name(pack_low), last=note_name(pack_high)))
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (output / "sound-pack-manifest.json").write_text(json.dumps(pack_manifest, indent=2) + "\n")
    for name, lines in sfz_files.items():
        (output / name).write_text("\n".join(lines) + "\n")
    (output / "PACK-README.txt").write_text(
        "GW Piano — synthetic inspiral sonification, not detector data.\n"
        "44.1 kHz / 16-bit / mono WAV. A4=440 Hz. Filename prefix is MIDI note.\n"
        "IMRPhenomD merger-ringdown f_peak matches the note; full FFT peak may differ.\n"
        "Equal masses, zero spins, zero redshift.\n"
        "audio/: scientific mode, the full model waveform with physical merger and ringdown.\n"
        "audio-musical/: musical mode, the chirp around its peak crossfaded into a 350 ms\n"
        "  decaying sine at the note frequency (a synthetic addition, not physical ringdown).\n"
        "GW-Piano.sfz holds both modes: MIDI CC20 0-63 = scientific (default), 64-127 = musical.\n"
        "  Set a controller button to toggle CC20 between 0 and 127 to switch modes.\n"
        "GW-Piano-Scientific.sfz / GW-Piano-Musical.sfz: one mode each, for samplers without CC switching.\n"
        "Or map WAVs manually. Hardware formats vary.\n"
        "Samples are licensed CC0-1.0: https://creativecommons.org/publicdomain/zero/1.0/\n")
    with zipfile.ZipFile(output / "gw-piano-sound-pack.zip", "w", zipfile.ZIP_DEFLATED) as pack:
        for item in [*(output / n["file"] for n in notes), *(output / n["musical_file"] for n in notes),
                     *(output / name for name in sfz_files), output / "sound-pack-manifest.json", output / "PACK-README.txt"]:
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
    parser.add_argument("--max-seconds", type=float, default=MAX_SECONDS,
                        help="Longest inspiral kept before the merger peak, in seconds")
    args = parser.parse_args()
    try:
        build(args.output, args.low, args.high, args.ratio, args.pack_low, args.pack_high, args.max_seconds)
    except ValueError as error:
        parser.error(str(error))
    print(f"Built keyboard and sound pack in {args.output.resolve()}")


if __name__ == "__main__":
    main()
