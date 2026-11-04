# GW Piano

A Python package that builds a static, playable keyboard, 88 IMRPhenomD WAV samples (A0–C8), a shorter 37-key web keyboard (C3–C6), an SFZ sampler mapping, a downloadable ZIP, and an LVK/played-mass histogram. No Python runs in the visitor's browser.

## Run locally

Python 3.9+ (3.11 recommended):

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install .
python -m unittest discover -s tests -v
gw-piano --output dist
python -m http.server 8000 --directory dist
```

Open http://localhost:8000. Click/touch keys, or enable **computer shortcuts** to use A W S E D F T G Y H U J K for C4–C5. Shortcuts are off by default to avoid intercepting assistive-technology navigation. Tab and Enter activate individual keys. Samples play once; Stop all or Space stops playback. Adjust output volume before playing. The histogram records successful playback starts, including repeats; The histogram uses solid and striped bars, with exact counts in its table. Reset clears the session's played distribution. Nothing is saved remotely.

For tablet outreach, select **Full screen** above the keyboard. Keys expand to the available screen height and support simultaneous finger presses. **Exit full screen** stays visible; Escape also exits on a computer. Browsers that support the Fullscreen API hide browser chrome; other tablets use a window-filling presentation layout. Landscape orientation gives the widest keys. Leaving fullscreen stops any playing samples.

Choose the web keyboard range with `gw-piano --low 36 --high 84 --ratio 0.12`. The downloadable pack independently defaults to all 88 piano keys (MIDI 21–108). Use `--pack-low` and `--pack-high` to customize it; the pack must include the web range. MIDI endpoints are inclusive. The website manifest contains only web notes; `sound-pack-manifest.json` and the SFZ mapping cover every pack note. Extreme high notes are rejected to preserve sampling headroom. Starting frequency is `ratio * f_peak` (allowed ratio 0.08–0.4). Duration follows the physical waveform rather than a fixed musical envelope. Reinstall after source changes, or use `python -m pip install -e .` with a recent pip.

## Physics and tuning

[LALSimulation](https://lscsoft.docs.ligo.org/lalsuite/lalsimulation/) generates IMRPhenomD plus polarization at face-on inclination, equal component masses, all spin components zero, and a nominal distance of 100 Mpc. Each WAV is independently normalized to 90% peak and has 5 ms edge fades. There is no added tone, time stretch, or artificial ringdown.

“Peak frequency” is specifically [`IMRPhenomDGetPeakFreq`](https://lscsoft.docs.ligo.org/lalsuite/dev/lalsimulation/_l_a_l_sim_i_m_r_phenom_d_8c_source.html): the model's merger–ringdown amplitude-peak parameter. It is **not** the global maximum of the full Fourier amplitude (usually dominated by inspiral), maximum instantaneous frequency, or frequency at maximum time-domain strain. With fixed mass ratio and spins, frequency scales inversely with mass: `m_note = 30 Msun * f_peak(30,30,0,0) / f_note`. A4=440 Hz, equal temperament. Manifest masses are per body, in solar masses, at zero redshift. No cosmological redshift is applied; at nonzero redshift these waveform masses would be detector-frame masses.

## Catalog and histogram

The bundled snapshot is downloaded from the [GWOSC cumulative GWTC API](https://gwosc.org/api/v1/docs/). It records retrieval date, event versions, catalog names, source links, and available source-frame median component masses. Selection: latest version per event; FAR ≤1/year; components with median mass ≥3 solar masses. The mass cut is a transparent BH proxy, not definitive classification. Missing masses are omitted, including recent events without parameter estimates. This is a selected snapshot, not every LVK black hole or a completeness-corrected population.

Refresh explicitly with `python scripts/update_catalog.py`, then reinstall and rebuild. CI uses the committed snapshot and does not silently update scientific data. Both histograms share linear bins and are independently normalized to percentages; raw counts are available in the accessible table. Each note contributes two equal-mass components. Catalog uncertainty, selection effects and redshift differences preclude a population inference from this plot.

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

Deployment is not automatic from this local workspace: a repository push and Pages configuration are required. No pull request is created by this project.

## Licensing and branding

Project code: **GPL-3.0-or-later**, see LICENSE. LALSuite is GPL-2.0-or-later and is installed as a dependency, not bundled into the website. Generated waveform audio is offered under **CC0-1.0**, separately from code. GWOSC data retains its source attribution and applicable source terms; no project license is asserted over third-party data.

The University of Portsmouth logo uses the original vector artwork from `https://www.port.ac.uk/themes/custom/portsmouth/logo.svg`, with its standard colors preserved and a thin white outline around the artwork for the dark background and linked to the University website. The original color asset is retained as `portsmouth.svg`; the dark-background adaptation is `portsmouth-dark.svg`. It is third-party branding, excluded from the project code and audio licenses. Its presence does not grant trademark rights or assert University endorsement.

GW Piano uses a transparent SVG adaptation of concept A: an accelerating chirp flowing into piano keys, with purple strokes, lime piano-key accents, purple “GW”, and white “PIANO” for the dark theme. The asset is `src/gw_piano/web/gw-piano-dark.svg`.
