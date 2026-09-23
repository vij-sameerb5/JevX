# Recordings

Real terminal GIFs for the landing page, made with [VHS](https://github.com/charmbracelet/vhs)
(`brew install vhs`). Each `.tape` is a script; VHS types it into a real terminal and records it.

```
cd ~/Desktop/jevX/site/recordings
vhs first-run.tape        # → first-run.gif
vhs scan.tape             # needs XAI_API_KEY (via JEVX_ENV_FILE) and ~/Desktop/globalcare-ai
vhs apply.tape            # runs on a copy of examples/jev-demo, so nothing real is changed
```

Until the GIFs exist, the landing page's terminal plays the same flows from `site.js`.
Before committing a GIF, watch it once: make sure no key, path or private code is visible.
The Claude Code flow is best recorded with a screen recorder (Kap / QuickTime), cropped to the terminal.
