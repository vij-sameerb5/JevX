# JevX — Layer E: where and why Jev is used

_Hypotheses, not rules._ Every number below is counted from the stored records in `dataset/boundary/**`; nothing here is a score, a weight or a threshold.
A Jev call in the corpus shows that a developer **chose** Jev there — not that Jev was objectively right.
Deterministic code beside it shows a different implementation boundary — not that Jev would be wrong there.

Run `2026-09-20T18-48-01-353Z` · 2026-09-20T18:48:01.357Z · 6 project(s): jev-experiments, jev-guard, jev-review, jevlogs, tiershift, typesafe-migration-guard · excluded (TEST split): jev-browser, jev-mcp

| | |
| --- | --- |
| Jev usage analyses (usable) | 7 (7) |
| Contrasts analyzed / judged real decisions | 12 / 4 |
| Evidence groups | 21 |
| Wording | aggregated only — no model was used |

## What separates Jev decisions from the deterministic ones

### Jev sites show semantic_ambiguity = high (high 7) where the deterministic decisions beside them show none (none 3, high 1).

- **Category:** `semantic_ambiguity` · **strength:** cross_project · **confidence:** medium · **contested**
- **Wording:** JevX's own, from the counts
- **Counted from:** Levels recorded for semantic_ambiguity on 7 Jev usage record(s) and 4 contrast record(s) the analyst judged to be real decisions.
- **Projects supporting it:** 6 (jev-experiments, jev-guard, jev-review, jevlogs, tiershift, typesafe-migration-guard)
- **Supporting Jev usages (7):**
    - `C:jev-experiments:5dd716eaccf96e0e` — turbo-rerank/server/jev.ts:45 judgeBatch _(jev-experiments)_
    - `C:jev-experiments:f0913a1ef9d31262` — jev-firehose/eval.mjs:26 <Array.from callback@26> _(jev-experiments)_
    - `C:jev-guard:a05395c43badc9a6` — src/guard.js:149 scanContent _(jev-guard)_
    - `C:jev-review:c18419da63ab696b` — src/review/codebase-judgments.ts:39 screenSourceFile _(jev-review)_
    - `C:jevlogs:9bc7fe3d51758751` — src/index.ts:50 jevEvaluator _(jevlogs)_
    - `C:tiershift:1313e82fec02f37a` — src/signals.ts:141 askGate _(tiershift)_
    - `C:typesafe-migration-guard:b3ed9b3a68a5c6f2` — lib/typesafe.ts:37 evaluateMigrationSafety _(typesafe-migration-guard)_
- **Contrasting deterministic examples (3):**
    - `D:jev-experiments:5dd716eaccf96e0e:adab09c2` — turbo-rerank/server/jev.ts:96 describeError _(jev-experiments)_
    - `D:jev-experiments:f0913a1ef9d31262:e0714596` — jev-firehose/src/policy.ts:19 modReason _(jev-experiments)_
    - `D:jevlogs:9bc7fe3d51758751:09bd23c4` — src/index.ts:235 <Array.from callback@235> _(jevlogs)_
- **Counter-examples / conflicting evidence (1):**
    - `D:jev-experiments:f0913a1ef9d31262:d22d6610` — jev-firehose/src/jev.ts:123 heuristicJudgment _(jev-experiments)_
- **Unknowns:**
    - Why the developer chose Jev versus another classifier or model API.
    - How each caller acts on flagged (block, warn, store).
    - Whether regex or list-based scanners were tried and failed.
    - Real-world false-positive rates for this scan.
    - Why the author chose noul here versus linters or analyzers
- ⚠︎ Uniform on the Jev side: all 7 records carry high, so this cannot tell Jev sites apart from each other.

### Jev sites show context_dependence = high (high 4, medium 3) where the deterministic decisions beside them show low (low 2, none 2).

- **Category:** `context_dependence` · **strength:** cross_project · **confidence:** high
- **Wording:** JevX's own, from the counts
- **Counted from:** Levels recorded for context_dependence on 7 Jev usage record(s) and 4 contrast record(s) the analyst judged to be real decisions.
- **Projects supporting it:** 6 (jev-experiments, jev-guard, jev-review, jevlogs, tiershift, typesafe-migration-guard)
- **Supporting Jev usages (4):**
    - `C:jev-experiments:5dd716eaccf96e0e` — turbo-rerank/server/jev.ts:45 judgeBatch _(jev-experiments)_
    - `C:jev-experiments:f0913a1ef9d31262` — jev-firehose/eval.mjs:26 <Array.from callback@26> _(jev-experiments)_
    - `C:jev-review:c18419da63ab696b` — src/review/codebase-judgments.ts:39 screenSourceFile _(jev-review)_
    - `C:tiershift:1313e82fec02f37a` — src/signals.ts:141 askGate _(tiershift)_
- **Contrasting deterministic examples (2):**
    - `D:jev-experiments:f0913a1ef9d31262:d22d6610` — jev-firehose/src/jev.ts:123 heuristicJudgment _(jev-experiments)_
    - `D:jevlogs:9bc7fe3d51758751:09bd23c4` — src/index.ts:235 <Array.from callback@235> _(jevlogs)_
- **Counter-examples / conflicting evidence (0):**
    - none found in this data
- **Unknowns:**
    - Why the developer chose Jev versus another classifier or model API.
    - How each caller acts on flagged (block, warn, store).
    - Whether regex or list-based scanners were tried and failed.
    - Real-world false-positive rates for this scan.
    - Why the author chose noul here versus linters or analyzers

### Jev sites show deterministic_expressibility = low (low 6, medium 1) where the deterministic decisions beside them show high (high 3, low 1).

- **Category:** `deterministic_expressibility` · **strength:** cross_project · **confidence:** medium · **contested**
- **Wording:** JevX's own, from the counts
- **Counted from:** Levels recorded for deterministic_expressibility on 7 Jev usage record(s) and 4 contrast record(s) the analyst judged to be real decisions.
- **Projects supporting it:** 6 (jev-experiments, jev-guard, jev-review, jevlogs, tiershift, typesafe-migration-guard)
- **Supporting Jev usages (6):**
    - `C:jev-experiments:5dd716eaccf96e0e` — turbo-rerank/server/jev.ts:45 judgeBatch _(jev-experiments)_
    - `C:jev-experiments:f0913a1ef9d31262` — jev-firehose/eval.mjs:26 <Array.from callback@26> _(jev-experiments)_
    - `C:jev-guard:a05395c43badc9a6` — src/guard.js:149 scanContent _(jev-guard)_
    - `C:jev-review:c18419da63ab696b` — src/review/codebase-judgments.ts:39 screenSourceFile _(jev-review)_
    - `C:jevlogs:9bc7fe3d51758751` — src/index.ts:50 jevEvaluator _(jevlogs)_
    - `C:tiershift:1313e82fec02f37a` — src/signals.ts:141 askGate _(tiershift)_
