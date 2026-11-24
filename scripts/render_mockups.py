"""Render stand and screen mock-ups for docs/ from the built pack audio and catalog.

Usage: python scripts/render_mockups.py .   (after gw-piano --output dist)
Writes docs/images/screen-*.svg; render_mockups.sh converts all SVGs to PNG.
"""
import json, sys, wave
from pathlib import Path
import numpy as np

root = Path(sys.argv[1]); dist = root / "dist"; out = root / "docs" / "images"
out.mkdir(parents=True, exist_ok=True)
THEME = json.loads((root / "conf" / "theme.json").read_text())
P = THEME["colours"]
FONT = f"font-family:{THEME['fonts']['body']['family']},Helvetica,Arial,sans-serif"

def wav(path):
    with wave.open(str(path)) as w:
        return np.frombuffer(w.readframes(w.getnframes()), "<i2") / 32767

def trace(samples, x0, y0, w, h, n=600):
    idx = np.linspace(0, len(samples) - 1, n).astype(int)
    pts = " ".join(f"{x0 + w * i / (n - 1):.1f},{y0 - h * samples[j]:.1f}" for i, j in enumerate(idx))
    return pts

LOGO = "data:image/svg+xml;base64," + __import__("base64").b64encode((root / "src" / "gw_piano" / "web" / "gw-piano-dark.svg").read_bytes()).decode()

def note_color(midi):
    """Rainbow by pitch class, A red to G# violet, as on the website."""
    return f"hsl({((midi - 21) % 12) * 25}, 85%, 70%)"

def text(x, y, s, size=20, fill=P["text"], weight=400, anchor="start"):
    return f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}" style="{FONT}">{s}</text>'

# ---------- Larger screen: timeseries, spectrogram, histogram (1280x800) ----------
RATE = 44100
WINDOW = 4.5  # seconds of audio shown, newest on the right
# Example played sequence: (sample file, note name, mode, start time in seconds)
played_seq = [("045_A2", "A2", "scientific", 0.15), ("052_E3", "E3", "scientific", 1.35),
              ("057_A3", "A3", "musical", 2.55), ("064_E4", "E4", "musical", 3.45)]
mix = np.zeros(int(WINDOW * RATE))
for f, name, mode, t0 in played_seq:
    a = wav(dist / ("audio-musical" if mode == "musical" else "audio") / f"{f}.wav")
    i0 = int(t0 * RATE); seg = a[: len(mix) - i0]
    mix[i0:i0 + len(seg)] += seg
masses = json.loads((dist / "sound-pack-manifest.json").read_text())["notes"]
mass_of = {n["name"]: n["mass"] for n in masses}

