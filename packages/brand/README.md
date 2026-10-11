# @mstack/brand

The bundled MoB pixel grid, rendered without a runtime dependency. `renderLogo({ size: 32 | 44 | 60, mode })` returns 13, 18 or 25 terminal lines. Modes are `truecolor`, `ansi256`, `mono` and `ascii`.

`detectMode({ env, isTTY })` respects `NO_COLOR`, terminal capabilities and the first nonempty locale in `LC_ALL`, `LC_CTYPE`, `LANG`. An explicitly non-UTF-8 locale uses ASCII. An unspecified locale uses Unicode. `--plain` and `--ascii` are explicit CLI overrides.

`palette` exports beige (`bg`), sky, orange and navy. `renderPalette({ mode })` renders their strip. `style(text, effect, { env, isTTY })` supports `bold`, `dim`, `reset`, and each palette key. Color/style escapes are suppressed without a capable TTY or when `NO_COLOR` is set.

The 256-color renderer computes nearest RGB distance once for each palette color: beige 254, sky 117, orange 203, navy 31. The authoritative asset is `assets/logo.json`; only its generator may rewrite it.