- **Contrasting deterministic examples (3):**
    - `D:jev-experiments:5dd716eaccf96e0e:adab09c2` — turbo-rerank/server/jev.ts:96 describeError _(jev-experiments)_
    - `D:jev-experiments:f0913a1ef9d31262:e0714596` — jev-firehose/src/policy.ts:19 modReason _(jev-experiments)_
    - `D:jevlogs:9bc7fe3d51758751:09bd23c4` — src/index.ts:235 <Array.from callback@235> _(jevlogs)_
- **Counter-examples / conflicting evidence (1):**
    - `D:jev-experiments:f0913a1ef9d31262:d22d6610` — jev-firehose/src/jev.ts:123 heuristicJudgment _(jev-experiments)_
- **Unknowns:**
    - Why the developer chose Jev versus another classifier or model API.
    - How each caller acts on flagged (block, warn, store).
    - Whether regex or list-based scanners were tried and failed.
    - Real-world false-positive rates for this scan.
    - Why the author chose noul here versus linters or analyzers

### Jev sites show judgment_required = high (high 7) where the deterministic decisions beside them show none (none 3, high 1).

- **Category:** `judgment_required` · **strength:** cross_project · **confidence:** medium · **contested**
- **Wording:** JevX's own, from the counts
- **Counted from:** Levels recorded for judgment_required on 7 Jev usage record(s) and 4 contrast record(s) the analyst judged to be real decisions.
- **Projects supporting it:** 6 (jev-experiments, jev-guard, jev-review, jevlogs, tiershift, typesafe-migration-guard)
- **Supporting Jev usages (7):**
    - `C:jev-experiments:5dd716eaccf96e0e` — turbo-rerank/server/jev.ts:45 judgeBatch _(jev-experiments)_
    - `C:jev-experiments:f0913a1ef9d31262` — jev-firehose/eval.mjs:26 <Array.from callback@26> _(jev-experiments)_
    - `C:jev-guard:a05395c43badc9a6` — src/guard.js:149 scanContent _(jev-guard)_
    - `C:jev-review:c18419da63ab696b` — src/review/codebase-judgments.ts:39 screenSourceFile _(jev-review)_
    - `C:jevlogs:9bc7fe3d51758751` — src/index.ts:50 jevEvaluator _(jevlogs)_
    - `C:tiershift:1313e82fec02f37a` — src/signals.ts:141 askGate _(tiershift)_
    - `C:typesafe-migration-guard:b3ed9b3a68a5c6f2` — lib/typesafe.ts:37 evaluateMigrationSafety _(typesafe-migration-guard)_
- **Contrasting deterministic examples (3):**
    - `D:jev-experiments:5dd716eaccf96e0e:adab09c2` — turbo-rerank/server/jev.ts:96 describeError _(jev-experiments)_
    - `D:jev-experiments:f0913a1ef9d31262:e0714596` — jev-firehose/src/policy.ts:19 modReason _(jev-experiments)_
    - `D:jevlogs:9bc7fe3d51758751:09bd23c4` — src/index.ts:235 <Array.from callback@235> _(jevlogs)_
- **Counter-examples / conflicting evidence (1):**
    - `D:jev-experiments:f0913a1ef9d31262:d22d6610` — jev-firehose/src/jev.ts:123 heuristicJudgment _(jev-experiments)_
- **Unknowns:**
    - Why the developer chose Jev versus another classifier or model API.
    - How each caller acts on flagged (block, warn, store).
    - Whether regex or list-based scanners were tried and failed.
    - Real-world false-positive rates for this scan.
    - Why the author chose noul here versus linters or analyzers
- ⚠︎ Uniform on the Jev side: all 7 records carry high, so this cannot tell Jev sites apart from each other.

### Jev sites show rule_stability = low (low 5, medium 2) where the deterministic decisions beside them show high (high 3, low 1).

- **Category:** `rule_stability` · **strength:** cross_project · **confidence:** medium · **contested**
- **Wording:** JevX's own, from the counts
- **Counted from:** Levels recorded for rule_stability on 7 Jev usage record(s) and 4 contrast record(s) the analyst judged to be real decisions.
- **Projects supporting it:** 6 (jev-experiments, jev-guard, jev-review, jevlogs, tiershift, typesafe-migration-guard)
- **Supporting Jev usages (5):**
    - `C:jev-experiments:5dd716eaccf96e0e` — turbo-rerank/server/jev.ts:45 judgeBatch _(jev-experiments)_
    - `C:jev-guard:a05395c43badc9a6` — src/guard.js:149 scanContent _(jev-guard)_
    - `C:jev-review:c18419da63ab696b` — src/review/codebase-judgments.ts:39 screenSourceFile _(jev-review)_
    - `C:jevlogs:9bc7fe3d51758751` — src/index.ts:50 jevEvaluator _(jevlogs)_
    - `C:tiershift:1313e82fec02f37a` — src/signals.ts:141 askGate _(tiershift)_
- **Contrasting deterministic examples (3):**
    - `D:jev-experiments:5dd716eaccf96e0e:adab09c2` — turbo-rerank/server/jev.ts:96 describeError _(jev-experiments)_
    - `D:jev-experiments:f0913a1ef9d31262:e0714596` — jev-firehose/src/policy.ts:19 modReason _(jev-experiments)_
    - `D:jevlogs:9bc7fe3d51758751:09bd23c4` — src/index.ts:235 <Array.from callback@235> _(jevlogs)_
- **Counter-examples / conflicting evidence (1):**
    - `D:jev-experiments:f0913a1ef9d31262:d22d6610` — jev-firehose/src/jev.ts:123 heuristicJudgment _(jev-experiments)_
- **Unknowns:**
    - Why the developer chose Jev versus another classifier or model API.
    - How each caller acts on flagged (block, warn, store).
    - Whether regex or list-based scanners were tried and failed.
    - Real-world false-positive rates for this scan.
    - Why the author chose noul here versus linters or analyzers

