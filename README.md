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

Open http://localhost:8000. Click/touch keys, or enable **computer shortcuts** to use A W S E D F T G Y H U J K for C4–C5. Enabled shortcuts play on key-down without Enter, including when a piano key or the shortcuts checkbox has focus. Shortcuts are off by default to avoid intercepting assistive-technology navigation. Tab and Enter activate individual keys. Web sounds are downloaded and decoded before their keys become available. **Musical mode** is off by default. When enabled, it plays a short segment around the model waveform’s peak with a crossfade into a 350 ms decaying sine tone at the note frequency. This is a synthetic musical addition, not physical ringdown. **Scientific mode** is the default and plays the full generated waveform including its quiet lead-in. Both modes use a 5 ms playback attack. Switching modes stops current voices. The sound pack includes WAVs for both modes; its scientific WAVs retain the full generated waveform with no synthetic tail. Unavailable keys do not queue delayed notes; use **Retry audio** if a download fails. Samples play once; **Stop all** stops playback. With shortcuts enabled, Space also stops playback unless it activates a focused control. Adjust output volume before playing. The histogram records successful playback starts, including repeats. The histogram uses blue catalog bars and pink-striped played bars, with currently sounding bins shown in white. Reset clears the session's played distribution. Nothing is saved remotely.

For tablet outreach, select **Full screen** above the keyboard. Keys expand to the available screen height and support simultaneous finger presses. **Exit full screen** stays visible; Escape also exits on a computer. Browsers that support the Fullscreen API hide browser chrome; other tablets use a window-filling presentation layout. Landscape orientation gives the widest keys. Leaving fullscreen stops any playing samples.

Choose the web keyboard range with `gw-piano --low 36 --high 84 --ratio 0.12`. The downloadable pack independently defaults to all 88 piano keys (MIDI 21–108). Use `--pack-low` and `--pack-high` to customize it; the pack must include the web range. MIDI endpoints are inclusive. The website manifest contains only web notes; `sound-pack-manifest.json` and the SFZ mapping cover every pack note. Extreme high notes are rejected to preserve sampling headroom. Starting frequency is `ratio * f_peak` (allowed ratio 0.08–0.4). Duration follows the physical waveform rather than a fixed musical envelope. Reinstall after source changes, or use `python -m pip install -e .` with a recent pip.

## Physics and tuning

