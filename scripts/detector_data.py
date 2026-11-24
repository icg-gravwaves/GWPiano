"""Detector strain around each notable detection, from GWOSC open data, for the fact cards.

Strain is downloaded from GWOSC while the cards build and discarded afterwards: each file goes
to a temporary directory, only a short stretch around the merger is kept in memory. The analysis
functions whiten that stretch, find the merger in it with the model waveform, and make a
constant-Q time-frequency map on the same axes as the card's model track.
"""
import json
import logging
import os
from pathlib import Path
import tempfile
import urllib.request

import h5py
import lal
import lalsimulation as lalsim
import numpy as np
from scipy import signal

# Seconds of strain kept either side of the catalog merger time: enough to estimate the noise spectrum,
# and inside the 32 s files GWOSC centres on each event.
KEEP = 14
DETECTORS = {"H1": "LIGO Hanford", "L1": "LIGO Livingston", "V1": "Virgo"}


def event_info(event_url):
    """GWOSC's record for one event version (strain file list, redshift, SNR)."""
    with urllib.request.urlopen(event_url.rstrip("/") + "/") as response:
        return next(iter(json.load(response)["events"].values()))


def detector_masses(masses, info):
    """Source-frame masses redshifted to the detector frame, m (1 + z), as the detectors see them."""
    return [m * (1 + info["redshift"]) for m in masses]


def fetch(info, detector, gps):
    """Strain, start GPS time and sample rate for KEEP seconds either side of gps; the download is discarded."""
    files = [x for x in info["strain"] if x["detector"] == detector and x["format"] == "hdf5"
             and x["sampling_rate"] == 4096]
    if not files:
        raise ValueError(f"GWOSC lists no 4 kHz HDF5 strain for {detector}")
    url = min(files, key=lambda x: x["duration"])["url"]
    # GW_PIANO_STRAIN_CACHE, if set, keeps downloads in that directory between local runs;
    # otherwise each file goes to a temporary directory and is deleted after reading.
    cache = os.environ.get("GW_PIANO_STRAIN_CACHE")
    with tempfile.TemporaryDirectory() as tmp:
        local = Path(cache or tmp) / url.rsplit("/", 1)[-1]
        if not local.exists():
            logging.info("downloading %s", url)
            local.parent.mkdir(parents=True, exist_ok=True)
            urllib.request.urlretrieve(url, local.with_suffix(".part"))
            local.with_suffix(".part").rename(local)
        with h5py.File(local, "r") as f:
            strain = f["strain/Strain"]
            start, dt = float(strain.attrs["Xstart"]), float(strain.attrs["Xspacing"])
            first = int(round((gps - KEEP - start) / dt))
            data = strain[first:first + int(round(2 * KEEP / dt))].astype(float)
    if not np.all(np.isfinite(data)):
        raise ValueError(f"{detector} strain contains gaps near GPS {gps}")
    return data, start + first * dt, 1 / dt