### Jev sites show risk_or_policy_component = high (high 5, none 2) where the deterministic decisions beside them show low (low 2, high 1, medium 1).

- **Category:** `risk_or_policy_component` · **strength:** cross_project · **confidence:** medium · **contested**
- **Wording:** JevX's own, from the counts
- **Counted from:** Levels recorded for risk_or_policy_component on 7 Jev usage record(s) and 4 contrast record(s) the analyst judged to be real decisions.
- **Projects supporting it:** 6 (jev-experiments, jev-guard, jev-review, jevlogs, tiershift, typesafe-migration-guard)
- **Supporting Jev usages (5):**
    - `C:jev-experiments:f0913a1ef9d31262` — jev-firehose/eval.mjs:26 <Array.from callback@26> _(jev-experiments)_
    - `C:jev-guard:a05395c43badc9a6` — src/guard.js:149 scanContent _(jev-guard)_
    - `C:jev-review:c18419da63ab696b` — src/review/codebase-judgments.ts:39 screenSourceFile _(jev-review)_
    - `C:jevlogs:9bc7fe3d51758751` — src/index.ts:50 jevEvaluator _(jevlogs)_
    - `C:typesafe-migration-guard:b3ed9b3a68a5c6f2` — lib/typesafe.ts:37 evaluateMigrationSafety _(typesafe-migration-guard)_
- **Contrasting deterministic examples (2):**
    - `D:jev-experiments:5dd716eaccf96e0e:adab09c2` — turbo-rerank/server/jev.ts:96 describeError _(jev-experiments)_
    - `D:jevlogs:9bc7fe3d51758751:09bd23c4` — src/index.ts:235 <Array.from callback@235> _(jevlogs)_
- **Counter-examples / conflicting evidence (1):**
    - `D:jev-experiments:f0913a1ef9d31262:d22d6610` — jev-firehose/src/jev.ts:123 heuristicJudgment _(jev-experiments)_
- **Unknowns:**
    - Why the developer chose Jev versus another classifier or model API.
    - How each caller acts on flagged (block, warn, store).
    - Whether regex or list-based scanners were tried and failed.
    - Real-world false-positive rates for this scan.
    - Why the author chose noul here versus linters or analyzers

### Jev sites show natural_language_understanding = high (high 5, medium 2) where the deterministic decisions beside them show none (none 3, high 1).

- **Category:** `natural_language_understanding` · **strength:** cross_project · **confidence:** medium · **contested**
- **Wording:** JevX's own, from the counts
- **Counted from:** Levels recorded for natural_language_understanding on 7 Jev usage record(s) and 4 contrast record(s) the analyst judged to be real decisions.
- **Projects supporting it:** 6 (jev-experiments, jev-guard, jev-review, jevlogs, tiershift, typesafe-migration-guard)
- **Supporting Jev usages (5):**
    - `C:jev-experiments:5dd716eaccf96e0e` — turbo-rerank/server/jev.ts:45 judgeBatch _(jev-experiments)_
    - `C:jev-experiments:f0913a1ef9d31262` — jev-firehose/eval.mjs:26 <Array.from callback@26> _(jev-experiments)_
    - `C:jev-guard:a05395c43badc9a6` — src/guard.js:149 scanContent _(jev-guard)_
    - `C:jevlogs:9bc7fe3d51758751` — src/index.ts:50 jevEvaluator _(jevlogs)_
    - `C:tiershift:1313e82fec02f37a` — src/signals.ts:141 askGate _(tiershift)_
- **Contrasting deterministic examples (3):**
    - `D:jev-experiments:5dd716eaccf96e0e:adab09c2` — turbo-rerank/server/jev.ts:96 describeError _(jev-experiments)_
    - `D:jev-experiments:f0913a1ef9d31262:e0714596` — jev-firehose/src/policy.ts:19 modReason _(jev-experiments)_
    - `D:jevlogs:9bc7fe3d51758751:09bd23c4` — src/index.ts:235 <Array.from callback@235> _(jevlogs)_
- **Counter-examples / conflicting evidence (1):**
    - `D:jev-experiments:f0913a1ef9d31262:d22d6610` — jev-firehose/src/jev.ts:123 heuristicJudgment _(jev-experiments)_
- **Unknowns:**
    - Why the developer chose Jev versus another classifier or model API.
    - How each caller acts on flagged (block, warn, store).
    - Whether regex or list-based scanners were tried and failed.
    - Real-world false-positive rates for this scan.
    - Why the author chose noul here versus linters or analyzers

### Jev sites show decision_complexity = medium (medium 7) where the deterministic decisions beside them show low (low 3, medium 1).

- **Category:** `decision_complexity` · **strength:** cross_project · **confidence:** medium · **contested**
- **Wording:** JevX's own, from the counts
- **Counted from:** Levels recorded for decision_complexity on 7 Jev usage record(s) and 4 contrast record(s) the analyst judged to be real decisions.
- **Projects supporting it:** 6 (jev-experiments, jev-guard, jev-review, jevlogs, tiershift, typesafe-migration-guard)
- **Supporting Jev usages (7):**
    - `C:jev-experiments:5dd716eaccf96e0e` — turbo-rerank/server/jev.ts:45 judgeBatch _(jev-experiments)_
    - `C:jev-experiments:f0913a1ef9d31262` — jev-firehose/eval.mjs:26 <Array.from callback@26> _(jev-experiments)_
    - `C:jev-guard:a05395c43badc9a6` — src/guard.js:149 scanContent _(jev-guard)_
    - `C:jev-review:c18419da63ab696b` — src/review/codebase-judgments.ts:39 screenSourceFile _(jev-review)_
    - `C:jevlogs:9bc7fe3d51758751` — src/index.ts:50 jevEvaluator _(jevlogs)_
    - `C:tiershift:1313e82fec02f37a` — src/signals.ts:141 askGate _(tiershift)_
    - `C:typesafe-migration-guard:b3ed9b3a68a5c6f2` — lib/typesafe.ts:37 evaluateMigrationSafety _(typesafe-migration-guard)_
- **Contrasting deterministic examples (3):**
    - `D:jev-experiments:5dd716eaccf96e0e:adab09c2` — turbo-rerank/server/jev.ts:96 describeError _(jev-experiments)_
    - `D:jev-experiments:f0913a1ef9d31262:e0714596` — jev-firehose/src/policy.ts:19 modReason _(jev-experiments)_
    - `D:jevlogs:9bc7fe3d51758751:09bd23c4` — src/index.ts:235 <Array.from callback@235> _(jevlogs)_
