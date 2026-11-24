"""Render printable A5 fact cards for the landmark detections.

Each card shows the event's IMRPhenomD chirp (component median masses, no spin)
as a strain timeseries and as a time-frequency track, plus the nearest piano note
to its merger frequency, matching the website's landmark mapping.

Usage: python scripts/fact_cards.py [--output dist/landmark-fact-cards.pdf]
"""
import argparse
import json
import logging
from datetime import datetime
import textwrap
from pathlib import Path

import lal
import lalsimulation as lalsim
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib import font_manager
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.patches import Rectangle
import numpy as np

from gw_piano.landmarks import landmarks

from detector_data import (DETECTORS, detector_masses, event_info, fetch, merger_time, portsmouth_colormap,
                           qmap, whiten)
from gw_piano.synthesis import NAMES, merger_peak, note_frequency

ROOT = Path(__file__).resolve().parents[1]
THEME = json.loads((ROOT / "conf/theme.json").read_text())
DARK = THEME["colours"]
HEAD_FONT, BODY_FONT = THEME["fonts"]["heading"]["family"], THEME["fonts"]["body"]["family"]
NOTE_FONT = THEME["fonts"]["note"]["family"]
# Print-friendly light body in the site's brand colours; the header band stays in the site's dark scheme.
C = {**DARK, "bg": "#ffffff", "panel": "#f5f3f8", "text": "#0f1218", "muted": "#555d6a", "line": "#c3c9d2",
     "signal": DARK["brand-blue"], "accent-text": DARK["brand-blue"], "catalog": DARK["brand-purple"],
     "key-white": "#ffffff", "key-black": "#171717"}
LOGOS = ROOT / "conf/logos"
# Portsmouth colours for detector data: black, purple, blue, white, with lightness rising evenly.
DATA_CMAP = portsmouth_colormap(["#000000", C["brand-purple"], C["brand-blue"], "#ffffff"])
# The theme's heading and body fonts, with DejaVu Sans for symbols such as ☉.
for font in (ROOT / "conf/fonts").glob("*.ttf"):
    font_manager.fontManager.addfont(str(font))
HEAD = [HEAD_FONT, "DejaVu Sans"]
plt.rcParams.update({"font.family": [BODY_FONT, "DejaVu Sans"], "pdf.fonttype": 42,
                     # Mathtext, used for the subscript solar-mass symbol, in the heading font.
                     "mathtext.fontset": "custom", "mathtext.rm": HEAD_FONT,
                     "mathtext.it": HEAD_FONT, "mathtext.bf": HEAD_FONT,
                     "mathtext.fallback": "stixsans"})
A5 = (5.83, 8.27)
RATE = 16384
F_LOWER = 15.0
# Every card plots the same time span, so signal durations compare directly:
# WINDOW seconds before the merger peak to AFTER seconds after it.
WINDOW = 1.0
AFTER = 0.05
# Detector shown for each landmark: the clearer LIGO site, never Livingston for GW170817 (glitch).
DETECTOR = {"GW150914": "H1", "GW170817": "H1", "GW170814": "L1", "GW190521": "L1", "GW190814": "L1",
            "GW200115_042309": "L1", "GW230529_181500": "L1", "GW250114_082203": "L1"}
# Matched-filter SNR above which the merger time is taken from the data.
MIN_ALIGN_SNR = 7
# Colour range of whitened energy (in units of the noise) for the detector maps.
ENERGY_MAX = 20
# Top of the shared frequency axis, so high and low mergers compare at a glance; it matches the
# ~1.8 kHz reach of the 4 kHz detector data. Only GW170817, whose merger is far above that,
# extends its model track to F_TOP_HIGH; other high notes may sit at or above the top edge.
F_TOP = 1843
F_TOP_HIGH = 7000
# Low edge of the detectors' sensitive band, used for the quoted duration.
F_BAND = 20.0


def note_for_pair(m1, m2):
    """Nearest MIDI note to the binary's own IMRPhenomD merger frequency, as the website tunes events."""
    f_peak = merger_peak(m1, m2)
    return round(69 + 12 * np.log2(f_peak / 440)), f_peak


