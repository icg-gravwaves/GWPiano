"""Render stand and screen mock-ups for docs/ from the built pack audio and catalog.

Usage: python scripts/render_mockups.py .   (after gw-piano --output dist)
Writes docs/images/screen-*.svg; render_mockups.sh converts all SVGs to PNG.
"""
import json, sys, wave
from pathlib import Path
import numpy as np

root = Path(sys.argv[1]); dist = root / "dist"; out = root / "docs" / "images"
out.mkdir(parents=True, exist_ok=True)
P = json.loads((root / "conf" / "palette.json").read_text())
FONT = "font-family:Inter,Helvetica,Arial,sans-serif"

def wav(path):
    with wave.open(str(path)) as w:
        return np.frombuffer(w.readframes(w.getnframes()), "<i2") / 32767

def trace(samples, x0, y0, w, h, n=600):
    idx = np.linspace(0, len(samples) - 1, n).astype(int)
    pts = " ".join(f"{x0 + w * i / (n - 1):.1f},{y0 - h * samples[j]:.1f}" for i, j in enumerate(idx))
    return pts

def text(x, y, s, size=20, fill=P["text"], weight=400, anchor="start"):
    return f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}" style="{FONT}">{s}</text>'

# ---------- 10.1" live display: timeseries, spectrogram, histogram (1280x800) ----------
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
     text(40, 48, "GW Piano · live", 28, weight=700),
     text(1240, 48, "Last note: E4 · 2 × 26.5 M☉ · musical", 20, P["muted"], anchor="end")]
# Strain timeseries strip: newest audio enters on the right and scrolls left.
x0, w = 50, 1180
s += [f'<rect x="30" y="66" width="1220" height="200" rx="14" fill="{P["panel"]}"/>',
      text(50, 94, "Timeseries · strain (normalised)", 16, P["muted"]),
      text(1230, 94, "◀ 4.5 s, scrolling", 16, P["muted"], anchor="end"),
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
      text(50, 580, "Black-hole masses: LVK catalogue vs notes played", 16, P["muted"]),
      '<defs><pattern id="st" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
      f'<rect width="8" height="8" fill="{P["signal"]}" opacity=".35"/><rect width="3" height="8" fill="{P["signal"]}"/></pattern></defs>']
hx, hy, W, H = 80, 742, 1140, 140
top = max(counts.max(), played.max())
for i in range(len(counts)):
    bw = W / len(counts); x = hx + i * bw
    s.append(f'<rect x="{x:.1f}" y="{hy - H * counts[i] / top:.1f}" width="{bw - 1:.1f}" height="{H * counts[i] / top:.1f}" fill="{P["catalog"]}" opacity=".8"/>')
    if played[i]:
        fill = P["white"] if i == int(mass_of["E4"] // 2) else "url(#st)"
        s.append(f'<rect x="{x:.1f}" y="{hy - H * played[i] / top:.1f}" width="{bw - 1:.1f}" height="{H * played[i] / top:.1f}" fill="{fill}"/>')
s.append(f'<line x1="{hx}" y1="{hy}" x2="{hx + W}" y2="{hy}" stroke="{P["line"]}"/>')
for m in range(0, 151, 25):
    s.append(text(hx + W * m / 150, hy + 22, f"{m} M☉" if m == 150 else str(m), 13, P["muted"], anchor="middle"))
s += [f'<rect x="900" y="568" width="14" height="14" fill="{P["catalog"]}"/>', text(920, 580, "Catalogue", 14, P["muted"]),
      f'<rect x="1010" y="568" width="14" height="14" fill="url(#st)"/>', text(1030, 580, "Played", 14, P["muted"]),
      f'<rect x="1095" y="568" width="14" height="14" fill="{P["white"]}"/>', text(1115, 580, "Sounding", 14, P["muted"])]
s.append("</svg>")
(out / "screen-waveform.svg").write_text("\n".join(s))

# ---------- 7" touch screen (Touch Display 2, landscape 1280x720) ----------
def button(x, y, w, h, label, fill, ink=P["text"], size=26, sub=None, stroke=None):
    r = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="18" fill="{fill}"' + (f' stroke="{stroke}" stroke-width="3"' if stroke else "") + "/>",
         text(x + w / 2, y + h / 2 + (size * 0.35 if not sub else -2), label, size, ink, 700, "middle")]
    if sub: r.append(text(x + w / 2, y + h / 2 + 28, sub, 17, ink, 400, "middle"))
    return r
t = [f'<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">',
     f'<rect width="1280" height="720" fill="{P["bg"]}"/>', text(40, 56, "Sound mode", 20, P["muted"])]
t += button(40, 76, 590, 150, "SCIENTIFIC", P["surface"], P["muted"], 40, "full model waveform", stroke=P["line"])
t += button(650, 76, 590, 150, "MUSICAL", P["warning"], P["on-signal"], 40, "chirp + note tone  ✓")
t.append(text(40, 280, "Examples", 20, P["muted"]))
for i, title in enumerate(["Example 1", "Example 2", "Example 3", "Example 4"]):
    t += button(40 + i * 302, 298, 290, 110, title, P["accent"], P["on-accent"], 22)
t.append(text(40, 462, "LVK detections", 20, P["muted"]))
t += button(40, 480, 590, 130, "▶  Play detections in order", P["brand-purple"], P["white"], 28, "GW150914 → latest catalogued")
t += button(650, 480, 290, 60, "In order", P["signal"], P["on-signal"], 20)
t += button(650, 550, 290, 60, "Preserve timeline", P["surface"], P["muted"], 20, stroke=P["line"])
t += button(950, 480, 290, 130, "■  Stop all", P["danger"], P["on-signal"], 28)
t += [text(40, 680, "A mode pad on the keyboard (optional) also switches mode", 18, P["muted"]),
      f'<rect x="1080" y="656" width="160" height="40" rx="12" fill="{P["surface"]}" stroke="{P["line"]}"/>',
      text(1160, 682, "Reset", 18, P["muted"], 700, "middle"), "</svg>"]
(out / "screen-touch.svg").write_text("\n".join(t))
print("ok")