- **Counter-examples / conflicting evidence (1):**
    - `D:jev-experiments:f0913a1ef9d31262:d22d6610` — jev-firehose/src/jev.ts:123 heuristicJudgment _(jev-experiments)_
- **Unknowns:**
    - Why the developer chose Jev versus another classifier or model API.
    - How each caller acts on flagged (block, warn, store).
    - Whether regex or list-based scanners were tried and failed.
    - Real-world false-positive rates for this scan.
    - Why the author chose noul here versus linters or analyzers
- ⚠︎ Uniform on the Jev side: all 7 records carry medium, so this cannot tell Jev sites apart from each other.

### Jev sites are recorded as semantic_judgment 6, mixed 1; the deterministic decisions beside them as exact_rule 3, mixed 1.

- **Category:** `exact_rules_vs_semantic_interpretation` · **strength:** cross_project · **confidence:** medium · **contested**
- **Wording:** JevX's own, from the counts
- **Counted from:** The decision nature recorded for 7 Jev usage record(s) and 4 real-decision contrast record(s), plus whether each contrast was said to share the Jev site's traits.
- **Projects supporting it:** 6 (jev-experiments, jev-guard, jev-review, jevlogs, tiershift, typesafe-migration-guard)
- **Supporting Jev usages (6):**
    - `C:jev-experiments:5dd716eaccf96e0e` — turbo-rerank/server/jev.ts:45 judgeBatch _(jev-experiments)_
    - `C:jev-experiments:f0913a1ef9d31262` — jev-firehose/eval.mjs:26 <Array.from callback@26> _(jev-experiments)_
    - `C:jev-review:c18419da63ab696b` — src/review/codebase-judgments.ts:39 screenSourceFile _(jev-review)_
    - `C:jevlogs:9bc7fe3d51758751` — src/index.ts:50 jevEvaluator _(jevlogs)_
    - `C:tiershift:1313e82fec02f37a` — src/signals.ts:141 askGate _(tiershift)_
    - `C:typesafe-migration-guard:b3ed9b3a68a5c6f2` — lib/typesafe.ts:37 evaluateMigrationSafety _(typesafe-migration-guard)_
- **Contrasting deterministic examples (3):**
    - `D:jev-experiments:5dd716eaccf96e0e:adab09c2` — turbo-rerank/server/jev.ts:96 describeError _(jev-experiments)_
    - `D:jev-experiments:f0913a1ef9d31262:e0714596` — jev-firehose/src/policy.ts:19 modReason _(jev-experiments)_
    - `D:jevlogs:9bc7fe3d51758751:09bd23c4` — src/index.ts:235 <Array.from callback@235> _(jevlogs)_
- **Counter-examples / conflicting evidence (1):**
    - `D:jev-experiments:f0913a1ef9d31262:d22d6610` — jev-firehose/src/jev.ts:123 heuristicJudgment _(jev-experiments)_
- **Unknowns:**
    - Why the developer chose Jev versus another classifier or model API.
    - How each caller acts on flagged (block, warn, store).
    - Whether regex or list-based scanners were tried and failed.
    - Real-world false-positive rates for this scan.
    - Why the author chose noul here versus linters or analyzers
- ⚠︎ 1 contrast(s) were judged to share the Jev site's traits — deterministic code that looks like a Jev candidate.

## Recorded on the Jev side only (describes Jev sites; separates nothing yet)

### "semantic_interpretation" is supported at 7 of 7 analyzed Jev sites.

- **Category:** `semantic_ambiguity` · **strength:** cross_project · **confidence:** low
- **Wording:** JevX's own, from the counts
- **Counted from:** The analyst's assessment of the hypothesis "semantic_interpretation" at 7 Jev usage record(s). Assessed on Jev sites only — never on the deterministic side.
- **Projects supporting it:** 6 (jev-experiments, jev-guard, jev-review, jevlogs, tiershift, typesafe-migration-guard)
- **Supporting Jev usages (7):**
    - `C:jev-experiments:5dd716eaccf96e0e` — turbo-rerank/server/jev.ts:45 judgeBatch _(jev-experiments)_
    - `C:jev-experiments:f0913a1ef9d31262` — jev-firehose/eval.mjs:26 <Array.from callback@26> _(jev-experiments)_
    - `C:jev-guard:a05395c43badc9a6` — src/guard.js:149 scanContent _(jev-guard)_
    - `C:jev-review:c18419da63ab696b` — src/review/codebase-judgments.ts:39 screenSourceFile _(jev-review)_
    - `C:jevlogs:9bc7fe3d51758751` — src/index.ts:50 jevEvaluator _(jevlogs)_
    - `C:tiershift:1313e82fec02f37a` — src/signals.ts:141 askGate _(tiershift)_
    - `C:typesafe-migration-guard:b3ed9b3a68a5c6f2` — lib/typesafe.ts:37 evaluateMigrationSafety _(typesafe-migration-guard)_
- **Contrasting deterministic examples (0):**
    - none
- **Counter-examples / conflicting evidence (0):**
    - none found in this data
- **Unknowns:**
    - Why the developer chose Jev versus another classifier or model API.
    - How each caller acts on flagged (block, warn, store).
    - Whether regex or list-based scanners were tried and failed.
    - Real-world false-positive rates for this scan.
    - Why the author chose noul here versus linters or analyzers
- ⚠︎ The same hypothesis was never assessed on the deterministic contrasts, so a high count does not show it separates Jev code from exact code.
- ⚠︎ Supported at every one of the 7 sites; a judgment that never varies may reflect the analyst's prior as much as the code.

### "ambiguous_natural_language_or_context" is supported at 7 of 7 analyzed Jev sites.

