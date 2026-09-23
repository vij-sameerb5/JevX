# M5b pilot report

_Generated from stored records only (dataset/boundary). Everything under "Grok" is **model inference**, not fact. All stored records._

## Numbers (exact)

| | |
| --- | --- |
| Projects with analyses | 8 (jev-browser, jev-experiments, jev-guard, jev-mcp, jev-review, jevlogs, tiershift, typesafe-migration-guard) |
| Jev usages analyzed | 10 (5 failed) |
| With ≥1 contrast / ≥1 meaningful contrast | 8 / 6 |
| No contrast selected | 2 |
| Contrasts analyzed / judged a real decision / shares Jev-site traits (yes·partly) | 21 / 8 / 2 |
| Sufficient context / needed expansion (>1 round) | 10 / 5 |
| Uncertain (insufficient, or low confidence/understanding) | 0 |
| API calls / retries | 50 / 18 |
| Input / output tokens (reasoning) | 302,467 / 179,883 (109,779) |
| Cached tokens | 48,000 |
| Cost (calculated from configured prices) | $1.6842 (some calls recorded no cost) |
| Analyst(s) | xai · grok-4.6 · prompt b1 |

### Errors

- jev-guard: src/guard.js:130: request timed out
- jev-review: src/review/codebase-judgments.ts:188: request timed out
- jev-router: src/router.mjs:32: request timed out
- jev-trader: src/model.ts:63: request timed out
- tiershift: src/signals.ts:105: request timed out

## Features — Jev sites vs deterministic contrasts (levels, descriptive only)

| feature | Jev sites | contrasts |
| --- | --- | --- |
| semantic_ambiguity | high 10 | high 1, none 20 |
| context_dependence | high 7, medium 3 | low 7, none 14 |
| deterministic_expressibility | medium 1, low 9 | high 20, low 1 |
| judgment_required | high 10 | high 1, none 20 |
| rule_stability | medium 2, low 8 | high 19, medium 1, low 1 |
| risk_or_policy_component | high 7, none 3 | high 2, medium 3, low 5, none 11 |
| natural_language_understanding | high 8, medium 2 | high 1, none 20 |
| decision_complexity | medium 10 | medium 1, low 15, none 5 |

## Why-Jev hypotheses (supported / contradicted / not determinable)

- semantic_interpretation: 10 / 0 / 0
- ambiguous_natural_language_or_context: 10 / 0 / 0
- multiple_competing_outcomes: 10 / 0 / 0
- judgment_not_computation: 10 / 0 / 0
- classification_requiring_context: 10 / 0 / 0
- hard_to_encode_as_rules: 10 / 0 / 0
- context_dependent_behavior: 10 / 0 / 0
- expensive_or_fragile_deterministic_rules: 10 / 0 / 0
- soft_or_changing_rules: 8 / 0 / 2
- uncertain_inputs: 8 / 1 / 1
- policy_interpretation: 7 / 3 / 0
- risk_assessment: 7 / 3 / 0

## Not-reasons (supported / contradicted / not determinable)

- critical_decision: 1 / 8 / 1
- slow_or_expensive_to_run: 0 / 10 / 0
- large_function: 0 / 10 / 0
- many_branches: 0 / 10 / 0
- important_feature: 0 / 5 / 5
- complex_code: 0 / 10 / 0

## Per site (read these to judge quality)

### jev-browser · src/navigate.ts:300 navigate

nature **semantic_judgment** · confidence high · understanding high · 1 round(s), 30,459 chars, stopped: sufficient · 13,604+8,215 tokens

