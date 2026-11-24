# Site design configuration

`theme.json` is the single source for interface colours and fonts (each font role names its family, weight and files in `fonts/`) and `templates/` contains SVG logo artwork with palette tokens. `sync_palette.py` generates the standalone `theme.css`, logos, and browser theme colour used by this site.

Run from this repository root:

```sh
python3 conf/sync_palette.py
python3 conf/sync_palette.py --check
```

The site can be built and deployed on its own; keep generated assets synchronized with this configuration.