- **Category:** `natural_language_understanding` · **strength:** cross_project · **confidence:** low
- **Wording:** JevX's own, from the counts
- **Counted from:** The analyst's assessment of the hypothesis "ambiguous_natural_language_or_context" at 7 Jev usage record(s). Assessed on Jev sites only — never on the deterministic side.
- **Projects supporting it:** 6 (jev-experiments, jev-guard, jev-review, jevlogs, tiershift, typesafe-migration-guard)
- **Supporting Jev usages (7):**
    - `C:jev-experiments:5dd716eaccf96e0e` — turbo-rerank/server/jev.ts:45 judgeBatch _(jev-experiments)_
    - `C:jev-experiments:f0913a1ef9d31262` — jev-firehose/eval.mjs:26 <Array.from callback@26> _(jev-experiments)_
    - `C:jev-guard:a05395c43badc9a6` — src/guard.js:149 scanContent _(jev-guard)_
    - `C:jev-review:c18419da63ab696b` — src/review/codebase-judgments.ts:39 screenSourceFile _(jev-review)_
    - `C:jevlogs:9bc7fe3d51758751` — src/index.ts:50 jevEvaluator _(jevlogs)_
    - `C:tiershift:1313e82fec02f37a` — src/signals.ts:141 askGate _(tiershift)_
    - `C:typesafe-migration-guard:b3ed9b3a68a5c6f2` — lib/typesafe.ts:37 evaluateMigrationSafety _(typesafe-migration-guard)_
- **Contrasting deterministic examples (0):**
    - none
- **Counter-examples / conflicting evidence (0):**
    - none found in this data
- **Unknowns:**
    - Why the developer chose Jev versus another classifier or model API.
    - How each caller acts on flagged (block, warn, store).
    - Whether regex or list-based scanners were tried and failed.
    - Real-world false-positive rates for this scan.
    - Why the author chose noul here versus linters or analyzers
- ⚠︎ The same hypothesis was never assessed on the deterministic contrasts, so a high count does not show it separates Jev code from exact code.
- ⚠︎ Supported at every one of the 7 sites; a judgment that never varies may reflect the analyst's prior as much as the code.

### "multiple_competing_outcomes" is supported at 7 of 7 analyzed Jev sites.

- **Category:** `open_vs_closed_outcomes` · **strength:** cross_project · **confidence:** low
- **Wording:** JevX's own, from the counts
- **Counted from:** The analyst's assessment of the hypothesis "multiple_competing_outcomes" at 7 Jev usage record(s). Assessed on Jev sites only — never on the deterministic side.
- **Projects supporting it:** 6 (jev-experiments, jev-guard, jev-review, jevlogs, tiershift, typesafe-migration-guard)
- **Supporting Jev usages (7):**
    - `C:jev-experiments:5dd716eaccf96e0e` — turbo-rerank/server/jev.ts:45 judgeBatch _(jev-experiments)_
    - `C:jev-experiments:f0913a1ef9d31262` — jev-firehose/eval.mjs:26 <Array.from callback@26> _(jev-experiments)_
    - `C:jev-guard:a05395c43badc9a6` — src/guard.js:149 scanContent _(jev-guard)_
    - `C:jev-review:c18419da63ab696b` — src/review/codebase-judgments.ts:39 screenSourceFile _(jev-review)_
    - `C:jevlogs:9bc7fe3d51758751` — src/index.ts:50 jevEvaluator _(jevlogs)_
    - `C:tiershift:1313e82fec02f37a` — src/signals.ts:141 askGate _(tiershift)_
    - `C:typesafe-migration-guard:b3ed9b3a68a5c6f2` — lib/typesafe.ts:37 evaluateMigrationSafety _(typesafe-migration-guard)_
- **Contrasting deterministic examples (0):**
    - none
- **Counter-examples / conflicting evidence (0):**
    - none found in this data
- **Unknowns:**
    - Why the developer chose Jev versus another classifier or model API.
    - How each caller acts on flagged (block, warn, store).
    - Whether regex or list-based scanners were tried and failed.
    - Real-world false-positive rates for this scan.
    - Why the author chose noul here versus linters or analyzers
- ⚠︎ The same hypothesis was never assessed on the deterministic contrasts, so a high count does not show it separates Jev code from exact code.
- ⚠︎ Supported at every one of the 7 sites; a judgment that never varies may reflect the analyst's prior as much as the code.

### "judgment_not_computation" is supported at 7 of 7 analyzed Jev sites.

- **Category:** `judgment_required` · **strength:** cross_project · **confidence:** low
- **Wording:** JevX's own, from the counts
- **Counted from:** The analyst's assessment of the hypothesis "judgment_not_computation" at 7 Jev usage record(s). Assessed on Jev sites only — never on the deterministic side.
- **Projects supporting it:** 6 (jev-experiments, jev-guard, jev-review, jevlogs, tiershift, typesafe-migration-guard)
- **Supporting Jev usages (7):**
    - `C:jev-experiments:5dd716eaccf96e0e` — turbo-rerank/server/jev.ts:45 judgeBatch _(jev-experiments)_
    - `C:jev-experiments:f0913a1ef9d31262` — jev-firehose/eval.mjs:26 <Array.from callback@26> _(jev-experiments)_
    - `C:jev-guard:a05395c43badc9a6` — src/guard.js:149 scanContent _(jev-guard)_
    - `C:jev-review:c18419da63ab696b` — src/review/codebase-judgments.ts:39 screenSourceFile _(jev-review)_
    - `C:jevlogs:9bc7fe3d51758751` — src/index.ts:50 jevEvaluator _(jevlogs)_
    - `C:tiershift:1313e82fec02f37a` — src/signals.ts:141 askGate _(tiershift)_
    - `C:typesafe-migration-guard:b3ed9b3a68a5c6f2` — lib/typesafe.ts:37 evaluateMigrationSafety _(typesafe-migration-guard)_
- **Contrasting deterministic examples (0):**
    - none
- **Counter-examples / conflicting evidence (0):**
    - none found in this data
- **Unknowns:**
    - Why the developer chose Jev versus another classifier or model API.
    - How each caller acts on flagged (block, warn, store).
    - Whether regex or list-based scanners were tried and failed.
    - Real-world false-positive rates for this scan.
    - Why the author chose noul here versus linters or analyzers
- ⚠︎ The same hypothesis was never assessed on the deterministic contrasts, so a high count does not show it separates Jev code from exact code.
- ⚠︎ Supported at every one of the 7 sites; a judgment that never varies may reflect the analyst's prior as much as the code.

### "policy_interpretation" is supported at 5 of 7 analyzed Jev sites, and contradicted at 2.

