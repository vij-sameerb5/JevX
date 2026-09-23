# Decision Opportunity Dataset

> ⚠️ This describes the **P1 candidate dataset** (`projects/<slug>/entries.jsonl`, 616 entries from the corpus). In the current phase (M5b) it is the **pool of candidate / contrast decisions** (layers D/F in [docs/CURRENT-ARCHITECTURE.md](../docs/CURRENT-ARCHITECTURE.md) §8). It is not ground truth. Human labels are **optional** spot-checks, and nobody is labelling the 616 candidates. The M5b layers are stored separately in `boundary/<slug>/{usages,analyses,contrasts,runs}.jsonl` and `boundary/patterns.jsonl` (observed Jev usages, AI analyses, contrasts, run accounting, patterns). See §8 of CURRENT-ARCHITECTURE.

Human-labelled decisions from **real** projects. This is what JevX learns from and is measured
against. Synthetic examples never go here (the old 55 cases live in `regression/legacy-v1/`
as a regression suite only).

## Layout

```
dataset/
  dataset.json                 split seed + target ratios (60 / 20 / 20)
  TAXONOMY.md                  labels, decision categories, hard-negative reasons
  projects/<slug>/project.json visibility, split, frameworks, domains, analysis version
  projects/<slug>/entries.jsonl one decision per line (git-diffable)
```

## Public vs private

| | public (open source) | private (e.g. GlobalCare) |
| --- | --- | --- |
| source code | secret-scrubbed unit snippet (≤ 200 lines) | **never stored** |
| outcome values, matched literals, generator evidence | stored | **not stored** |
| file / function location, code hash, structural features | stored | stored |
| inputs | names + provenance + types | plain identifier names only, else `<expression>` |
| labels, reasoning, category, decision metadata | stored | stored |
| source URL / commit / license | stored | not stored |

`jevx dataset check` fails if a private entry carries code or literals, if public code contains
an unredacted secret, or if identical code sits in projects of different splits (leakage).
Secrets, API keys, tokens, passwords and env values are never stored in either kind.

To review a private project, point the TUI at the code on your disk:
`jevx review globalcare --root ~/code/globalcare`. The code is read locally for display only.

## Gemini evidence (M4)

`jevx analyze --gemini` adds a **code-analyst explanation**: what is decided, inputs, outcomes, whether the rule is exact, and whether it approximates a judgment. It is stored under `gemini` with `kind: "model_generated_evidence"`.

- It is **never** a label. It never writes `human`, never sets `auto`, and the policy doesn't use it. Its optional `model_hypothesis` is for debugging only.
- **Public projects:** the full analysis is stored, secret-scrubbed.
- **Adaptive context:** Gemini starts with the candidate's whole file and asks JevX for more (callees, callers, types, constants, folder, repo overview) until it can explain the decision. `facts.usable=false` means it still lacked context after expanding. Treat that as weak evidence; it isn't counted in agreement.
- **Public projects** also store `context.items`: the ids of what Gemini saw.
- **Private projects:** only `facts` are stored: decision type, exact yes/no, judgment yes/no, primitive, uncertainty, understanding confidence, usable, context rounds, context item count, counts, and the debug hypothesis. No free text and no context ids, because both could paraphrase or reveal private code. `jevx dataset check` fails if a private entry holds either.
- `jevx eval` shows Gemini-vs-human agreement as **information only**, never as a metric.

## OpenRouter evidence

`jevx analyze --openrouter` runs the **same** code analyst through OpenRouter (default model `x-ai/grok-4.6`). It uses the same prompt, schema and adaptive context. It is stored under `openrouter`, next to `gemini`, with `kind: "model_generated_evidence"` and `provider: "openrouter"`.

- The rules are the same as for Gemini: never a label, never `auto`, not used by the policy. Public entries store the scrubbed analysis plus context ids; private entries store `facts` only. `jevx dataset check` enforces this for both slots.
- Re-analyzing with only one provider keeps the other provider's evidence while the code is unchanged.
- `jevx eval` prints an informational side-by-side: TypeSafe, Gemini and OpenRouter each vs the human label, and Gemini vs OpenRouter. Nothing is tuned on it.

## Splits

- Assigned **per project**, never per example. A project is in exactly one of TRAIN / DEV / TEST.
- Default assignment is a deterministic hash of the project fingerprint + `splitSeed` (≈ 60 / 20 / 20).
  `--split train|dev|test` sets it manually on first save; it never changes silently after that.
- TEST projects are never used to write rules or tune thresholds.
- Cross-project checks: `jevx eval --rotate <seed>` re-assigns hash-split projects with another seed
  without touching stored splits.

## The loop

```bash
# 1. analyze a real project (offline) and save it
jevx analyze ~/code/some-oss-repo --save --public --project some-oss-repo \
  --source https://github.com/org/repo --commit <sha> --license MIT --domain devtools
jevx analyze ~/code/globalcare --save --private --project globalcare --domain fintech health

# 2. (optional) ask TypeSafe — sends unit code, secret-scrubbed; filtered candidates are never sent
jevx analyze ~/code/some-oss-repo --validate --save --public --project some-oss-repo

# 3. label (TUI), or one at a time
jevx review some-oss-repo
jevx label some-oss-repo 3fa2c1d0 STRONG_JEV --reason "routes tickets by meaning" --category routing

# 4. record decisions JevX did not propose (this is what makes recall measurable)
jevx dataset missed some-oss-repo src/queue.ts:88 STRONG_JEV --reason "escalation buried in a loop"

# 5. check and evaluate
jevx dataset check
jevx eval
```

Re-analyzing a project merges into the existing entries: labels are kept; if the code under a
label changed, the entry is flagged `needsRecheck` and excluded from metrics until re-labelled;
units that disappeared become `stale`.
