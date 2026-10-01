# JevX for GitHub (Chrome extension) · preview 0.3.0

Open any GitHub repo, click the JevX button, and see where Jev (TypeSafe noul / choice / score) fits in it, as the same confidence cards the CLI shows.

**It's read-only.** It never changes anything on GitHub. To change the code, use JevX locally: each card has **Copy prompt for Claude** (for the JevX MCP tools) and **Copy CLI command** (`npx @vij-sameerb5/jevx --dry-run --only <file>`).

## Install (unpacked, for now)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder (`apps/jevx-extension`).
3. The options page opens. Pick an **AI provider** and paste its key:
   - **Gemini**, which has a free tier. Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). The model setting `auto` picks the newest Flash-Lite model your key can use.
   - **xAI (Grok)**: `grok-4.6` by default.
   - **OpenRouter**: any model id, `x-ai/grok-4.6` by default.

   A GitHub token is optional: you only need one for private repos or when GitHub's limit of 60 requests an hour runs out.
4. Pin JevX, open a repo, click the button, then click **Find where Jev fits**.

## What it does

1. **Gets the file list** from the GitHub API.
2. **Picks likely logic files on your computer**, at no cost. It skips tests, builds, config and UI-heavy folders. Logic folders like `api/`, `lib/`, `server/` and `agents/` go first.
3. **Fetches up to 40 files** and ranks them by rule signals: regex tests, keyword lists, `includes()` chains, `slice(0, n)`, thresholds, and LLM calls that pick a label.
4. **Sends the best files to your AI in one call.** That's about 30k tokens, less than a cent on Flash Lite. Secrets are removed first.
5. **Shows a scorecard for each spot:**
   - **AI:** your AI's score, using the same 0.1–0.9 rubric as the CLI.
   - **Patterns:** the same `profile.json` match as the CLI.
   - **TypeSafe:** Jev's own opinion, if you add a TypeSafe key in options. It uses the same questions and formula as the CLI, and only each spot's lines are sent.
   - **Seen in:** how many of the 82 real Jev decisions in open-source projects replace the same kind of rule (`docs/COMMUNITY-PATTERNS.md`). This is context, not a score.

## Privacy

- Your keys stay only in Chrome's local extension storage. They aren't synced or sent to JevX, and they're used only to call the AI provider you picked and GitHub.
- Code goes only to the AI provider you picked, with your key, and only after you click.
- Results are cached on your computer, one per repo.

## Not yet

- Python repos get only basic support (file picking works, and the prompt is the same).
- Very large repos: only the 40 most likely files are read.
- Not on the Chrome Web Store yet. See `docs/V2-PLAN.md`.

## Tests

`tests/extension.test.ts` tests the analysis with GitHub and Gemini mocked. The extension was also loaded in Chromium and run end to end with the network mocked.