- **decides:** At each step, which listed browser action best advances a free-form task, whether the goal already holds on this page/history, and whether the run is stuck. If a select action is chosen, which dropdown option to pick.
- **inputs:** task (NavigateOptions from CLI or MCP caller); current_page (Playwright url and title after settle); page_text_excerpt (Truncated body innerText via pageObservables); interactive_elements (DOM extractAndStamp then buildActionSpace); history (Prior executed actions and observed outcomes this run); dropdown_options (Stamped select element's option labels)
- **outcomes → then:** one action id (click/type/select on an element, scroll_up/down, back, or done) | goal_done graded noul | stuck graded noul | one dropdown option when a select_* action runs → Before acting: stop if action is done, goal_done noul above 0.85, or stuck noul above 0.85 after step 2. Else run Playwright click/fill/scroll/back. Repeat-no-op may switch via pickAlternate. select_* asks Jev again then selectOption.
- observed: Each step sends task, page, excerpt, interactive elements, and history to Jev and reads action, goal_done, and stuck. `src/navigate.ts:406-427`
- observed: Jev stop beliefs are applied before any browser action runs. `src/navigate.ts:429-445`
- observed: Choosing a select action triggers a second Jev choice over dropdown labels, then Playwright selects that label. `src/navigate.ts:487-500`
- observed: After Jev returns an action id, execution and change detection are ordinary deterministic browser code. `src/navigate.ts:466-532`
- observed: The file states a split: control flow in code, judgments in Jev. `src/navigate.ts:1`
- inferred: Jev is used because matching an arbitrary natural-language task to a live, partially observed page is a semantic pick among competing controls, not a computable predicate.
- inferred: goal_done and stuck are Jev because whether a page satisfies a task or a history is looping is graded and page-specific.
- inferred: Dropdown option selection is the same kind of task-to-label match, so it is a nested Jev choice rather than first-option or exact string match.
- unknown: Why the author chose Jev versus a general tool-calling LLM agent or a scripted planner
- unknown: Why the stop cutoff is 0.85 rather than another threshold
- unknown: Whether a deterministic alternative was tried and failed
- unknown: How often Jev's action or watchers are wrong on real sites
- unknown: Caller-side task wording quality, which the repo does not constrain
- exact-rule alternative: Per-task success detectors on url/title/text; loop detectors on history; and a ranking from goal words to live controls, plus a label matcher for every select. That implies site-specific selectors and goal predicates for unbounded pages and tasks. — Fragile to impossible. Tasks and DOMs are open-ended, labels are short and aliased, and done/stuck are readings of page plus history. Exact rules would overfit sites and miss paraphrased goals.
- ◇ contrast `src/navigate.ts:354` <p.on callback@354> (same_function) · not_a_decision · real decision: NO · shares traits: no
  - why deterministic: This is diagnostic plumbing, not a judgment about the task, matching the file’s code-vs-Jev split.
  - ≠ The Jev site interprets task plus live page to pick an action and grade done/stuck; this callback never sees that state.
  - ≠ Outcomes here are keep-or-drop of a log line, not competing browser actions or graded noul.
  - unknown: Whether the developer considered asking Jev which console lines matter for the task.
- ◇ contrast `src/navigate.ts:105` resolveGeneratorModel (same_file) · exact_rule · real decision: yes · shares traits: no
  - why deterministic: This is SDK wiring from secrets, not a semantic pick of what to type or which browser action to take.
  - ≠ Jev chooses among page actions from task and DOM; this function never inspects the page or task.
  - ≠ Outcomes are SDK clients identified by closed provider names, not competing action ids or noul grades.
  - unknown: Why typing uses a separate AI SDK path instead of a Jev question for the string to type.
- ◇ contrast `src/navigate.ts:607` extractPayload (same_file) · not_a_decision · real decision: NO · shares traits: no
  - why deterministic: This is output formatting after the Jev loop, not a substitute for judging whether the goal holds.
  - ≠ Jev is used mid-loop to choose the next action and stop; extractPayload runs after the loop to serialize whatever page remains.
  - ≠ There is no open-ended match of task language to controls; each format name has exactly one extractor.
  - unknown: Whether anyone considered letting Jev pick the most useful page representation.

### jev-experiments · turbo-rerank/server/jev.ts:45 judgeBatch

nature **semantic_judgment** · confidence high · understanding high · 2 round(s), 32,578 chars, stopped: sufficient · 20,639+12,162 tokens

_private project: facts only in the dataset_

- ◇ contrast `turbo-rerank/server/jev.ts:96` describeError (same_file) · exact_rule · real decision: yes · shares traits: no
- ◇ contrast `turbo-rerank/server/index.ts:40` <http.createServer callback@40> (related_file) · not_a_decision · real decision: NO · shares traits: no
- ◇ contrast `turbo-rerank/server/index.ts:69` worker (related_file) · not_a_decision · real decision: NO · shares traits: no

### jev-experiments · jev-firehose/eval.mjs:26 <Array.from callback@26>

nature **semantic_judgment** · confidence high · understanding high · 2 round(s), 20,900 chars, stopped: sufficient · 17,360+14,231 tokens

_private project: facts only in the dataset_

- ◇ contrast `jev-firehose/src/policy.ts:19` modReason (related_file) · exact_rule · real decision: yes · shares traits: no
- ◇ contrast `jev-firehose/src/jev.ts:123` heuristicJudgment (related_file) · mixed · real decision: yes · shares traits: yes

### jev-guard · src/guard.js:149 scanContent

nature **mixed** · confidence high · understanding high · 1 round(s), 17,340 chars, stopped: sufficient · 9,363+6,045 tokens

- **decides:** Whether arbitrary tool-result text contains instructions aimed at an AI that will read it, which type that text is, and whether to flag it as untrusted.
- **inputs:** content (Caller-supplied text, truncated before the ask); source (Optional origin label, else the tool name); user_task (Optional task string from the caller); tool (Caller; compared to skip sets); injectP (Env threshold with default)
- **outcomes → then:** skip (null) | flagged injection or canary (or unknown kind) | not flagged (discussion, benign, or low probability) → Returns flagged, kind, probability, and a message telling the agent to treat flagged text as untrusted and not follow it. Callers are not in this file.
- observed: scanContent sends truncated content, source, and optional user task to ask with SCAN_QUESTIONS. `src/guard.js:154`
- observed: Jev is asked a yes/no about AI-directed instructions and a four-way kind label. `src/guard.js:4-26`
- observed: After Jev returns, flagging is an exact probability cutoff plus kind membership. `src/guard.js:155-157`
- observed: Some inputs never reach Jev: listed tools and short text. `src/guard.js:151-153` `src/guard.js:101-108`
- observed: The file states code owns policy and Jev answers narrow questions. `src/guard.js:1`
- inferred: Jev is here because telling an attack on the reading agent from discussion, tests, or ordinary data in free text is a judgment, not a parse.
- inferred: Keyword rules are treated as too crude for this verdict; they are used only to pick excerpt lines later.
- unknown: Why the developer chose Jev versus another classifier or model API.
- unknown: How each caller acts on flagged (block, warn, store).
- unknown: Whether regex or list-based scanners were tried and failed.
- unknown: Real-world false-positive rates for this scan.
- exact-rule alternative: A catalog of injection and canary phrasings, plus rules to ignore security docs, tests, and detection code, covering hidden, multilingual, and end-of-file payloads in arbitrary tool output. — Fragile to impossible: attackers vary wording; discussion of injection looks like injection; the file already notes the same questions misfire on legitimate instruction files.
- ◇ contrast `src/acp.js:29` fromAgent (related_file) · not_a_decision · real decision: NO · shares traits: no
  - why deterministic: This is protocol plumbing; any semantic guard is delegated, not performed here.
  - ≠ The Jev site judges free-text tool results; fromAgent only matches wire-protocol fields.
  - ≠ Agent prose is buffered for later context, not classified as injection vs discussion.
  - unknown: Whether the developer ever considered Jev for classifying ACP update kinds.
- ◇ contrast `src/acp.js:69` fromClient (related_file) · not_a_decision · real decision: NO · shares traits: no
  - why deterministic: Semantic injection judgment is intentionally deferred to scanContent, not done in the router.
  - ≠ fromClient decides whether to invoke the Jev scan by method name; scanContent decides what the text means.
  - ≠ Prompt text is stored as data, not classified as directed-at-AI.
  - unknown: Why only those two result methods are scanned in this proxy.
- ◇ contrast `src/skills.js:23` walk (related_file) · not_a_decision · real decision: NO · shares traits: no
  - why deterministic: This is discovery plumbing so later scanners know which files to read, not a semantic verdict on those files.
  - ≠ walk selects files by path shape; scanContent judges the meaning of already-loaded text.
  - ≠ No competing semantic labels; outcomes are add, recurse, or skip.
  - unknown: The full INSTRUCTION_FILE pattern and SKIP_DIRS set are not in this snippet.

### jev-mcp · src/index.ts:1269 <server.registerTool callback@1269>

nature **mixed** · confidence high · understanding high · 2 round(s), 86,427 chars, stopped: sufficient · 35,135+12,288 tokens

- **decides:** Whether a proposed patch is functionally correct, matches the request without extra work, is adequately tested, has limited blast radius, and is safe for an agent to apply without a human; then auto, review, or escalate.
- **inputs:** request (jev_review tool argument from the host agent); diff (jev_review tool argument, truncated before the model); tests (optional tool argument; may be null); policy thresholds (optional auto_accept, review_at, composite_floor after Jev returns)
- **outcomes → then:** correctness, spec_match, test_gap, blast_radius as 0..2 rubric scores | safe_to_apply as a probability | action auto, review, or escalate (escalate also on invalid or truncated input) → Validated scores become a weighted composite and, with min confidence and truncation, an action returned as JSON. The tool does not apply the patch or run tests.
- observed: The jev_review callback sends truncated request, diff, and optional tests to askJev with reviewQuestions. `src/index.ts:1277-1283`
- observed: Jev is asked four three-rung scores plus a noul on applying without a human. `src/index.ts:1123-1150`
- observed: Answers are not used as the final action; they are projected through validation, composite, and policy. `src/index.ts:1285-1291` `src/index.ts:1187-1228`
- observed: The tool is documented as scoring a proposed diff with Jev before the task is called done, without applying or testing. `src/index.ts:1231-1240`
- inferred: Jev is used because matching a free-form request to a patch and judging apply-safety is interpretive, while auto versus review is a numeric policy on those judgments.
- inferred: Truncation and anti-injection framing show the authors treat the documents as untrusted, incomplete evidence rather than executable spec.
- unknown: Whether host agents actually apply patches when action is auto.
- unknown: Why these five rubrics were chosen versus others.
- unknown: How accurate Jev is on this review task.
- unknown: Private author motive beyond the tool description.
- exact-rule alternative: A formal spec of the request, language-aware diff analysis, real test execution mapped to changed paths, and a blast-radius model over module graphs, plus a hardcoded apply-safety policy. — Fragile to impossible: NL request match and functional correctness of arbitrary patches are not closed-form; only the later composite and thresholds are exact-rule adequate.
- context used: outline:src/index.ts, unit:src/index.ts#<anonymous>@1269, callee:src/index.ts#reviewQuestions@1123, callee:src/index.ts#projectReviewHalf@1174, callee:src/index.ts#askJev@80, callee:src/lib.ts#resolvePolicyThresholds@274, file:src/index.ts
- ◇ contrast `src/index.ts:1029` <fields.map callback@1029> (same_file) · exact_rule · real decision: yes · shares traits: no
  - why deterministic: This is the post-judgment policy layer of jev_extract; the semantic which-candidate pick is not made here.
  - why deterministic: Authors treat a capped or overlong-skipped match set as poisoned evidence that no confidence may override.
  - ≠ The Jev site interprets a free-form request and diff for correctness and apply-safety; this callback never reads those documents.
  - ≠ Semantic candidate selection is upstream; this unit does not call Jev.
  - unknown: Why the default auto_accept and minimum_margin values were chosen.
- ◇ contrast `src/index.ts:1174` projectReviewHalf (same_file) · exact_rule · real decision: yes · shares traits: no
  - why deterministic: This is the numeric policy half of the jev_review Jev site, not a second semantic judgment.
  - why deterministic: Unknown confidence is treated as unable to support auto, including at a zero auto_accept threshold.
  - ≠ The Jev site asks interpretive score/noul questions about the patch; this function only arithmetically projects those answers.
  - ≠ It is invoked by the Jev site rather than being an alternative site that skipped Jev.
  - unknown: Exact formulas of reviewComposite, reviewAction, and requireCompleteContext live in lib.ts and were not in this context.
- ◇ contrast `src/index.ts:1405` validateChoice (same_file) · not_a_decision · real decision: NO · shares traits: no
  - why deterministic: Math.max here is not a best-item selector; it enforces that the reported choice is the argmax of the distribution.
  - ≠ The Jev site performs semantic patch review; this helper only accepts or rejects an already-returned Choice object.
  - ≠ It sits after jev_gate's askJev, on claim answers, not on the review rubrics.
  - unknown: Why this validator is duplicated inline in jev_gate, jev_decide, and jev_compare rather than shared.

### jev-mcp · src/index.ts:236 <server.registerTool callback@236>

nature **mixed** · confidence high · understanding high · 2 round(s), 83,940 chars, stopped: sufficient · 33,459+13,463 tokens

- **decides:** Whether fetched or external text is safe and useful to put in an agent context: injection likelihood, whether it has real content, and optionally relevance to a stated purpose, then a pass/review/block/skip recommendation.
- **inputs:** content (jev_screen tool argument text); purpose (optional tool argument); block_at (optional tool argument, default 0.75); review_at (optional tool argument, default 0.25)
- **outcomes → then:** injection noul probability | substance noul probability | optional relevance noul probability | recommendation: block, review, skip, or pass → Thresholds map probabilities to a recommendation; the MCP tool returns probabilities, thresholds, recommendation, and usage as JSON.
- observed: jev_screen builds noul questions for injection and substance, and relevance when purpose is set, then calls askJev on content and purpose. `src/index.ts:240-261`
- observed: Noul probabilities are read from answers and passed to screenRecommendation with caller thresholds. `src/index.ts:263-267`
- observed: screenRecommendation applies exact numeric cutoffs to choose block, review, skip, or pass. `src/lib.ts:73-82`
- observed: The tool is documented as a guardrail that judges fetched or external text before an agent reads it. `src/index.ts:217-225`
- inferred: Jev is here because injection, substance, and task-relevance on unconstrained pages are reading/judgment problems, while mapping scores to actions is left to exact thresholds.
- inferred: Exact rules would have to encode paraphrasable AI-directed instructions, page-quality, and fit to an arbitrary purpose, which the question poles treat as interpretive.
- unknown: The developer's actual motive for choosing noul versus a dedicated classifier or keyword filter.
- unknown: Whether callers auto-enforce the recommendation or only display it.
- unknown: How well this performs versus deterministic injection or boilerplate detectors.
- unknown: Whether purpose-free calls were expected to be the common path.
- exact-rule alternative: Phrase or regex lists for known injection directives; length, error-page, and boilerplate heuristics for substance; keyword or topic overlap of content with purpose for relevance; then the same injection and skip thresholds. — Fragile and likely inadequate. Injection wording is adversarial and paraphrasable; substance vs nav/error pages is semantic; relevance tracks an open-ended purpose that cannot be compiled into a stable rule set.
- context used: outline:src/index.ts, unit:src/index.ts#<anonymous>@236, callee:src/lib.ts#screenRecommendation@66, callee:src/index.ts#askJev@80, file:src/index.ts
- ◇ contrast `src/index.ts:591` validateChoice (same_file) · not_a_decision · real decision: NO · shares traits: no
  - why deterministic: This is post-hoc wire-contract enforcement after Jev already made the semantic Choice.
  - ≠ The Jev site interprets unconstrained page text; this only inspects numeric and string fields of an already-returned Choice.
  - ≠ Outcomes are accept-shape versus reject-shape, not pass/review/block/skip about content meaning.
  - unknown: Why this helper is inlined here rather than shared with the other identical validators in the same file.
- ◇ contrast `src/index.ts:818` validateChoice (same_file) · not_a_decision · real decision: NO · shares traits: no
  - why deterministic: Semantic comparison already happened in askJev; this is only contract checking.
  - ≠ jev_screen judges unconstrained text with noul; this function never sees passage_a or passage_b.
  - ≠ A valid result still does not choose the relation; it only forwards the already-chosen key.
  - unknown: Whether ASPECT_RELATIONS keys always match COMPARE_RELATIONS; this file does not define those constants.
- ◇ contrast `src/lib.ts:66` screenRecommendation (related_file) · exact_rule · real decision: yes · shares traits: partly
  - why deterministic: This is the exact-rule half of the mixed screen pipeline: Jev scores the text, this maps scores to an action.
  - ≠ The Jev site must interpret unconstrained text; this function never sees that text.
  - ≠ Same action labels as jev_screen, but produced by inequalities on Jev outputs rather than by judging the page.
  - unknown: Why skip uses a hardcoded 0.3 while block/review thresholds are caller-configurable.

### jev-review · src/review/codebase-judgments.ts:39 screenSourceFile

nature **semantic_judgment** · confidence high · understanding high · 1 round(s), 15,419 chars, stopped: sufficient · 8,425+5,911 tokens

- **decides:** Whether each source region supports a real defect on five review dimensions: incorrect runtime behavior, a weakened security boundary, a reliability failure path, a caller-facing contract mismatch, or important behavior lacking related-test evidence.
- **inputs:** file region (SourceFile split into 160-line chunks with path and start line); relatedTests (Up to four test files picked by path/stem heuristics, then compacted)
- **outcomes → then:** per-region noul support scores for correctness, security, reliability, compatibility, and testGap | file-level Screening probabilities equal to the max score per dimension → Returns a Screening of the file plus those max probabilities for later codebase-review steps.
- observed: For every source region, five noul questions ask whether that region’s content supports a defect on a named review dimension. `src/review/codebase-judgments.ts:46-137`
- observed: Each noul defines true as concrete supported evidence and false as coherent code or lack of a concrete path, with focus and ignore guidance. `src/review/codebase-judgments.ts:53-136`
- observed: Numeric noul answers are stored per region and the file screening keeps the maximum per dimension. `src/review/codebase-judgments.ts:140-157`
- observed: testGap is a comparison against heuristically selected related tests, not a path-name check alone. `src/review/codebase-judgments.ts:43,119-135,293-304`
- inferred: Jev is used because deciding whether arbitrary source contains a realistic defect is a semantic evidence judgment, not a closed predicate.
- inferred: Max-across-regions treats any strongly supporting slice as enough to raise the file’s screening score.
- unknown: Why the author chose noul here versus linters or analyzers
- unknown: How callers threshold these probabilities
- unknown: Whether the five rubrics are treated as stable product policy
- unknown: Intended calibration of noul scores versus human review
- exact-rule alternative: Language-specific detectors for wrong branches and state, auth/injection/sinks, lifecycle and concurrency faults, parser/serializer and API contract mismatches, plus a map from important behaviors to tests that actually exercise them. — Fragile to impossible as a closed set: realistic failure paths and important untested behavior depend on intent and use, and unusual-but-consistent code would keep colliding with pattern rules.
- ◇ contrast `src/review/codebase-judgments.ts:307` compactTest (same_file) · not_a_decision · real decision: NO · shares traits: no
  - why deterministic: compactTest is payload plumbing to shrink related tests before screening, not a judgment that a defect or test gap exists.
  - why deterministic: Whether related tests adequately cover important behavior is left to the testGap noul, which compares source to these snippets.
  - ≠ screenSourceFile scores whether source supports defects; compactTest only filters and truncates test text.
  - ≠ compactTest uses a closed match set; the Jev site evaluates open-ended source meaning with support scores.
  - unknown: Whether the developer considered Jev to pick relevant test lines

### jevlogs · src/index.ts:50 jevEvaluator

nature **semantic_judgment** · confidence high · understanding high · 1 round(s), 20,194 chars, stopped: sufficient · 9,501+5,577 tokens

- **decides:** Whether a telemetry log is operationally urgent, diagnostically valuable, and worth deeper LLM incident investigation, which then selects retain versus analyze.
- **inputs:** state (Redacted JSON of log body plus severityText and severityNumber after size and protection checks); severity hints (LogInput severityNumber and severityText serialized into state (high-severity logs never reach Jev)); retainBelow threshold (JevOptions, default 0.1, applied after Jev returns)
- **outcomes → then:** priority critical, high, normal, or low | diagnostic value score 0-100 | actionable probability | route retain or analyze with reason model, uncertain, or unavailable → Triage annotates OTel records or drops retain logs in analysis-only mode so only analyze-routed logs go to expensive investigation.
- observed: Default evaluator calls the Jev model with three questions over redacted log state: investigation benefit, urgency class, and diagnostic-value score. `src/index.ts:50-60`
- observed: Jev is skipped for protected or high-severity logs and for first-match local regex rules; it runs only on remaining redacted bodies. `src/index.ts:131` `src/index.ts:139-144` `src/index.ts:154-157`
- observed: Jev answers are combined into retain only when probability, value, and priority are all confidently low; otherwise the log is analyzed. `src/index.ts:164-166`
- observed: The chosen route is written onto exported log records or used to drop retain records in analysis-only mode. `src/index.ts:239-246`
- inferred: Jev is used because leftover logs are free-form operational text whose urgency and diagnostic worth cannot be decided by the exact guards already in the pipeline.
- inferred: The product goal is cheap semantic triage so most noise can skip a later expensive LLM investigation.
- unknown: Why the authors chose Jev versus another classifier or a larger hand-written rule pack.
- unknown: What real log corpora or failure modes they optimized the rubrics for.
- unknown: How often production traffic hits Jev versus protected, rule, cache, or unavailable paths.
- exact-rule alternative: Per-app catalogs of patterns for outages, security, data loss, business failures, health checks, and noise, plus severity maps already present, covering unknown log formats and languages. — Fragile and incomplete: exact severity and regex already exist and still leave unmatched arbitrary text; keyword rules would miss novel failures and misfire on similar wording in successful checks.
- ◇ contrast `src/index.ts:66` compileRules (same_file) · not_a_decision · real decision: NO · shares traits: no
  - why deterministic: This stayed deterministic because it is a construction-time schema compiler for later exact matches, not triage of log meaning.
  - ≠ The Jev site interprets leftover log text; compileRules never reads a log body.
  - ≠ Outcomes are accept/reject/compile of config, not priority, value, or retain versus analyze of a log.
  - unknown: Whether the author ever considered Jev for config validation.
- ◇ contrast `src/index.ts:69` <rules.map callback@69> (same_file) · not_a_decision · real decision: NO · shares traits: no
  - why deterministic: Deterministic because the library must fail fast on illegal config rather than guess what the caller meant.
  - ≠ Jev classifies untrusted log prose; this callback only checks that a config pattern is a legal regex.
  - ≠ The static text test is against allowed regex flag letters, not against log content.
  - unknown: Why callers would pass string versus RegExp match forms.
- ◇ contrast `src/index.ts:235` <Array.from callback@235> (same_file) · exact_rule · real decision: yes · shares traits: no
  - why deterministic: This stayed an exact filter because the semantic retain/analyze judgment is already finished in triage; the exporter only applies a deployment mode to that bit.
  - ≠ The Jev site produces priority, value, and investigation worth from log text; this callback consumes an already-made route.
  - ≠ Keep versus drop is a closed equality, not competing semantic labels.
  - unknown: Why a given deployment chooses annotate versus analysis-only.

### tiershift · src/signals.ts:141 askGate

nature **semantic_judgment** · confidence high · understanding high · 2 round(s), 13,310 chars, stopped: sufficient · 14,646+13,314 tokens

- **decides:** Whether a candidate model answer fully and correctly covers the last user request, without inventing ungiven context or padding with filler.
- **inputs:** request (last user-role message in the conversation, truncated); answer (provider completion text passed into askGate, truncated)
- **outcomes → then:** addresses (noul toward yes) | does not address (noul toward no) → Score is compared to a threshold; fail rejects the attempt and retries the next model, pass serves this answer.
- observed: askGate calls systemOne with GATE_QUESTIONS on truncated last-user request text and truncated answer text. `src/signals.ts:141-144`
- observed: The only gate question is a noul named addresses that judges whether the answer fully and correctly covers the request, using yes/no criteria for completeness, no invention, and no filler. `src/signals.ts:131-136`
- observed: complete treats the noul as a pass/fail gate against a threshold and on failure retries the next model. `src/router.ts:206-214`
- observed: The gate runs only when enabled, the attempt tier is in the configured set, a later candidate exists, and the completion has no tool calls. `src/router.ts:172-175` `src/router.ts:205-206`
- inferred: Jev is here because deciding answer adequacy is a semantic reading of two free-form texts, not a computable equality or metric.
- inferred: Exact matching or heuristics would miss paraphrase, partial coverage, invented context, and padding on varied tasks.
- unknown: Why the developer chose Jev rather than heuristics or another judge.
- unknown: Why noul rather than score, and why the default threshold and default gated tier.
- unknown: Whether the yes/no criteria were tuned empirically or how accurate the gate is.
- exact-rule alternative: Parse the last user request into required parts, check the answer covers each correctly, detect invented ungiven context, and detect padding on trivial asks, across arbitrary natural-language tasks. — Fragile or impossible: request and answer forms are open-ended, fully and correctly are task-dependent, and invention or filler have no stable pattern. A deterministic checker would be a second NLU system that still misses paraphrase and implicit requirements.
- context used: file:src/signals.ts, caller:src/router.ts#complete@168
- no contrast (none nearby, not forced)

### typesafe-migration-guard · lib/typesafe.ts:37 evaluateMigrationSafety

nature **semantic_judgment** · confidence medium · understanding high · 1 round(s), 2,874 chars, stopped: sufficient · 4,564+7,006 tokens

_private project: facts only in the dataset_

- no contrast (none nearby, not forced)