- **Category:** `risk_or_policy_component` · **strength:** cross_project · **confidence:** low · **contested**
- **Wording:** JevX's own, from the counts
- **Counted from:** The analyst's assessment of the hypothesis "policy_interpretation" at 7 Jev usage record(s). Assessed on Jev sites only — never on the deterministic side.
- **Projects supporting it:** 5 (jev-experiments, jev-guard, jev-review, jevlogs, typesafe-migration-guard)
- **Supporting Jev usages (5):**
    - `C:jev-experiments:f0913a1ef9d31262` — jev-firehose/eval.mjs:26 <Array.from callback@26> _(jev-experiments)_
    - `C:jev-guard:a05395c43badc9a6` — src/guard.js:149 scanContent _(jev-guard)_
    - `C:jev-review:c18419da63ab696b` — src/review/codebase-judgments.ts:39 screenSourceFile _(jev-review)_
    - `C:jevlogs:9bc7fe3d51758751` — src/index.ts:50 jevEvaluator _(jevlogs)_
    - `C:typesafe-migration-guard:b3ed9b3a68a5c6f2` — lib/typesafe.ts:37 evaluateMigrationSafety _(typesafe-migration-guard)_
- **Contrasting deterministic examples (0):**
    - none
- **Counter-examples / conflicting evidence (2):**
    - `C:jev-experiments:5dd716eaccf96e0e` — turbo-rerank/server/jev.ts:45 judgeBatch _(jev-experiments)_
    - `C:tiershift:1313e82fec02f37a` — src/signals.ts:141 askGate _(tiershift)_
- **Unknowns:**
    - Why the developer chose Jev versus another classifier or model API.
    - How each caller acts on flagged (block, warn, store).
    - Whether regex or list-based scanners were tried and failed.
    - Real-world false-positive rates for this scan.
    - Why the author chose noul here versus linters or analyzers
- ⚠︎ The same hypothesis was never assessed on the deterministic contrasts, so a high count does not show it separates Jev code from exact code.

### "risk_assessment" is supported at 5 of 7 analyzed Jev sites, and contradicted at 2.

- **Category:** `risk_or_policy_component` · **strength:** cross_project · **confidence:** low · **contested**
- **Wording:** JevX's own, from the counts
- **Counted from:** The analyst's assessment of the hypothesis "risk_assessment" at 7 Jev usage record(s). Assessed on Jev sites only — never on the deterministic side.
- **Projects supporting it:** 5 (jev-experiments, jev-guard, jev-review, jevlogs, typesafe-migration-guard)
- **Supporting Jev usages (5):**
    - `C:jev-experiments:f0913a1ef9d31262` — jev-firehose/eval.mjs:26 <Array.from callback@26> _(jev-experiments)_
    - `C:jev-guard:a05395c43badc9a6` — src/guard.js:149 scanContent _(jev-guard)_
    - `C:jev-review:c18419da63ab696b` — src/review/codebase-judgments.ts:39 screenSourceFile _(jev-review)_
    - `C:jevlogs:9bc7fe3d51758751` — src/index.ts:50 jevEvaluator _(jevlogs)_
    - `C:typesafe-migration-guard:b3ed9b3a68a5c6f2` — lib/typesafe.ts:37 evaluateMigrationSafety _(typesafe-migration-guard)_
- **Contrasting deterministic examples (0):**
    - none
- **Counter-examples / conflicting evidence (2):**
    - `C:jev-experiments:5dd716eaccf96e0e` — turbo-rerank/server/jev.ts:45 judgeBatch _(jev-experiments)_
    - `C:tiershift:1313e82fec02f37a` — src/signals.ts:141 askGate _(tiershift)_
- **Unknowns:**
    - Why the developer chose Jev versus another classifier or model API.
    - How each caller acts on flagged (block, warn, store).
    - Whether regex or list-based scanners were tried and failed.
    - Real-world false-positive rates for this scan.
    - Why the author chose noul here versus linters or analyzers
- ⚠︎ The same hypothesis was never assessed on the deterministic contrasts, so a high count does not show it separates Jev code from exact code.

### "classification_requiring_context" is supported at 7 of 7 analyzed Jev sites.

- **Category:** `context_dependence` · **strength:** cross_project · **confidence:** low
- **Wording:** JevX's own, from the counts
- **Counted from:** The analyst's assessment of the hypothesis "classification_requiring_context" at 7 Jev usage record(s). Assessed on Jev sites only — never on the deterministic side.
- **Projects supporting it:** 6 (jev-experiments, jev-guard, jev-review, jevlogs, tiershift, typesafe-migration-guard)
- **Supporting Jev usages (7):**
    - `C:jev-experiments:5dd716eaccf96e0e` — turbo-rerank/server/jev.ts:45 judgeBatch _(jev-experiments)_
    - `C:jev-experiments:f0913a1ef9d31262` — jev-firehose/eval.mjs:26 <Array.from callback@26> _(jev-experiments)_
    - `C:jev-guard:a05395c43badc9a6` — src/guard.js:149 scanContent _(jev-guard)_
    - `C:jev-review:c18419da63ab696b` — src/review/codebase-judgments.ts:39 screenSourceFile _(jev-review)_
    - `C:jevlogs:9bc7fe3d51758751` — src/index.ts:50 jevEvaluator _(jevlogs)_
    - `C:tiershift:1313e82fec02f37a` — src/signals.ts:141 askGate _(tiershift)_
    - `C:typesafe-migration-guard:b3ed9b3a68a5c6f2` — lib/typesafe.ts:37 evaluateMigrationSafety _(typesafe-migration-guard)_
- **Contrasting deterministic examples (0):**
    - none
- **Counter-examples / conflicting evidence (0):**
    - none found in this data
- **Unknowns:**
    - Why the developer chose Jev versus another classifier or model API.
    - How each caller acts on flagged (block, warn, store).
    - Whether regex or list-based scanners were tried and failed.
    - Real-world false-positive rates for this scan.
    - Why the author chose noul here versus linters or analyzers
- ⚠︎ The same hypothesis was never assessed on the deterministic contrasts, so a high count does not show it separates Jev code from exact code.
- ⚠︎ Supported at every one of the 7 sites; a judgment that never varies may reflect the analyst's prior as much as the code.

### "hard_to_encode_as_rules" is supported at 7 of 7 analyzed Jev sites.