[LALSimulation](https://lscsoft.docs.ligo.org/lalsuite/lalsimulation/) generates IMRPhenomD plus polarization at face-on inclination, equal component masses, all spin components zero, and a nominal distance of 100 Mpc. The waveform starts at 0.12 × f_peak (`--ratio`). Where more than 0.35 s (`--max-seconds`) of inspiral precedes the merger peak, the start is trimmed to 0.35 s before the peak with a 50 ms fade-in, so low notes start later in the inspiral instead of lasting up to 7 s. Each WAV is independently normalized to 90% peak and has 5 ms edge fades. There is no added tone, time stretch, or artificial ringdown.

“Peak frequency” is specifically [`IMRPhenomDGetPeakFreq`](https://lscsoft.docs.ligo.org/lalsuite/dev/lalsimulation/_l_a_l_sim_i_m_r_phenom_d_8c_source.html): the model's merger–ringdown amplitude-peak parameter. It is **not** the global maximum of the full Fourier amplitude (usually dominated by inspiral), maximum instantaneous frequency, or frequency at maximum time-domain strain. With fixed mass ratio and spins, frequency scales inversely with mass: `m_note = 30 Msun * f_peak(30,30,0,0) / f_note`. A4=440 Hz, equal temperament. Manifest masses are per body, in solar masses, at zero redshift. No cosmological redshift is applied; at nonzero redshift these waveform masses would be detector-frame masses.

## Catalog and histogram

The bundled snapshot is downloaded from the [GWOSC cumulative GWTC API](https://gwosc.org/api/v1/docs/). It records retrieval date, event versions, catalog names, source links, and available source-frame median component masses. Selection: latest version per event; FAR ≤1/year, or confident-catalog classification if FAR is unavailable; components with median mass ≥3 solar masses. The mass cut is a transparent BH proxy, not definitive classification. Missing masses are omitted, including recent events without parameter estimates. This is a selected snapshot, not every LVK black hole or a completeness-corrected population.

Refresh explicitly with `python scripts/update_catalog.py`, then reinstall and rebuild. CI uses the committed snapshot and does not silently update scientific data. Both histograms share linear component-mass bins of 2 M☉; both series fill the bin width and show component counts on a shared vertical scale. Catalog components include neutron stars (no mass cut). The lightest piano key, C8, is about 1.9 M☉ per body, so neutron-star components play above C8 with the same black-hole model; treat their sound as indicative only. Muted solid vertical markers behind the histogram bars locate piano notes within the displayed 0–150 M☉ range. Every note through A2 is labelled, followed by every second semitone through A3 and A notes above A3. Note markers follow a 12-step rainbow across each octave (A red to G♯ violet), so sharps differ from naturals; the most recently played note has a thicker line. Each manually played note contributes two equal-mass components. Catalog uncertainty, selection effects and redshift differences preclude a population inference from this plot.

## Play detections in order

**Play detections in order** plays one sound per merger, tuned to the event's own merger frequency (see **Landmark detections**) by resampling the nearest reference note, rather than rounded to piano notes. As each merger starts, both of its catalog component masses are added to the played histogram, so every bin matches when the sequence completes. Musical mode adds the same synthetic tone as the keyboard.

The browser downloads and decodes reference note samples into a lookup table while the page loads. Both timing options and sound modes share this cache. Playback schedules individual cached buffers at their event times, using exact inverse-mass playback-rate scaling for pitch. No full-catalog audio mix is built. Musical mode pitch-shifts the cached chirp/tone together, so its duration scales with playback rate; scientific mode uses the original waveform. A shared output gain and compressor control overlapping voices. The detection-sound status indicates readiness; clicking before the first download finishes waits for sample loading and offers cancellation. All selected components are scheduled independently of the manual keyboard’s voice limit. **Pause** freezes playback and **Resume** continues from the same point; playing a keyboard note while paused ends the run. Press the button again, **Stop all**, or **Reset played notes** to stop/cancel. Later manual notes add to the catalog distribution; replaying the catalog replaces it again. The button uses the committed catalog snapshot, not a live stream of detections.

**Landmark detections** lists selected events (`web/landmarks.mjs`), each as one merger. A single component has no frequency, so each event is placed by its pair's merger frequency: the build writes `peak`, the nonspinning IMRPhenomD `f_peak` for the event's own two median masses, into the deployed `catalog.json`. This is the same parameter that tunes each key, so keys map to equal-mass pairs while events keep their real mass ratio. The nearest key's sample is resampled by `peak / note frequency`, so the merger pitch is the event's own; the shape of the sweep still comes from that key's equal-mass chirp. Events without a `peak` (a single component) fall back to the equal-mass binary with the same chirp mass, `m = 2^(1/5) Mc`.

The playback timing toggle offers **In order** (100 ms between mergers) and **Preserve timeline**, a 30-second condensed calendar timeline that scales all GPS time differences by the same factor, including gaps between observing runs. The cached samples are peak-normalized; scheduled components use the same gain as manually played notes and the shared volume control. Background markers highlight the nearest piano notes for the duration of each component sound; exact catalog masses set the audio frequencies. Highlights use no animation and clear when the corresponding sounds end, including overlapping sounds mapped to the same note.

The played distribution uses pink-striped bars so the catalog bars remain visible underneath. White bars identify bins with currently sounding components and return to pink stripes when those sounds end, while cumulative histogram counts remain available.

Chronological playback clears the played distribution and adds each event’s component masses when its merger sound starts. Stopping retains only components whose playback has started. After the final event starts, the played distribution matches the catalog.

The calendar timeline shows linked GWOSC observing-run intervals (O1, O2, O3a, O3b, O4a, O4b), a moving cursor, UTC date, and latest event. Run breaks are retained as silence between starts; waveform tails can overlap these gaps. Timing uses each catalog event’s GPS timestamp. The bundled selection includes confident O1/O2 events whose latest records omit FAR. Off-chart played components above 150 M☉ are counted in the chart status rather than folded into the last bin.

## Is this a good instrument?

- Good for outreach, learning mass/frequency scaling, and unusual percussion or sound design. Lower notes naturally correspond to heavier systems.
- Chirps sweep through pitches: matching the model's peak parameter does not create a stable perceived note. Fast chords may sound muddy. It is better suited to short motifs than conventional piano repertoire.
- Normalization removes physical distance/loudness information; equal masses and zero spins are a deliberate restricted family, whereas observed systems span mass ratios and spins.
- WAV + SFZ is portable across compatible software samplers, but hardware keyboards often require proprietary conversion. The one-shot samples do not sustain or loop like a piano sample library.

## Outreach stand kiosk

`kiosk-live.html` and `kiosk-controls.html` run a standalone stand: a MIDI keyboard and two screens driven by a Raspberry Pi. Parts and one-off setup are on `stand.html`; running the stand at an event, including a volunteer briefing, is on `stand-day.html`. The live page plays the sound-pack samples (both modes) for incoming MIDI notes, switches mode on MIDI CC20, and draws a scrolling strain timeseries, a spectrogram and the catalog histogram. The controls page is for the touch screen. It sends mode, example, detection, stop and reset commands to the live page over a `BroadcastChannel`, so both pages must run in the same browser profile. For testing without a keyboard, the live page accepts A W S E D F T G Y H U J K for C4–C5 and M to switch mode.

`stand.html` and `stand-day.html` are generated from `docs/stand-setup.html` and `docs/stand-day.html` with `python scripts/sync_stand_page.py`, which refuses prices and shop links so neither enters the repository. `scripts/render_mockups.sh` regenerates the guide images: the stand drawing from `docs/images/stand.svg`, and the screen previews as screenshots of the real kiosk pages from `dist/` (`scripts/capture_screens.mjs`, after `gw-piano --output dist`).

## Deploy on GitHub Pages

1. Create an empty repository in your GitHub account. Add these source files and push them to its `main` branch (generated `dist/` and `.venv/` are ignored).
2. In **Settings → Pages → Build and deployment → Source**, choose **GitHub Actions**. Ensure Actions is enabled for the repository.
3. The included `.github/workflows/pages.yml` tests the installed package, generates `dist/`, uploads it, and deploys it. Push to `main` or run **Actions → Test, build, and deploy Pages → Run workflow**. If your default branch differs, edit the workflow branch filter.
4. Open the successful deployment's URL, normally `https://icg-gravwaves.github.io/GWPiano/`. Relative asset paths support project subdirectories. Verify keyboard audio, ZIP download, and histogram updates there.

The workflow needs `pages: write` and `id-token: write` (already declared). For a private repository, check your GitHub plan's Pages availability. No backend, credentials, custom domain or separate `gh-pages` branch is needed. See [GitHub's custom workflow instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Sampler pack

The full 88-key sampler pack (`gw-piano-sound-pack.zip`) is built by `gw-piano --output dist` and is not committed. The Pages workflow rebuilds it on every deploy, and the site's **Download sound pack** button links to that copy.

The pack contains both sound modes for every note. `audio/` holds the scientific samples (the full model waveform), and `audio-musical/` holds the musical samples, rendered with the same chirp-plus-decaying-sine processing as the website's musical mode. `GW-Piano.sfz` loads both modes and switches between them on MIDI CC20: 0–63 selects scientific (the default) and 64–127 selects musical, so a controller button set to toggle CC20 between 0 and 127 acts as the mode switch. `GW-Piano-Scientific.sfz` and `GW-Piano-Musical.sfz` each load one mode, for samplers without CC-based switching.

Before deploying, the workflow runs `python scripts/check_pack.py dist`. It fails the build, leaving the live site unchanged, if the ZIP is corrupt, any note is missing, the SFZ points to a missing file, or any WAV is not 44.1 kHz mono 16-bit or is silent. Run the same command locally after `gw-piano --output dist`.

The workflow installs exact dependency versions from `ci/requirements.txt`, so a new LALSuite or NumPy release cannot change the deployed waveforms by itself. To upgrade, change a pin, rebuild and check the pack locally, then commit.

## Licensing and branding

Project code: **GPL-3.0-or-later**, see LICENSE. LALSuite is GPL-2.0-or-later and is installed as a dependency, not bundled into the website. Generated waveform audio is offered under **CC0-1.0**, separately from code. GWOSC data retains its source attribution and applicable source terms; no project license is asserted over third-party data.

The website, fact cards and poster do not include the University of Portsmouth logo.

GW Piano uses a transparent SVG adaptation of concept A: an accelerating chirp flowing into piano keys, with Portsmouth-blue strokes, light-blue piano-key accents, Portsmouth-blue “GW”, and white “PIANO” for the dark theme. The asset is `src/gw_piano/web/gw-piano-dark.svg`.

The header links to Whoop! and loads its logo directly from the Whoop! site (`https://icg-gravwaves.github.io/whoop/assets/whoop.svg`), so the logo stays in step with that project.

## Shared theme (colours and fonts)

`conf/theme.json` is the single source for interface colours and fonts, and `conf/templates/` holds the SVG logo artwork with palette tokens. `python3 conf/sync_palette.py` generates `src/gw_piano/web/theme.css` (colour and font variables), copies the font files from `conf/fonts/` into the site, and generates the logos and the browser theme colour; run it before building, and use `--check` to verify the generated assets match. See `conf/README.md`.
