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


# Longest inspiral kept before the merger peak, in seconds. Low notes are trimmed
# to start later in the inspiral; higher notes are shorter than this and unchanged.
MAX_SECONDS = 0.35
LEAD_IN_FADE = 0.05


def synthesize(midi: int, ratio: float = 0.12, rate: int = SAMPLE_RATE,
               max_seconds: float = MAX_SECONDS) -> np.ndarray:
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
    keep = round(max_seconds * rate)
    peak_index = int(np.argmax(np.abs(samples)))
    if peak_index > keep:
        samples = samples[peak_index - keep:]
        fade_in = round(LEAD_IN_FADE * rate)
    else:
        fade_in = fade
    samples[:fade_in] *= np.linspace(0, 1, fade_in)
    samples[-fade:] *= np.linspace(1, 0, fade)
    return samples * (0.9 / np.max(np.abs(samples)))


# Tone level relative to the chirp's peak, and its decay time in seconds; these
# match the website's musical mode (web/musical.mjs) so both sound the same.
TONE_LEVEL = 0.3
TONE_DECAY = 0.12


def musical_sample(samples: np.ndarray, frequency: float, rate: int = SAMPLE_RATE) -> np.ndarray:
    """Return the musical-mode sound: the chirp around its peak crossfaded into a decaying sine.

    The 350 ms sine tail at the note frequency is a synthetic musical addition,
    not a physical ringdown.
    """
    if len(samples) == 0 or not 0 < frequency < rate / 2:
        raise ValueError("Require audio samples and a frequency below Nyquist")
    peak_index = int(np.argmax(np.abs(samples)))
    start = max(0, peak_index - round(0.12 * rate))
    end = min(len(samples), peak_index + round(0.02 * rate))
    chirp_length = end - start
    chirp_peak = abs(float(samples[peak_index]))
    overlap = min(chirp_length, round(0.02 * rate))
    tone_start = chirp_length - overlap
    total = tone_start + round(0.35 * rate)
    i = np.arange(total)
    crossfade = np.clip((i - tone_start) / max(1, overlap - 1), 0, 1)
    chirp = np.zeros(total)
    chirp[:chirp_length] = samples[start:end]
    chirp *= np.cos(crossfade * np.pi / 2)
    t = (i - tone_start) / rate
    tone = np.where(t >= 0, TONE_LEVEL * chirp_peak * np.sin(2 * np.pi * frequency * t)
                    * np.exp(-t / TONE_DECAY) * np.sin(crossfade * np.pi / 2), 0)
    attack = max(1, round(0.005 * rate))
    release = max(1, round(0.01 * rate))
    envelope = np.minimum(1, np.minimum(i / attack, (total - 1 - i) / release))
    output = (chirp + tone) * envelope
    return output * (0.9 / np.max(np.abs(output)))


def write_wav(path: Path, samples: np.ndarray, rate: int = SAMPLE_RATE) -> None:
    """Write portable 16-bit PCM mono audio."""
    with wave.open(str(path), "wb") as output:
        output.setparams((1, 2, rate, 0, "NONE", "not compressed"))
        output.writeframes(np.rint(samples * 32767).astype('<i2').tobytes())
