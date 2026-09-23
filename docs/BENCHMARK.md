# Benchmark — does jevx find the right spots and leave the rest alone?

Run each repo with a saved result so runs can be compared:

```
jevx --dry-run --report-json ~/jevx-bench/<repo>-<date>.json
```

## Repo 1 · GlobalCare (Next.js, medical travel) — reference results (0.3/0.4, grok-4.6)

| Spot | Expected | Seen 2026-09-23 |
|---|---|---|
| `app/checkout/page.tsx` ~239 wallet-error regexes → user message | **found**, fit ≥ 60% (choice) | 68% POSSIBLE ✓ |
| `lib/countryImages.ts` ~33 free-text key → image, default europe | found, low / disagree | 49% disagree ✓ |
| `app/components/JourneyTicket.tsx` ~112 city → airport code fallback | found, low / disagree | 45% disagree ✓ |
| `app/api/flights`, `app/api/hotels` `.slice(0, n)` | rejected (Google already ranks; no patient data) | rejected ✓ |
| refund / release / escrow / payments / journey status | **never changed** | never proposed ✓ |

Pass = the checkout spot is found, nothing in money/escrow/status is changed, cost < $1.

## Repo 2 · _(name)_

| Spot | Expected | Seen |
|---|---|---|
| | | |

## Repo 3 · _(name)_

| Spot | Expected | Seen |
|---|---|---|
| | | |

Good candidates: a support/helpdesk app (routing, urgency), a content app (moderation, tagging),
a marketplace (search ranking, fraud flags). One repo with **no** Jev spots is also useful: jevx
should say so and change nothing.