# Spectrogram rendered to PNG with matplotlib and embedded in the SVG.
import base64, io
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
nfft, hop = 4096, 256
frames = np.lib.stride_tricks.sliding_window_view(np.pad(mix, (nfft // 2, nfft // 2)), nfft)[::hop] * np.hanning(nfft)
power = 20 * np.log10(np.abs(np.fft.rfft(frames, axis=1)).T + 1e-6)
freqs = np.fft.rfftfreq(nfft, 1 / RATE)
keep = (freqs >= 20) & (freqs <= 2000)
cmap = LinearSegmentedColormap.from_list("gw", [P["panel"], P["brand-purple"], P["accent"], P["signal"], P["white"]])
fig = plt.figure(figsize=(11.8, 2.2), dpi=100); ax = fig.add_axes([0, 0, 1, 1]); ax.axis("off")
ax.pcolormesh(np.arange(power.shape[1]), freqs[keep], power[keep], cmap=cmap, vmin=power.max() - 70, vmax=power.max(), shading="auto")
ax.set_yscale("log"); ax.set_ylim(20, 2000)
buf = io.BytesIO(); fig.savefig(buf, format="png"); plt.close(fig)
spec_uri = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">',
     f'<rect width="1280" height="800" fill="{P["bg"]}"/>',
     f'<image href="{LOGO}" x="30" y="8" width="96" height="54"/>',
     text(1240, 48, "Last note: E4 · 2 × 26.5 M☉ · musical", 20, P["muted"], anchor="end")]
# Strain timeseries strip: newest audio enters on the right and scrolls left.
x0, w = 50, 1180
s += [f'<rect x="30" y="66" width="1220" height="200" rx="14" fill="{P["panel"]}"/>',
      text(50, 94, "Timeseries · strain (auto-scaled)", 16, P["muted"]),
      text(1230, 94, "◀ last 4.5 s", 16, P["muted"], anchor="end"),
      f'<line x1="{x0}" y1="176" x2="{x0 + w}" y2="176" stroke="{P["line"]}" stroke-dasharray="3 5"/>',
      f'<polyline points="{trace(mix / np.max(np.abs(mix)), x0, 176, w, 68, 2400)}" fill="none" stroke="{P["signal"]}" stroke-width="1.4"/>']
for f, name, mode, t0 in played_seq:
    x = x0 + w * t0 / WINDOW
    colour = P["warning"] if mode == "musical" else P["signal"]
    s += [f'<line x1="{x:.0f}" y1="104" x2="{x:.0f}" y2="250" stroke="{colour}" stroke-width="1" opacity=".6"/>',
          text(x + 6, 256, f"{name} · {mass_of[name]:.0f} M☉ · {mode}", 14, colour)]
# Spectrogram strip, same time axis, log frequency.
sy = 290
s += [f'<rect x="30" y="{sy - 20}" width="1220" height="262" rx="14" fill="{P["panel"]}"/>',
      text(50, sy + 6, "Spectrogram · frequency vs time", 16, P["muted"]),
      f'<image href="{spec_uri}" x="{x0}" y="{sy + 18}" width="{w}" height="220" preserveAspectRatio="none"/>']
for fq in (50, 100, 200, 500, 1000):
    y = sy + 18 + 220 * (1 - (np.log10(fq) - np.log10(20)) / 2)
    s += [f'<line x1="{x0}" y1="{y:.0f}" x2="{x0 + 14}" y2="{y:.0f}" stroke="{P["muted"]}"/>',
          text(x0 + 20, y + 5, f"{fq} Hz", 13, P["muted"])]
# Histogram (compact)
cat = json.loads((dist / "catalog.json").read_text())["events"]
comp = [m for e in cat for m in e["masses"]]
bins = np.arange(0, 152, 2); counts, _ = np.histogram(comp, bins)
played = np.zeros_like(counts)
for name, n in [("A2", 4), ("E3", 3), ("A3", 6), ("E4", 2), ("C4", 3), ("G3", 2)]:
    played[min(int(mass_of[name] // 2), len(played) - 1)] += 2 * n
s += [f'<rect x="30" y="552" width="1220" height="232" rx="14" fill="{P["panel"]}"/>',
      text(50, 580, "Black-hole masses: LVK catalogue (purple) vs notes played (striped)", 16, P["muted"]),
      '<defs><pattern id="st" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
      f'<rect width="8" height="8" fill="{P["signal"]}" opacity=".35"/><rect width="3" height="8" fill="{P["signal"]}"/></pattern></defs>']
hx, hy, W, H = 80, 742, 1140, 140
top = max(counts.max(), played.max())
# One rainbow line per key at its mass, labelled like the live page; the sounding key (E4) is bold.
label_ends = []
for n in sorted(masses, key=lambda n: n["mass"]):
    if n["mass"] > 150: continue
    x = hx + W * n["mass"] / 150; c = note_color(n["midi"]); on = n["name"] == "E4"
    s.append(f'<line x1="{x:.1f}" y1="{hy - H - 14}" x2="{x:.1f}" y2="{hy}" stroke="{c}" stroke-opacity="{.9 if on else .45}" stroke-width="{3 if on else 1}"/>')
    if n["midi"] <= 45 or (n["midi"] <= 57 and (n["midi"] - 45) % 2 == 0) or n["midi"] % 12 == 9:
        lx = x + 4; width = len(n["name"]) * 8
        row = next((r for r, end in enumerate(label_ends) if lx >= end + 5), len(label_ends))
        if row == len(label_ends): label_ends.append(0)
        label_ends[row] = lx + width
        ly = hy - H - 4 + row * 16
        s += [f'<rect x="{lx - 2:.1f}" y="{ly - 12}" width="{width + 4}" height="15" rx="2" fill="{P["panel"]}"/>',
              text(f"{lx:.1f}", ly, n["name"], 13, c, 800 if on else 500)]
for i in range(len(counts)):
    bw = W / len(counts); x = hx + i * bw
    s.append(f'<rect x="{x:.1f}" y="{hy - H * counts[i] / top:.1f}" width="{bw - 1:.1f}" height="{H * counts[i] / top:.1f}" fill="{P["catalog"]}" opacity=".8"/>')
    if played[i]:
        fill = P["white"] if i == int(mass_of["E4"] // 2) else "url(#st)"
        s.append(f'<rect x="{x:.1f}" y="{hy - H * played[i] / top:.1f}" width="{bw - 1:.1f}" height="{H * played[i] / top:.1f}" fill="{fill}"/>')
s.append(f'<line x1="{hx}" y1="{hy}" x2="{hx + W}" y2="{hy}" stroke="{P["line"]}"/>')
for m in range(0, 151, 25):
    s.append(text(hx + W * m / 150, hy + 22, f"{m} M☉" if m == 150 else str(m), 13, P["muted"], anchor="middle"))
s.append("</svg>")
(out / "screen-waveform.svg").write_text("\n".join(s))

# ---------- Touch screen (landscape 1280x720), laid out like kiosk-controls.html ----------
def button(x, y, w, h, label, fill, ink=P["text"], size=26, sub=None, stroke=None, subsize=15):
    r = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="16" fill="{fill}"' + (f' stroke="{stroke}" stroke-width="3"' if stroke else "") + "/>",
         text(x + w / 2, y + h / 2 + (size * 0.35 if not sub else -4), label, size, ink, 700, "middle")]
    if sub: r.append(text(x + w / 2, y + h / 2 + 20, sub, subsize, ink, 400, "middle"))
    return r
t = [f'<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">',
     f'<rect width="1280" height="720" fill="{P["bg"]}"/>', text(32, 38, "Sound mode", 18, P["muted"])]
t += button(32, 50, 600, 130, "SCIENTIFIC", P["surface"], P["muted"], 38, "full model waveform", stroke=P["line"])
t += button(648, 50, 600, 130, "MUSICAL", P["warning"], P["on-signal"], 38, "chirp + note tone")
t.append(text(32, 214, "Examples", 18, P["muted"]))
for i in range(4):
    t += button(32 + i * 306, 226, 294, 90, f"Example {i + 1}", P["accent"], P["on-accent"], 22)
t.append(text(32, 350, "Notable detections", 18, P["muted"]))
notable = [("The first detection", "GW150914"), ("Two neutron stars", "GW170817"), ("Three detectors", "GW170814"),
           ("The heaviest pair", "GW190521"), ("A mystery object", "GW190814"), ("Black hole + neutron star", "GW200115_042309")]
for i, (title, name) in enumerate(notable):
    t += button(32 + i * 204, 362, 194, 90, title, P["surface"], P["text"], 16, name, subsize=13)
t.append(text(32, 486, "All LVK detections", 18, P["muted"]))
t += button(32, 498, 600, 130, "▶  Play detections in order", P["brand-purple"], P["white"], 28, "0.2 s apart, oldest first")
t += button(648, 498, 292, 130, "Detection timeline", P["surface"], P["text"], 22, "30 s, real spacing")
t += button(956, 498, 292, 130, "■  Stop all", P["danger"], P["on-signal"], 28)
t += [f'<image href="{LOGO}" x="32" y="646" width="78" height="44"/>',
      text(126, 676, "Mode: musical", 17, P["muted"]),
      f'<rect x="1058" y="652" width="190" height="44" rx="14" fill="{P["surface"]}"/>',
      text(1153, 680, "Reset played notes", 17, P["muted"], 700, "middle"), "</svg>"]
(out / "screen-touch.svg").write_text("\n".join(t))
print("ok")