def note_label(midi):
    return f"{NAMES[midi % 12]}{midi // 12 - 1}".replace("#", "♯")


def chirp(m1, m2):
    """Return time (s, merger peak at 0), plus strain, instantaneous frequency."""
    hp, hc = lalsim.SimInspiralChooseTDWaveform(
        m1 * lal.MSUN_SI, m2 * lal.MSUN_SI, 0, 0, 0, 0, 0, 0, 100e6 * lal.PC_SI,
        0, 0, 0, 0, 0, 1 / RATE, F_LOWER, F_LOWER, lal.CreateDict(), lalsim.IMRPhenomD)
    h = hp.data.data - 1j * hc.data.data
    amp = np.abs(h)
    peak = int(np.argmax(amp))
    t = (np.arange(len(h)) - peak) / RATE
    phase = np.unwrap(np.angle(h))
    freq = np.abs(np.gradient(np.unwrap(np.angle(h))) * RATE / (2 * np.pi))
    keep = (t >= -WINDOW) & (t <= AFTER)
    # Frequency is undefined where the signal has died away (taper, late ringdown).
    freq[amp < amp[peak] * 0.05] = np.nan
    logging.debug("chirp %.2f+%.2f: %d samples, %.3f s shown", m1, m2, keep.sum(), -t[keep][0])
    return t[keep], hp.data.data[keep] / amp[peak], freq[keep], amp[keep] / amp[peak]


def uk_date(utc):
    """UK long date with an ordinal day, e.g. 29th May 2023."""
    day = datetime.fromisoformat(utc).day
    suffix = "th" if 11 <= day <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")
    return f"{day}{suffix} {datetime.fromisoformat(utc):%B %Y}"


def duration_label(seconds):
    if seconds < 1:
        return f"{seconds:.2f} s"
    return f"{seconds:.0f} s" if seconds < 120 else f"{seconds / 60:.1f} minutes"


def draw_keyboard(ax, midi):
    """88-key strip with the event's key highlighted (or an arrow beyond the top)."""
    whites = [m for m in range(21, 109) if NAMES[m % 12][-1] != "#"]
    pos = {m: i for i, m in enumerate(whites)}
    for m, i in pos.items():
        fc = C["accent-text"] if m == midi else C["key-white"]
        ax.add_patch(Rectangle((i, 0), 1, 1, fc=fc, ec=C["line"], lw=0.4))
    for m in range(21, 109):
        if NAMES[m % 12][-1] == "#":
            fc = C["accent-text"] if m == midi else C["key-black"]
            ax.add_patch(Rectangle((pos[m - 1] + 0.65, 0.38), 0.7, 0.62, fc=fc, ec="none"))
    for c in range(24, 109, 12):
        ax.text(pos[c] + 0.5, -0.15, note_label(c), ha="center", va="top", fontsize=4.5, color=C["muted"])
    if midi > 108:
        ax.annotate("", xy=(len(whites) + 2.5, 0.5), xytext=(len(whites) + 0.3, 0.5),
                    arrowprops=dict(arrowstyle="-|>", color=C["accent-text"], lw=1.2))
    # Equal margins either side keep the keys centred while leaving room for the off-piano arrow.
    ax.set_xlim(-3, len(whites) + 3)
    ax.set_ylim(-0.6, 1.05)
    ax.axis("off")


def add_logo(fig, path, right, top, height):
    """Place a PNG logo by its top-right corner, in figure fractions, keeping its aspect ratio."""
    img = plt.imread(path)
    width = height * img.shape[1] / img.shape[0] * A5[1] / A5[0]
    ax = fig.add_axes([right - width if right else 0.07, top - height, width, height])
    # interpolation="none" embeds the PNG at full resolution instead of resampling to figure dpi.
    ax.imshow(img, interpolation="none")
    ax.axis("off")


def style_axes(ax):
    ax.set_facecolor(C["panel"])
    ax.tick_params(labelsize=7, colors=C["muted"])
    for side, spine in ax.spines.items():
        spine.set_visible(side in ("left", "bottom"))
        spine.set_color(C["line"])
    ax.set_xlim(-WINDOW, AFTER)
    ax.axvline(0, color=C["line"], lw=0.6, zorder=0)


