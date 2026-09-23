# Project intake (M5)

> These 30 projects are **source corpus A**: evidence of developer choice, not ground truth. See [docs/CURRENT-ARCHITECTURE.md](../docs/CURRENT-ARCHITECTURE.md) §4 and §8.

The queue of real projects going into the dataset. The source of truth is `dataset/intake.json`; this page is generated from it. Sameer's original list, as he gave it, is in `dataset/PROJECTS-30.md`. Once a project is analyzed, its record in `dataset/projects/<slug>/` holds the details.

## Rules

- **Being a Jev project proves nothing.** Using Jev does **not** make every decision in the project a Jev opportunity. Label objectively.
- **Visibility.** A project with an open-source license (MIT, Apache-2.0, BSD) is `public`: scrubbed snippets may be stored. A project with **no license found** is saved `private` (fingerprint-only, no code). With no license we have no right to redistribute the code, even though it's publicly viewable.
- **Pinned commits.** Every project is analyzed at the commit recorded below. `pnpm corpus fetch` downloads exactly that commit as a tarball; no git is used.
- **Splits are per project, deterministic.** Projects by the same GitHub owner share a split, because they share code. JevX's leak check found identical `provider.ts` code in jkudish/jev-browser and jkudish/jev-mcp.
- **Phase 1 analyzes TS/JS only.** Python/Rust projects wait for their language to be added.

## Status (checked 2026-09-20)

**Totals:** 13 ready, 4 partial (TS/JS part only), 12 need another language (10 Python, 2 Rust), 1 blocked (no link).

