# Chrome Web Store listing: JevX for GitHub

Upload: `build/jevx-for-github-<version>.zip`. Bump `"version"` in `apps/jevx-extension/manifest.json` for every new upload.

## Store listing

**Name:** JevX for GitHub

**Summary (max 132 chars):**
See which lines in any GitHub repo are hardcoded guesses that should be a Jev judgment, with a fit score for each. Read-only.

**Description:**
JevX finds the judgment calls hiding as rules in code: regexes that guess what an error means, keyword lists that guess what a customer wants, `includes()` checks that guess intent.

Open any GitHub repository, click JevX, and get:
• The exact file and lines where Jev (TypeSafe's noul / choice / score) fits
• The current code, and the question Jev would ask instead
• A fit score from three sources: your AI, patterns from real Jev projects, and TypeSafe (optional)
• A plain verdict: "Jev fits here", "could help", "mixed signals" or "not needed"
• A ready prompt for Claude or a JevX command to apply the change locally, with your tests running before and after

Bring your own AI key: Gemini (free tier works), xAI (Grok) or OpenRouter.

Private by design: read-only (nothing changes on GitHub), keys stay in your browser, code goes only to the AI provider you choose, secrets are removed first. No tracking, no analytics.

Open source (MIT): https://github.com/vij-sameerb5/JevX · Website: https://jevx.live

**Category:** Developer Tools · **Language:** English

**Graphics:**
- Icon 128×128: `apps/jevx-extension/icons/icon128.png`
- Screenshots 1280×800 (at least 1): results panel on a real repo, the "where to add Jev" card, settings page
- Small promo tile 440×280 (optional)

## Privacy tab

**Single purpose:** Show where Jev judgments fit in the GitHub repository the user is viewing.

**Permission justifications:**
- `sidePanel`: displays the results next to the GitHub page.
- `tabs`: reads the current tab's URL to know which GitHub repository the user is viewing. No other tab data is used.
- `storage`: stores the user's own API keys and saved results locally on the device.
- Host `api.github.com`, `raw.githubusercontent.com`: read the repository's file list and source files.
- Host `generativelanguage.googleapis.com`, `api.x.ai`, `openrouter.ai`: send the selected code to the AI provider the user chose, with the user's key.
- Host `api.typesafe.ai`: optional, only with the user's TypeSafe key, to score each suggestion.

**Remote code:** No. All code is in the package.

**Data usage (check):** "Website content" (source code of the repo being viewed, sent to the user's chosen AI provider). "Authentication information" (the user's own API keys, stored locally, sent only to that provider).
Certify: not sold, not used for unrelated purposes, not used for creditworthiness.

**Privacy policy URL:** https://jevx.live/privacy.html
