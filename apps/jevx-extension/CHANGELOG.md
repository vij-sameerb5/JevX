# JevX for GitHub — changelog

## 0.3.1 — 2026-10-05 · reads the whole repo

- Fixed: big repos always said "no Jev needed". File picking took the 40 smallest files (mostly `index.ts` barrels), so only ~6 tiny files reached the AI.
- Scanning is now separate from the AI and free: up to 400 source files (Standard) or 2,500 (Whole repo) are checked on your computer; only files with rules or AI calls go to your AI, in up to 8 parts.
- Files named like decisions (`classify`, `filter`, `moderation`, `route`, `prompt`…) are read first; files under 300 bytes are skipped; more AI-call shapes are detected.
- Standard / Whole repo picker; "No Jev fits found yet" with a **Scan the whole repo** button when only part was scanned.
- The "some parts failed" warning now always shows.

## 0.3.0 — 2026-10-01

- First Chrome Web Store build: Gemini / xAI / OpenRouter, TypeSafe second opinion, community patterns, "Where to add Jev" cards.
