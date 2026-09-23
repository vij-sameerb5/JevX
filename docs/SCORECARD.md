# How the JevX scorecard works — and why real apps rarely hit 70%

_Written 2026-09-23 after the first real MCP runs. Calibration data: `tests/fixtures/scorecard-calibration.json`,
checks: `tests/scorecard-calibration.test.ts`._

## The formula (`packages/engine/src/scorecard.ts`)

Three independent sources, each 0–1:

| Source | What it is |
| --- | --- |
| **Patterns** | For each of 8 features (ambiguity, context, …), is the reported level nearer what **7 real Jev sites** showed or what **4 deterministic decisions** showed? 1 / 0.5 / 0, averaged. Blended 50/50 with shared outcomes once a pattern has ≥ 5. |
| **AI** | The reading AI's own 0–1 score, now with a written rubric (0.9 real-Jev-like · 0.7 clear improvement · 0.5 plausible/small · 0.3 rules would do · 0.1 exact logic). |
| **TypeSafe** | Jev's own three answers: `bounded × (0.6 · judgment + 0.4 · (1 − exact code is right))`. |

**Combined** = plain average of the sources that are available. **Missing** sources are left out and named
("2 of 3 sources — typesafe unavailable"); nothing is filled in. **Disagreement**: if some sources are ≥ 50%
and others < 50%, the verdict is SOURCES DISAGREE regardless of the average. Otherwise ≥ 70% STRONG,
50–69% POSSIBLE, < 50% WEAK. Only STRONG is written by default; `--min-fit` (never < 50) is the user's call.

## What the real runs showed

| Spot (Next.js app, Claude Code + TypeSafe) | Patterns | AI | TypeSafe (old → new) | Fit (old → new) |
| --- | --- | --- | --- | --- |
| error-message classifier in a `catch` | 69% | 61% | 76% → 63% | 68% → 64% POSSIBLE |
| top-N flights from an API | 50% | 55% | 66% → 42% | 57% → 49% disagree |
| top-N hotels from an API | 50% | 45% | 67% → 44% | 54% → 46% disagree |
| free-text key → image, default | 38% | 55% | 55% → 28% | 49% → 40% disagree |
| chat stage from blocks | 38% | 30% | 57% → 32% | 42% → 33% weak |
| city → airport code fallback | 50% | 45% | 39% → 14% | 45% → 36% disagree |
| refund + money transfer (control) | 13% | 2% | 41% → 11% | 18% → 9% weak |
| status → colour map (control) | 0% | 3% | 62% → 39% | 22% → 14% weak |

And the 7 real Jev sites the profile comes from: patterns 88–100%; with an AI score of 0.8 they come out
**84–90% STRONG**. The 5 deterministic neighbours: patterns 0–13%, **WEAK**.

## Why real apps land at 33–68%

1. **The spots really are weaker than real Jev uses.** The real sites judge free text with high ambiguity
   (moderation, agent actions, review triage). The spots found in CRUD / payment / UI apps are mostly
   medium-ambiguity, low-risk, structured-data decisions — patterns puts them in between (38–69%), and
   **TypeSafe itself** answered "judgment needed" ≤ 0.26 for all but one.
2. **TypeSafe's "bounded" answer carried no information** (≈ 0.97 for 7 of 8, both controls included) but
   added a flat ~0.24–0.33 to every TypeSafe score. That produced a false positive (status→colour map 62%)
   and fake "sources disagree" flags. **Fixed**: bounded is now a gate, judgment decides.
3. **The AI was told to be conservative** ("0.4–0.6 for cosmetic, 0.8+ only when the rule clearly lets users
   down") without anchors for the bands. **Fixed**: an explicit 0.1–0.9 rubric tied to the verdict bands.
4. **A missing TypeSafe key** (the Claude Desktop test) removes the one source that can separate "bounded"
   from "needs judgment". The scan now says loudly when it isn't configured.
5. **The 70% bar was set by hand** (Session 27) before any benchmark. What supports it now: known Jev sites
   clear it, known deterministic code is far below it, and nothing observed that we'd call "exact logic"
   comes near it. It is **not** yet calibrated on known-good *new* opportunities in real apps — that needs
   more `--share` outcomes (kept vs undone).

## What we deliberately did not do

- Lower the threshold, force any spot above 70%, or hardcode repositories/functions.
- Let patterns dominate (it's one of three, and in-sample on 11 examples).
- Hide disagreement or pretend three sources when one is missing.

The error-message classifier (64–68%) is the one spot all three sources lean towards; `jevx --min-fit 60`
writes it if you want it, with your tests and `jevx undo` as the safety net.
