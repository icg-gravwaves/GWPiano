"""Equal-mass, nonspinning IMRPhenomD audio via LALSimulation."""
import wave
from pathlib import Path

import lal
import lalsimulation as lalsim
import numpy as np

SAMPLE_RATE = 44100
NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")


def note_frequency(midi: int) -> float:
    """Return equal-tempered frequency with A4 = 440 Hz."""
    if not 0 <= midi <= 127:
        raise ValueError("MIDI note must be between 0 and 127")
    return 440.0 * 2 ** ((midi - 69) / 12)


def note_name(midi: int) -> str:
    return f"{NAMES[midi % 12]}{midi // 12 - 1}"


def component_mass(midi: int) -> float:
    """Solar masses per body, matching PhenomD's merger-ringdown f_peak to the note.

    f_peak is the model's merger-ringdown amplitude peak parameter, not the
    maximum of the full Fourier spectrum or a maximum instantaneous frequency.
    Masses assume zero redshift; cosmological redshift is not applied.
    """
    reference = lalsim.IMRPhenomDGetPeakFreq(30, 30, 0, 0)
    return 30 * reference / note_frequency(midi)


def synthesize(midi: int, ratio: float = 0.12, rate: int = SAMPLE_RATE) -> np.ndarray:
    """Return normalized plus polarization with physical inspiral/merger/ringdown."""
    target = note_frequency(midi)
    if not 0.08 <= ratio <= 0.4:
        raise ValueError("Starting frequency ratio must be between 0.08 and 0.4")
    if rate < 8000 or target > rate / 8:
        raise ValueError("Sample rate is too low for this note and its ringdown")
    mass = component_mass(midi) * lal.MSUN_SI
    hp, _ = lalsim.SimInspiralChooseTDWaveform(
        mass, mass, 0, 0, 0, 0, 0, 0, 100 * 1e6 * lal.PC_SI,
        0, 0, 0, 0, 0, 1 / rate, target * ratio, 0, lal.CreateDict(), lalsim.IMRPhenomD)
    samples = hp.data.data.copy()
    # Retain the physical signal and trim only numerical padding at the edges.
    peak = np.max(np.abs(samples))
    active = np.flatnonzero(np.abs(samples) > peak * 1e-5)
    samples = samples[max(0, active[0] - 256):min(len(samples), active[-1] + 257)]
    fade = min(round(0.005 * rate), len(samples) // 2)
    samples[:fade] *= np.linspace(0, 1, fade)
    samples[-fade:] *= np.linspace(1, 0, fade)
    return samples * (0.9 / np.max(np.abs(samples)))


def write_wav(path: Path, samples: np.ndarray, rate: int = SAMPLE_RATE) -> None:
    """Write portable 16-bit PCM mono audio."""
    with wave.open(str(path), "wb") as output:
        output.setparams((1, 2, rate, 0, "NONE", "not compressed"))
        output.writeframes(np.rint(samples * 32767).astype('<i2').tobytes())