- **Category:** `deterministic_expressibility` · **strength:** cross_project · **confidence:** low
- **Wording:** JevX's own, from the counts
- **Counted from:** The analyst's assessment of the hypothesis "hard_to_encode_as_rules" at 7 Jev usage record(s). Assessed on Jev sites only — never on the deterministic side.
- **Projects supporting it:** 6 (jev-experiments, jev-guard, jev-review, jevlogs, tiershift, typesafe-migration-guard)
- **Supporting Jev usages (7):**
    - `C:jev-experiments:5dd716eaccf96e0e` — turbo-rerank/server/jev.ts:45 judgeBatch _(jev-experiments)_
    - `C:jev-experiments:f0913a1ef9d31262` — jev-firehose/eval.mjs:26 <Array.from callback@26> _(jev-experiments)_
    - `C:jev-guard:a05395c43badc9a6` — src/guard.js:149 scanContent _(jev-guard)_
    - `C:jev-review:c18419da63ab696b` — src/review/codebase-judgments.ts:39 screenSourceFile _(jev-review)_
    - `C:jevlogs:9bc7fe3d51758751` — src/index.ts:50 jevEvaluator _(jevlogs)_
    - `C:tiershift:1313e82fec02f37a` — src/signals.ts:141 askGate _(tiershift)_
    - `C:typesafe-migration-guard:b3ed9b3a68a5c6f2` — lib/typesafe.ts:37 evaluateMigrationSafety _(typesafe-migration-guard)_
- **Contrasting deterministic examples (0):**
    - none
- **Counter-examples / conflicting evidence (0):**
    - none found in this data
- **Unknowns:**
    - Why the developer chose Jev versus another classifier or model API.
    - How each caller acts on flagged (block, warn, store).
    - Whether regex or list-based scanners were tried and failed.
    - Real-world false-positive rates for this scan.
    - Why the author chose noul here versus linters or analyzers
- ⚠︎ The same hypothesis was never assessed on the deterministic contrasts, so a high count does not show it separates Jev code from exact code.
- ⚠︎ Supported at every one of the 7 sites; a judgment that never varies may reflect the analyst's prior as much as the code.

### "soft_or_changing_rules" is supported at 5 of 7 analyzed Jev sites.

- **Category:** `rule_stability` · **strength:** cross_project · **confidence:** low
- **Wording:** JevX's own, from the counts
- **Counted from:** The analyst's assessment of the hypothesis "soft_or_changing_rules" at 7 Jev usage record(s). Assessed on Jev sites only — never on the deterministic side.
- **Projects supporting it:** 4 (jev-experiments, jev-guard, jev-review, jevlogs)
- **Supporting Jev usages (5):**
    - `C:jev-experiments:5dd716eaccf96e0e` — turbo-rerank/server/jev.ts:45 judgeBatch _(jev-experiments)_
    - `C:jev-experiments:f0913a1ef9d31262` — jev-firehose/eval.mjs:26 <Array.from callback@26> _(jev-experiments)_
    - `C:jev-guard:a05395c43badc9a6` — src/guard.js:149 scanContent _(jev-guard)_
    - `C:jev-review:c18419da63ab696b` — src/review/codebase-judgments.ts:39 screenSourceFile _(jev-review)_
    - `C:jevlogs:9bc7fe3d51758751` — src/index.ts:50 jevEvaluator _(jevlogs)_
- **Contrasting deterministic examples (0):**
    - none
- **Counter-examples / conflicting evidence (0):**
    - none found in this data
- **Unknowns:**
    - Why the developer chose Jev versus another classifier or model API.
    - How each caller acts on flagged (block, warn, store).
    - Whether regex or list-based scanners were tried and failed.
    - Real-world false-positive rates for this scan.
    - Why the author chose noul here versus linters or analyzers
- ⚠︎ The same hypothesis was never assessed on the deterministic contrasts, so a high count does not show it separates Jev code from exact code.

### "uncertain_inputs" is supported at 5 of 7 analyzed Jev sites, and contradicted at 1.

- **Category:** `context_dependence` · **strength:** cross_project · **confidence:** low · **contested**
- **Wording:** JevX's own, from the counts
- **Counted from:** The analyst's assessment of the hypothesis "uncertain_inputs" at 7 Jev usage record(s). Assessed on Jev sites only — never on the deterministic side.
- **Projects supporting it:** 5 (jev-experiments, jev-guard, jev-review, jevlogs, typesafe-migration-guard)
- **Supporting Jev usages (5):**
    - `C:jev-experiments:5dd716eaccf96e0e` — turbo-rerank/server/jev.ts:45 judgeBatch _(jev-experiments)_
    - `C:jev-guard:a05395c43badc9a6` — src/guard.js:149 scanContent _(jev-guard)_
    - `C:jev-review:c18419da63ab696b` — src/review/codebase-judgments.ts:39 screenSourceFile _(jev-review)_
    - `C:jevlogs:9bc7fe3d51758751` — src/index.ts:50 jevEvaluator _(jevlogs)_
    - `C:typesafe-migration-guard:b3ed9b3a68a5c6f2` — lib/typesafe.ts:37 evaluateMigrationSafety _(typesafe-migration-guard)_
- **Contrasting deterministic examples (0):**
    - none
- **Counter-examples / conflicting evidence (1):**
    - `C:tiershift:1313e82fec02f37a` — src/signals.ts:141 askGate _(tiershift)_
- **Unknowns:**
    - Why the developer chose Jev versus another classifier or model API.
    - How each caller acts on flagged (block, warn, store).
    - Whether regex or list-based scanners were tried and failed.
    - Real-world false-positive rates for this scan.
    - Why the author chose noul here versus linters or analyzers
- ⚠︎ The same hypothesis was never assessed on the deterministic contrasts, so a high count does not show it separates Jev code from exact code.

### "context_dependent_behavior" is supported at 7 of 7 analyzed Jev sites.

- **Category:** `context_dependence` · **strength:** cross_project · **confidence:** low
- **Wording:** JevX's own, from the counts
- **Counted from:** The analyst's assessment of the hypothesis "context_dependent_behavior" at 7 Jev usage record(s). Assessed on Jev sites only — never on the deterministic side.
- **Projects supporting it:** 6 (jev-experiments, jev-guard, jev-review, jevlogs, tiershift, typesafe-migration-guard)
- **Supporting Jev usages (7):**
    - `C:jev-experiments:5dd716eaccf96e0e` — turbo-rerank/server/jev.ts:45 judgeBatch _(jev-experiments)_
    - `C:jev-experiments:f0913a1ef9d31262` — jev-firehose/eval.mjs:26 <Array.from callback@26> _(jev-experiments)_
    - `C:jev-guard:a05395c43badc9a6` — src/guard.js:149 scanContent _(jev-guard)_
    - `C:jev-review:c18419da63ab696b` — src/review/codebase-judgments.ts:39 screenSourceFile _(jev-review)_
    - `C:jevlogs:9bc7fe3d51758751` — src/index.ts:50 jevEvaluator _(jevlogs)_
    - `C:tiershift:1313e82fec02f37a` — src/signals.ts:141 askGate _(tiershift)_
    - `C:typesafe-migration-guard:b3ed9b3a68a5c6f2` — lib/typesafe.ts:37 evaluateMigrationSafety _(typesafe-migration-guard)_