def whiten(strain, rate):
    """Divide by the noise amplitude spectrum (Welch estimate over the whole stretch)."""
    freqs, psd = signal.welch(strain, rate, nperseg=int(4 * rate))
    window = signal.windows.tukey(len(strain), 0.1)
    spectrum = np.fft.rfft(strain * window)
    asd = np.sqrt(np.interp(np.fft.rfftfreq(len(strain), 1 / rate), freqs, psd))
    white = np.fft.irfft(spectrum / asd, len(strain))
    # Unit-variance whitened data, so energies below are in units of the noise.
    return white / np.std(white[len(white) // 4: -len(white) // 4]), (freqs, psd)


def merger_time(strain, start, rate, m1, m2, gps):
    """Detector arrival time of the merger peak and matched-filter SNR, searched within 0.1 s of gps.

    Standard one-sided matched filter against the nonspinning IMRPhenomD template, maximised over
    phase by combining the two polarisations, with the noise PSD estimated from the same stretch.
    """
    n = len(strain)
    hp, hc = lalsim.SimInspiralChooseTDWaveform(
        m1 * lal.MSUN_SI, m2 * lal.MSUN_SI, 0, 0, 0, 0, 0, 0, 100e6 * lal.PC_SI,
        0, 0, 0, 0, 0, 1 / rate, 20.0, 20.0, lal.CreateDict(), lalsim.IMRPhenomD)
    hp, hc = hp.data.data[-n:], hc.data.data[-n:]
    peak = int(np.argmax(hp ** 2 + hc ** 2))
    freqs, psd = signal.welch(strain, rate, nperseg=int(4 * rate))
    f = np.fft.rfftfreq(n, 1 / rate)
    inv_psd = np.where((f > 20) & (f < 0.45 * rate), 1 / np.interp(f, freqs, psd), 0)
    df = rate / n
    data_f = np.fft.rfft(strain * signal.windows.tukey(n, 0.1)) / rate
    snr2 = 0
    for h in (hp, hc):
        padded = np.zeros(n)
        padded[:len(h)] = h
        h_f = np.fft.rfft(np.roll(padded, -peak)) / rate      # template merger at index 0
        sigma2 = 4 * df * np.sum(np.abs(h_f) ** 2 * inv_psd)
        overlap = 2 * df * n * np.fft.irfft(data_f * np.conj(h_f) * inv_psd, n)
        snr2 = snr2 + overlap ** 2 / sigma2
    snr = np.sqrt(snr2)
    times = start + np.arange(n) / rate
    near = np.flatnonzero(np.abs(times - gps) < 0.1)
    best = near[np.argmax(snr[near])]
    logging.debug("merger %.4f, SNR %.1f", times[best], snr[best])
    return times[best], float(snr[best])


def qmap(white, start, rate, t0, t_range, f_range, q=8, rows=120, cols=400):
    """Constant-Q energy (in noise units) on log-spaced frequencies over t0 + t_range."""
    freqs = np.geomspace(*f_range, rows)
    times = t0 + np.linspace(*t_range, cols)
    idx = np.clip(((times - start) * rate).astype(int), 0, len(white) - 1)
    spectrum = np.fft.fft(white)
    f = np.fft.fftfreq(len(white), 1 / rate)
    energy = np.empty((rows, cols))
    for i, fc in enumerate(freqs):
        # Gaussian (Morlet-like) band around fc, width fc / q, applied in the frequency domain.
        width = fc / q
        band = np.exp(-0.5 * ((f - fc) / width) ** 2) * (f > 0)
        tile = np.fft.ifft(spectrum * band)
        power = np.abs(tile) ** 2
        energy[i] = power[idx] / np.median(power)
    return times - t0, freqs, energy


def _srgb_to_lab(rgb):
    """CIE L*a*b* (D65) of sRGB colours in 0-1, shape (..., 3)."""
    rgb = np.asarray(rgb, float)
    lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    xyz = lin @ np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]]).T
    xyz /= [0.95047, 1.0, 1.08883]
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def _lab_to_srgb(lab):
    lab = np.asarray(lab, float)
    fy = (lab[..., 0] + 16) / 116
    f = np.stack([fy + lab[..., 1] / 500, fy, fy - lab[..., 2] / 200], -1)
    xyz = np.where(f ** 3 > 216 / 24389, f ** 3, (116 * f - 16) / (24389 / 27)) * [0.95047, 1.0, 1.08883]
    lin = xyz @ np.array([[3.2406, -1.5372, -0.4986], [-0.9689, 1.8758, 0.0415], [0.0557, -0.2040, 1.0570]]).T
    lin = np.clip(lin, 0, 1)
    return np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * lin ** (1 / 2.4) - 0.055)


def portsmouth_colormap(stops, n=256):
    """Colour map through the given hex colours whose lightness (CIE L*) rises linearly from end to end.

    The stops are joined by straight lines in L*a*b*, and the path is resampled at equal steps of L*,
    so equal steps in value look like equal steps in brightness. Stops must increase in lightness.
    """
    from matplotlib.colors import ListedColormap, to_rgb
    lab = _srgb_to_lab([to_rgb(c) for c in stops])
    if np.any(np.diff(lab[:, 0]) <= 0):
        raise ValueError("Colour-map stops must increase in lightness")
    targets = np.linspace(lab[0, 0], lab[-1, 0], n)
    path = np.stack([np.interp(targets, lab[:, 0], lab[:, k]) for k in range(3)], -1)
    return ListedColormap(_lab_to_srgb(path), name="portsmouth")