def draw_detector(ax, event, detector, f_range):
    """Whitened GWOSC strain from one detector as a constant-Q map on the model track's axes."""
    info = event_info(event["url"])
    strain, start, rate = fetch(info, detector, event["gps"])
    t0, snr = merger_time(strain, start, rate, *detector_masses(event["masses"], info), event["gps"])
    if snr < MIN_ALIGN_SNR:
        # Too faint to time reliably by matched filter: centre on GWOSC's catalog time instead.
        logging.debug("%s %s SNR %.1f: using catalog time", event["name"], detector, snr)
        t0 = event["gps"]
    white, _ = whiten(strain, rate)
    # The 4 kHz public data reach only to ~0.45 x sample rate, so the map's axis stops there.
    f_range = (f_range[0], min(f_range[1], 0.45 * rate))
    times, freqs, energy = qmap(white, start, rate, t0, (-WINDOW, AFTER), f_range)
    ax.pcolormesh(times, freqs, energy, cmap=DATA_CMAP, vmin=0, vmax=ENERGY_MAX, shading="auto", rasterized=True)
    ax.set_yscale("log")
    ax.set_ylim(*f_range)
    ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"{v:g}"))
    ax.yaxis.set_minor_formatter(matplotlib.ticker.NullFormatter())
    ax.set_title(f"As {DETECTORS[detector]} saw it", fontsize=9, loc="left", color=C["text"], family=HEAD)
    logging.info("%s: %s data, SNR %.1f", event["name"], detector, snr)


