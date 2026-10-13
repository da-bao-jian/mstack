# @mstack/brand

The bundled MoB pixel grid, rendered without a runtime dependency. `renderLogo({ size: 32 | 44 | 60, mode })` returns 13, 18 or 25 terminal lines. Modes are `truecolor`, `ansi256`, `mono` and `ascii`.

`detectMode({ env, isTTY })` respects `NO_COLOR`, terminal capabilities and the first nonempty locale in `LC_ALL`, `LC_CTYPE`, `LANG`. A non-TTY or an explicitly non-UTF-8 locale uses ASCII. An unspecified TTY locale uses Unicode. `--plain` and `--ascii` are explicit CLI overrides.

`renderTerminalLogo({ size, terminal, mode? })` is the entry-point renderer. It selects the terminal mode and wraps every non-TTY logo in `<mob-home>` / `</mob-home>` markers. The CLI home screen, onboarding Ready screen and skill splash all use this renderer.

`palette` exports beige (`bg`), sky, orange and navy. `renderPalette({ mode })` renders their strip. `style(text, effect, { env, isTTY })` supports `bold`, `dim`, `reset`, and each palette key. Color/style escapes are suppressed without a capable TTY or when `NO_COLOR` is set.

The 256-color renderer computes nearest RGB distance once for each palette color: beige 254, sky 117, orange 203, navy 31. The authoritative asset is `assets/logo.json`; only its generator may rewrite it.
