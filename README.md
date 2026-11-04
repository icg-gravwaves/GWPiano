# GW Piano

A Python package that builds a static, playable keyboard, 88 IMRPhenomD WAV samples (A0–C8), a shorter 37-key web keyboard (C3–C6), an SFZ sampler mapping, a downloadable ZIP, and an LVK/played-mass histogram. No Python runs in the visitor's browser.

## Run locally

Python 3.9+ (3.11 recommended); Node.js 18+ is only needed to run the audio-processing tests:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install .
python -m unittest discover -s tests -v
node --test tests/*.test.mjs
gw-piano --output dist
python -m http.server 8000 --directory dist
```

Open http://localhost:8000. Click/touch keys, or enable **computer shortcuts** to use A W S E D F T G Y H U J K for C4–C5. Enabled shortcuts play on key-down without Enter, including when a piano key or the shortcuts checkbox has focus. Shortcuts are off by default to avoid intercepting assistive-technology navigation. Tab and Enter activate individual keys. Web sounds are downloaded and decoded before their keys become available. **Musical mode** is off by default. When enabled, it plays a short segment around the model waveform’s peak with a crossfade into a 350 ms decaying sine tone at the note frequency. This is a synthetic musical addition, not physical ringdown. **Scientific mode** is the default and plays the full generated waveform including its quiet lead-in. Both modes use a 5 ms playback attack. Switching modes stops current voices. The downloadable WAVs retain the full generated waveform and have no synthetic tail. Unavailable keys do not queue delayed notes; use **Retry audio** if a download fails. Samples play once; **Stop all** stops playback. With shortcuts enabled, Space also stops playback unless it activates a focused control. Adjust output volume before playing. The histogram records successful playback starts, including repeats. The histogram uses purple catalog bars and lime-striped played bars, with currently sounding bins shown in white. Reset clears the session's played distribution. Nothing is saved remotely.

For tablet outreach, select **Full screen** above the keyboard. Keys expand to the available screen height and support simultaneous finger presses. **Exit full screen** stays visible; Escape also exits on a computer. Browsers that support the Fullscreen API hide browser chrome; other tablets use a window-filling presentation layout. Landscape orientation gives the widest keys. Leaving fullscreen stops any playing samples.

Choose the web keyboard range with `gw-piano --low 36 --high 84 --ratio 0.12`. The downloadable pack independently defaults to all 88 piano keys (MIDI 21–108). Use `--pack-low` and `--pack-high` to customize it; the pack must include the web range. MIDI endpoints are inclusive. The website manifest contains only web notes; `sound-pack-manifest.json` and the SFZ mapping cover every pack note. Extreme high notes are rejected to preserve sampling headroom. Starting frequency is `ratio * f_peak` (allowed ratio 0.08–0.4). Duration follows the physical waveform rather than a fixed musical envelope. Reinstall after source changes, or use `python -m pip install -e .` with a recent pip.

## Physics and tuning

[LALSimulation](https://lscsoft.docs.ligo.org/lalsuite/lalsimulation/) generates IMRPhenomD plus polarization at face-on inclination, equal component masses, all spin components zero, and a nominal distance of 100 Mpc. Each WAV is independently normalized to 90% peak and has 5 ms edge fades. There is no added tone, time stretch, or artificial ringdown.

“Peak frequency” is specifically [`IMRPhenomDGetPeakFreq`](https://lscsoft.docs.ligo.org/lalsuite/dev/lalsimulation/_l_a_l_sim_i_m_r_phenom_d_8c_source.html): the model's merger–ringdown amplitude-peak parameter. It is **not** the global maximum of the full Fourier amplitude (usually dominated by inspiral), maximum instantaneous frequency, or frequency at maximum time-domain strain. With fixed mass ratio and spins, frequency scales inversely with mass: `m_note = 30 Msun * f_peak(30,30,0,0) / f_note`. A4=440 Hz, equal temperament. Manifest masses are per body, in solar masses, at zero redshift. No cosmological redshift is applied; at nonzero redshift these waveform masses would be detector-frame masses.

## Catalog and histogram

The bundled snapshot is downloaded from the [GWOSC cumulative GWTC API](https://gwosc.org/api/v1/docs/). It records retrieval date, event versions, catalog names, source links, and available source-frame median component masses. Selection: latest version per event; FAR ≤1/year, or confident-catalog classification if FAR is unavailable; components with median mass ≥3 solar masses. The mass cut is a transparent BH proxy, not definitive classification. Missing masses are omitted, including recent events without parameter estimates. This is a selected snapshot, not every LVK black hole or a completeness-corrected population.

Refresh explicitly with `python scripts/update_catalog.py`, then reinstall and rebuild. CI uses the committed snapshot and does not silently update scientific data. Both histograms share linear component-mass bins of 2 M☉; both series fill the bin width and show component counts on a shared vertical scale. Muted solid vertical markers behind the histogram bars locate piano notes within the displayed 0–150 M☉ range. Every note through A2 is labelled, followed by every second semitone through A3 and A notes above A3. Note markers follow a 12-step rainbow across each octave (A red to G♯ violet), so sharps differ from naturals; the most recently played note has a thicker line. Each manually played note contributes two equal-mass components. Catalog uncertainty, selection effects and redshift differences preclude a population inference from this plot.

## Play detections in order

**Play detections in order** builds the played histogram from the exact selected catalog component masses as each event starts, so every bin matches when the sequence completes. It includes every available component in the bundled selection, including events with only one selected component. Each component is represented by an equal-mass, nonspinning model chirp at its own mass, not a reconstruction of the original unequal-mass event. Reference samples are resampled by the exact inverse-mass frequency scaling rather than rounded to piano notes. Musical mode adds the same synthetic tone as the keyboard.

The browser downloads and decodes reference note samples into a lookup table while the page loads. Both timing options and sound modes share this cache. Playback schedules individual cached buffers at their event times, using exact inverse-mass playback-rate scaling for pitch. No full-catalog audio mix is built. Musical mode pitch-shifts the cached chirp/tone together, so its duration scales with playback rate; scientific mode uses the original waveform. A shared output gain and compressor control overlapping voices. The detection-sound status indicates readiness; clicking before the first download finishes waits for sample loading and offers cancellation. All selected components are scheduled independently of the manual keyboard’s voice limit. **Pause** freezes playback and **Resume** continues from the same point; playing a keyboard note while paused ends the run. Press the button again, **Stop all**, or **Reset played notes** to stop/cancel. Later manual notes add to the catalog distribution; replaying the catalog replaces it again. The button uses the committed catalog snapshot, not a live stream of detections.

The playback timing toggle offers **In order** (100 ms between events, both components together) and **Preserve timeline**, a 30-second condensed calendar timeline that scales all GPS time differences by the same factor, including gaps between observing runs. The cached samples are peak-normalized; scheduled components use the same gain as manually played notes and the shared volume control. Background markers highlight the nearest piano notes for the duration of each component sound; exact catalog masses set the audio frequencies. Highlights use no animation and clear when the corresponding sounds end, including overlapping sounds mapped to the same note.

The played distribution uses lime-striped bars so the catalog bars remain visible underneath. White bars identify bins with currently sounding components and return to lime stripes when those sounds end, while cumulative histogram counts remain available.

Chronological playback clears the played distribution and adds each event’s components at its audio start time. Stopping retains only components whose playback has started. After the final event starts, the played distribution matches the catalog.

The calendar timeline shows linked GWOSC observing-run intervals (O1, O2, O3a, O3b, O4a, O4b), a moving cursor, UTC date, and latest event. Run breaks are retained as silence between starts; waveform tails can overlap these gaps. Timing uses each catalog event’s GPS timestamp. The bundled selection includes confident O1/O2 events whose latest records omit FAR. Off-chart played components above 150 M☉ are counted in the chart status rather than folded into the last bin.

## Is this a good instrument?

- Good for outreach, learning mass/frequency scaling, and unusual percussion or sound design. Lower notes naturally correspond to heavier systems.
- Chirps sweep through pitches: matching the model's peak parameter does not create a stable perceived note. Fast chords may sound muddy. It is better suited to short motifs than conventional piano repertoire.
- Normalization removes physical distance/loudness information; equal masses and zero spins are a deliberate restricted family, whereas observed systems span mass ratios and spins.
- WAV + SFZ is portable across compatible software samplers, but hardware keyboards often require proprietary conversion. The one-shot samples do not sustain or loop like a piano sample library.

## Deploy on GitHub Pages

1. Create an empty repository in your GitHub account. Add these source files and push them to its `main` branch (generated `dist/` and `.venv/` are ignored).
2. In **Settings → Pages → Build and deployment → Source**, choose **GitHub Actions**. Ensure Actions is enabled for the repository.
3. The included `.github/workflows/pages.yml` tests the installed package, generates `dist/`, uploads it, and deploys it. Push to `main` or run **Actions → Test, build, and deploy Pages → Run workflow**. If your default branch differs, edit the workflow branch filter.
4. Open the successful deployment's URL, normally `https://icg-gravwaves.github.io/GWPiano/`. Relative asset paths support project subdirectories. Verify keyboard audio, ZIP download, and histogram updates there.

The workflow needs `pages: write` and `id-token: write` (already declared). For a private repository, check your GitHub plan's Pages availability. No backend, credentials, custom domain or separate `gh-pages` branch is needed. See [GitHub's custom workflow instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Sampler pack in Git LFS

`sound-packs/GWPiano.zip` contains the full 88-key sampler pack and is tracked with Git LFS. Install [Git LFS](https://git-lfs.com/), run `git lfs install`, and clone normally (or run `git lfs pull` in an existing clone) to download the ZIP instead of its pointer.

To refresh the committed pack, run `gw-piano --output dist`, then `cp dist/gw-piano-sound-pack.zip sound-packs/GWPiano.zip` and commit it. The Pages workflow regenerates its own pack from source. GitHub source ZIP archives may contain only the LFS pointer depending on repository settings; use Git LFS or the website download for the audio pack.

## Licensing and branding

Project code: **GPL-3.0-or-later**, see LICENSE. LALSuite is GPL-2.0-or-later and is installed as a dependency, not bundled into the website. Generated waveform audio is offered under **CC0-1.0**, separately from code. GWOSC data retains its source attribution and applicable source terms; no project license is asserted over third-party data.

The University of Portsmouth logo uses the original vector artwork from `https://www.port.ac.uk/themes/custom/portsmouth/logo.svg`, with its standard colors preserved and a thin white outline around the artwork for the dark background and linked to the University website. The original color asset is retained as `portsmouth.svg`; the dark-background adaptation is `portsmouth-dark.svg`. It is third-party branding, excluded from the project code and audio licenses. Its presence does not grant trademark rights or assert University endorsement.

GW Piano uses a transparent SVG adaptation of concept A: an accelerating chirp flowing into piano keys, with purple strokes, lime piano-key accents, purple “GW”, and white “PIANO” for the dark theme. The asset is `src/gw_piano/web/gw-piano-dark.svg`.

The header links to Chirp Lab using its original rising-signal/open-orbit SVG logo from `https://icg-gravwaves.github.io/chirp-lab/assets/chirp-lab.svg`.