| # | Project | Status | Main language | License | Visibility | Split | Candidates / filtered (offline, a1) | Commit | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | [Jev Ultrafast](https://github.com/browser-use/jev-ultrafast) | partial | python (351 TS/JS lines) | MIT | public | train | 3 / 0 | 1231850a 2026-09-18 | mostly python; only the TS/JS part (351 lines) can be analyzed in Phase 1 |
| 2 | [Jev Experiments](https://github.com/dabit3/jev-experiments) | ready | ts (41,164 TS/JS lines) | none found | private | train | 185 / 75 | 43abec33 2026-09-19 | TS/JS project; no open-source license found → stored fingerprint-only (private rules) |
| 3 | [Jev Review](https://github.com/devagrawal09/jev-review) | ready | ts (1,832 TS/JS lines) | MIT | public | train | 13 / 0 | 31f89602 2026-09-17 | TS/JS project |
| 4 | [TypeSafe Mario](https://github.com/fhshaik/typesafe-mario) | needs_language | python (0 TS/JS lines) | none found | private | - | - / - | ca22449e 2026-09-15 | python project — needs python support (Phase 1 is TS/JS only); no open-source license found → stored fingerprint-only (private rules) |
| 5 | [Jev Browser Use](https://github.com/wy-coliney/jev-browser-use) | ready | js (347 TS/JS lines) | MIT | public | test | 7 / 0 | f14b60e0 2026-09-18 | TS/JS project |
| 6 | [Jev Browser](https://github.com/jkudish/jev-browser) | ready | ts (1,445 TS/JS lines) | MIT | public | test | 12 / 0 | 8d90c51b 2026-09-19 | TS/JS project |
| 7 | [TypeSafe Computer Use](https://github.com/awlevin/typesafe-computer-use) | needs_language | python (0 TS/JS lines) | MIT | public | - | - / - | cc7b5066 2026-09-18 | python project — needs python support (Phase 1 is TS/JS only) |
| 8 | [Jev Guard](https://github.com/leepokai/jev-guard) | ready | js (1,615 TS/JS lines) | MIT | public | train | 21 / 4 | 94996ea8 2026-09-18 | TS/JS project |
| 9 | [Jev Router](https://github.com/gargpratyush/jev-router) | ready | js (2,314 TS/JS lines) | MIT | public | train | 10 / 2 | 38da6b84 2026-09-19 | TS/JS project |
| 10 | [Pi Jev Router](https://github.com/mejiasd3v/pi-jev-router) | ready | js (1,641 TS/JS lines) | MIT | public | train | 9 / 0 | 24043d08 2026-09-18 | TS/JS project |
| 11 | [OpenAgents](https://github.com/OpenAgentsInc/openagents) | needs_language | rust (0 TS/JS lines) | Apache-2.0 | public | - | - / - | 0e02f6b3 2026-09-19 | rust project — needs rust support (Phase 1 is TS/JS only) |
| 12 | [SocAI](https://github.com/socai-io/socai) | partial | rust (16,622 TS/JS lines) | Apache-2.0 | public | train | 134 / 31 | 05471bb8 2026-09-20 | mostly rust; only the TS/JS part (16622 lines) can be analyzed in Phase 1 |
| 13 | [Quackd](https://github.com/rokbenko/quackd) | partial | python (3,230 TS/JS lines) | Apache-2.0 | public | train | 16 / 0 | 60738290 2026-09-19 | mostly python; only the TS/JS part (3230 lines) can be analyzed in Phase 1 |
| 14 | [OpenJev-SGLang](https://github.com/ekzhang/openjev-sglang) | needs_language | python (0 TS/JS lines) | none found | private | - | - / - | 604664a2 2026-09-18 | python project — needs python support (Phase 1 is TS/JS only); no open-source license found → stored fingerprint-only (private rules) |
| 15 | [Open-Jev](https://github.com/daseinlabs/open-jev) | needs_language | python (0 TS/JS lines) | none found | private | - | - / - | 8a4fbdf7 2026-09-18 | python project — needs python support (Phase 1 is TS/JS only); no open-source license found → stored fingerprint-only (private rules) |
| 16 | [System One](https://github.com/sgoedecke/system-one) | needs_language | python (0 TS/JS lines) | none found | private | - | - / - | ebde2a2d 2026-09-18 | python project — needs python support (Phase 1 is TS/JS only); no open-source license found → stored fingerprint-only (private rules) |
| 17 | [Jev Trader](https://github.com/jarrodwatts/jev-trader) | ready | ts (2,928 TS/JS lines) | MIT | public | train | 15 / 2 | b587759e 2026-09-16 | TS/JS project |
| 18 | [Switchboard](https://github.com/aniruddh-krovvidi/switchboard) | needs_language | python (0 TS/JS lines) | none found | private | - | - / - | 2c0ad919 2026-09-17 | python project — needs python support (Phase 1 is TS/JS only); no open-source license found → stored fingerprint-only (private rules) |
| 19 | routeKit | blocked | - (0 TS/JS lines) | - | - | - | - / - |   | no repository link given — need the URL |
| 20 | [tiershift](https://github.com/iamvatsalpatel/tiershift) | ready | ts (3,347 TS/JS lines) | MIT | public | train | 15 / 4 | 16a0826b 2026-09-17 | TS/JS project |
| 21 | [TypeSafe Migration Guard](https://github.com/opaielsheikh/typesafe-migration-guard) | ready | ts (1,158 TS/JS lines) | none found | private | train | 1 / 0 | 7f15597d 2026-09-17 | TS/JS project; no open-source license found → stored fingerprint-only (private rules) |
| 22 | [Jev Scout](https://github.com/AkashPriyadarshii/jev-scout) | needs_language | rust (0 TS/JS lines) | MIT | public | - | - / - | acae3926 2026-09-18 | rust project — needs rust support (Phase 1 is TS/JS only) |
| 23 | [Jev MCP (jkudish)](https://github.com/jkudish/jev-mcp) | ready | ts (3,243 TS/JS lines) | MIT | public | test | 14 / 2 | 67dd9fa5 2026-09-19 | TS/JS project |
| 24 | [Jev MCP (Blakestone)](https://github.com/blakestone-x/jev-mcp) | needs_language | python (0 TS/JS lines) | MIT | public | - | - / - | 59289a0b 2026-09-16 | python project — needs python support (Phase 1 is TS/JS only) |
| 25 | [Jevbridge](https://github.com/tacticocc/Jevbridge) | ready | ts (2,435 TS/JS lines) | MIT | public | test | 15 / 6 | 54c55875 2026-09-18 | TS/JS project |
| 26 | [Jev Moderation Bot](https://github.com/brainstormity/Jev-Moderation-Bot) | needs_language | python (0 TS/JS lines) | none found | private | - | - / - | 1629ac80 2026-09-18 | python project — needs python support (Phase 1 is TS/JS only); no open-source license found → stored fingerprint-only (private rules) |
| 27 | [JevLogs](https://github.com/reachjalil/jevlogs) | ready | ts (1,181 TS/JS lines) | MIT | public | train | 9 / 3 | b1ff6007 2026-09-17 | TS/JS project |
| 28 | [Commit Miner](https://github.com/devanshbatham/commit-miner) | partial | rust (364 TS/JS lines) | none found | private | train | 5 / 3 | 977617eb 2026-09-17 | mostly rust; only the TS/JS part (364 lines) can be analyzed in Phase 1; no open-source license found → stored fingerprint-only (private rules) |
| 29 | [Every](https://github.com/sufianetaouil/every) | needs_language | python (0 TS/JS lines) | MIT | public | - | - / - | aaa72d58 2026-09-17 | python project — needs python support (Phase 1 is TS/JS only) |
| 30 | [jgrep](https://github.com/keltokhy/jgrep) | needs_language | python (0 TS/JS lines) | MIT | public | - | - / - | bc0dc8dd 2026-09-19 | python project — needs python support (Phase 1 is TS/JS only) |

## Commands

```bash
pnpm corpus list                                     # this table, live (fetched? in dataset? labelled?)
pnpm corpus fetch --all                              # download the ready/partial projects to ~/jevx-corpus
pnpm corpus analyze jev-guard --gemini --validate    # one project, with Gemini + TypeSafe
pnpm corpus analyze jev-guard --openrouter --validate  # same, with OpenRouter as the code analyst
pnpm corpus analyze --all --gemini --validate        # all ready/partial projects
pnpm dev review jev-guard                            # label (private: add --root ~/jevx-corpus/<slug>)
pnpm dev dataset missed jev-guard src/x.ts:42 STRONG_JEV --reason "…"
pnpm dev dataset check
pnpm dev eval
```

## Non-Jev projects (later, ~30)

Candidates already tried in the cloud workspace, not saved: umami (analytics SaaS), chatbot-ui (AI chat app). Add them to `intake.json` with `status: "ready"` and a pinned commit.