def card(pdf, mark, event, detector):
    m1, m2 = event["masses"]
    midi, f_note_peak = note_for_pair(m1, m2)
    t, h, f, amp = chirp(m1, m2)
    duration = lalsim.SimIMRPhenomDChirpTime(m1 * lal.MSUN_SI, m2 * lal.MSUN_SI, 0, 0, F_BAND)
    on_piano = 21 <= midi <= 108

    fig = plt.figure(figsize=A5)
    fig.patch.set_facecolor(C["bg"])
    # Small dark header band holding the site logo.
    fig.add_artist(Rectangle((0, 0.92), 1, 0.08, transform=fig.transFigure, fc=DARK["bg"], ec="none", zorder=-1))
    add_logo(fig, LOGOS / "gw-piano-dark.png", 0, 0.99, 0.06)

    fig.text(0.93, 0.86, uk_date(event["utc"]), fontsize=10, family=HEAD, color=C["muted"], va="center", ha="right")
    fig.text(0.07, 0.86, mark["label"], fontsize=24, family=HEAD, color=C["brand-purple"], va="center")
    # Subtitle as the site's handwritten note on a lime highlight, centred and tilted 2 degrees
    # anticlockwise like the site's notes (CSS rotate(-2deg)).
    fig.text(0.5, 0.818, mark["title"], fontsize=12, family=[NOTE_FONT, "DejaVu Sans"], weight="bold",
             color=C["black"], ha="center", va="center", rotation=2, rotation_mode="anchor",
             bbox=dict(boxstyle="square,pad=0.25", fc=C["highlight"], ec="none"))
    fig.text(0.07, 0.792, textwrap.fill(mark["text"], 78), fontsize=8.5, color=C["muted"], va="top", linespacing=1.4)

    # Two rows of two: what merged and for how long, then what it sounds like.
    facts = [("Masses", f"{m1:g} + {m2:g} M$_\\odot$"),
             ("Duration", duration_label(duration)),
             ("Note frequency", f"{note_frequency(midi):.0f} Hz"),
             ("Piano note", note_label(midi) + ("" if on_piano else " (above the piano)"))]
    for i, (k, v) in enumerate(facts):
        x = 0.07 + (i % 2) * 0.45
        y = 0.678 - (i // 2) * 0.046
        fig.text(x, y, k.upper(), fontsize=6, color=C["muted"])
        fig.text(x, y - 0.024, v, fontsize=11.5, family=HEAD,
                 color=C["accent-text"] if k == "Piano note" else C["text"])

    ax_t = fig.add_axes([0.13, 0.445, 0.80, 0.12])
    ax_t.plot(t, h, color=C["signal"], lw=0.6)
    ax_t.set_ylabel("Strain", fontsize=8, color=C["muted"])
    ax_t.set_yticks([])
    ax_t.set_title("The chirp as a wave", fontsize=10, loc="left", color=C["text"], family=HEAD)

    # Model track and detector data side by side, on the same time and frequency axes.
    ax_f = fig.add_axes([0.13, 0.2, 0.37, 0.19])
    track = LinearSegmentedColormap.from_list("track", [DARK["catalog"], C["accent"], C["brand-purple"]])
    ax_f.scatter(t, f, c=amp, cmap=track, s=1.5, lw=0, vmin=0, vmax=1, rasterized=True)
    ax_f.set_yscale("log")
    ax_f.set_ylim(F_LOWER, F_TOP_HIGH if event["name"] == "GW170817" else F_TOP)
    top = ax_f.get_ylim()[1]
    if f_note_peak < top:
        ax_f.axhline(f_note_peak, color=C["catalog"], ls="--", lw=0.8)
        ax_f.text(-WINDOW, min(f_note_peak * 1.1, top * 0.75), f" {note_label(midi)}",
                  color=C["catalog"], fontsize=7)
    else:
        # The note is above this axis: say so inside the graph instead of drawing the line off the top.
        ax_f.text(-WINDOW, top * 0.85, f" {note_label(midi)} ↑",
                  color=C["catalog"], fontsize=7, va="top")
    ax_f.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"{v:g}"))
    ax_f.yaxis.set_minor_formatter(matplotlib.ticker.NullFormatter())
    ax_f.set_ylabel("Frequency (Hz)", fontsize=8, color=C["muted"])
    ax_f.set_title("Model chirp", fontsize=9, loc="left", color=C["text"], family=HEAD)
    ax_d = fig.add_axes([0.565, 0.2, 0.365, 0.19])
    draw_detector(ax_d, event, detector, ax_f.get_ylim())
    for ax in (ax_t, ax_f, ax_d):
        style_axes(ax)
    for ax in (ax_f, ax_d):
        ax.set_xticks([-1, -0.5, 0])
        ax.set_xlabel("Time from merger (s)", fontsize=7.5, color=C["muted"])
    if duration > WINDOW:
        ax_t.annotate(f"started {duration_label(duration)} earlier", xy=(-WINDOW, 0.9), xytext=(-WINDOW * 0.72, 0.9),
                      fontsize=7, color=C["muted"], va="center",
                      arrowprops=dict(arrowstyle="-|>", color=C["muted"], lw=0.8))
    plt.setp(ax_t.get_xticklabels(), visible=False)

    draw_keyboard(fig.add_axes([0.07, 0.085, 0.86, 0.04]), midi)
    fig.text(0.07, 0.03,
             "Model chirp (IMRPhenomD, no spin); duration counted from 20 Hz, where the detectors become sensitive.\n"
             "The piano note is the nearest key to the merger frequency.",
             fontsize=5.5, color=C["muted"], ha="left", linespacing=1.4)
    pdf.savefig(fig, facecolor=C["bg"])
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--output", type=Path, default=ROOT / "dist/landmark-fact-cards.pdf")
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.debug else logging.INFO)
    # Symbol-fallback font lookups are expected and not worth reporting.
    logging.getLogger("matplotlib.font_manager").setLevel(logging.ERROR)
    logging.getLogger("fontTools").setLevel(logging.WARNING)
    events = {e["name"]: e for e in json.loads((ROOT / "src/gw_piano/data/catalog.json").read_text())["events"]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with PdfPages(args.output) as pdf:
        for mark in landmarks():
            card(pdf, mark, events[mark["name"]], DETECTOR[mark["name"]])
            logging.info("card %s", mark["name"])
    logging.info("wrote %s", args.output)


if __name__ == "__main__":
    main()