- **Contrasting deterministic examples (0):**
    - none
- **Counter-examples / conflicting evidence (0):**
    - none found in this data
- **Unknowns:**
    - Why the developer chose Jev versus another classifier or model API.
    - How each caller acts on flagged (block, warn, store).
    - Whether regex or list-based scanners were tried and failed.
    - Real-world false-positive rates for this scan.
    - Why the author chose noul here versus linters or analyzers
- ⚠︎ The same hypothesis was never assessed on the deterministic contrasts, so a high count does not show it separates Jev code from exact code.
- ⚠︎ Supported at every one of the 7 sites; a judgment that never varies may reflect the analyst's prior as much as the code.

### "expensive_or_fragile_deterministic_rules" is supported at 7 of 7 analyzed Jev sites.

- **Category:** `cheap_semantic_triage` · **strength:** cross_project · **confidence:** low
- **Wording:** JevX's own, from the counts
- **Counted from:** The analyst's assessment of the hypothesis "expensive_or_fragile_deterministic_rules" at 7 Jev usage record(s). Assessed on Jev sites only — never on the deterministic side.
- **Projects supporting it:** 6 (jev-experiments, jev-guard, jev-review, jevlogs, tiershift, typesafe-migration-guard)
- **Supporting Jev usages (7):**
    - `C:jev-experiments:5dd716eaccf96e0e` — turbo-rerank/server/jev.ts:45 judgeBatch _(jev-experiments)_
    - `C:jev-experiments:f0913a1ef9d31262` — jev-firehose/eval.mjs:26 <Array.from callback@26> _(jev-experiments)_
    - `C:jev-guard:a05395c43badc9a6` — src/guard.js:149 scanContent _(jev-guard)_
    - `C:jev-review:c18419da63ab696b` — src/review/codebase-judgments.ts:39 screenSourceFile _(jev-review)_
    - `C:jevlogs:9bc7fe3d51758751` — src/index.ts:50 jevEvaluator _(jevlogs)_
    - `C:tiershift:1313e82fec02f37a` — src/signals.ts:141 askGate _(tiershift)_
    - `C:typesafe-migration-guard:b3ed9b3a68a5c6f2` — lib/typesafe.ts:37 evaluateMigrationSafety _(typesafe-migration-guard)_
- **Contrasting deterministic examples (0):**
    - none
- **Counter-examples / conflicting evidence (0):**
    - none found in this data
- **Unknowns:**
    - Why the developer chose Jev versus another classifier or model API.
    - How each caller acts on flagged (block, warn, store).
    - Whether regex or list-based scanners were tried and failed.
    - Real-world false-positive rates for this scan.
    - Why the author chose noul here versus linters or analyzers
- ⚠︎ The same hypothesis was never assessed on the deterministic contrasts, so a high count does not show it separates Jev code from exact code.
- ⚠︎ Supported at every one of the 7 sites; a judgment that never varies may reflect the analyst's prior as much as the code.

## Explanations this evidence does NOT support

- ✗ Jev is used because the code is "critical decision". — Contradicted at 6 of 7 analyzed Jev sites, supported at 1.
- ✗ Jev is used because the code is "slow or expensive to run". — Contradicted at 7 of 7 analyzed Jev sites and supported at none.
- ✗ Jev is used because the code is "large function". — Contradicted at 7 of 7 analyzed Jev sites and supported at none.
- ✗ Jev is used because the code is "many branches". — Contradicted at 7 of 7 analyzed Jev sites and supported at none.
- ✗ Jev is used because the code is "important feature". — Contradicted at 3 of 7 analyzed Jev sites and supported at none.
- ✗ Jev is used because the code is "complex code". — Contradicted at 7 of 7 analyzed Jev sites and supported at none.

## About the evidence itself

- 8 of 12 contrast(s) were judged not to be decisions at all (plumbing, parsing, formatting). They are excluded from the deterministic side, so most Jev sites have fewer real comparisons than contrasts were selected.
- Private project(s) jev-experiments, typesafe-migration-guard contribute levels and assessments only — their free text stays in the local cache, so no wording from them appears here.
- 4 of 7 analyzed Jev site(s) have no real-decision contrast at all, so for those the deterministic side is unmeasured.
- `D:jev-experiments:f0913a1ef9d31262:d22d6610` (jev-firehose/src/jev.ts:123 heuristicJudgment) contradicts 8 of the 21 groups on its own: check whether it is a mis-selected contrast, a mislabelled level, or a real exception before trusting the lowered confidence.
- `C:tiershift:1313e82fec02f37a` (src/signals.ts:141 askGate) contradicts 3 of the 21 groups on its own: check whether it is a mis-selected contrast, a mislabelled level, or a real exception before trusting the lowered confidence.

## Open questions

- Why does jev-firehose/src/jev.ts:123 heuristicJudgment (`D:jev-experiments:f0913a1ef9d31262:d22d6610`) disagree with semantic_ambiguity? One counter-example can mean a mis-selected contrast, a mislabelled level, or a real exception.
- Only 4 real-decision contrast(s) for 7 Jev site(s): is deterministic decision-making genuinely rare next to Jev calls, or is the contrast finder picking plumbing?

## What the repositories could not tell us

- Why the developer chose Jev versus another classifier or model API.
- How each caller acts on flagged (block, warn, store).
- Whether regex or list-based scanners were tried and failed.
- Real-world false-positive rates for this scan.
- Why the author chose noul here versus linters or analyzers
- How callers threshold these probabilities
- Whether the five rubrics are treated as stable product policy
- Intended calibration of noul scores versus human review
- Why the authors chose Jev versus another classifier or a larger hand-written rule pack.
- What real log corpora or failure modes they optimized the rubrics for.
- How often production traffic hits Jev versus protected, rule, cache, or unavailable paths.
- Why the developer chose Jev rather than heuristics or another judge.
- Why noul rather than score, and why the default threshold and default gated tier.
- Whether the yes/no criteria were tuned empirically or how accurate the gate is.
