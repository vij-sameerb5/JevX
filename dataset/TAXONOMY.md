# Decision taxonomy (v1)

> The categories and hard-negative reasons are the shared vocabulary for AI analyses and optional human labels. `STRONG_JEV / POSSIBLE_JEV / NOT_JEV` are **hypothesis labels**, not truth ([docs/CURRENT-ARCHITECTURE.md](../docs/CURRENT-ARCHITECTURE.md) §9–10).

Source of truth: `packages/core/src/decision.ts`. This file mirrors it for reviewers.
Categories grow **only from real-project findings** — add one when labelling a real project
shows a decision that fits none of these, never to make a synthetic example pass.

## Labels

| label | meaning |
| --- | --- |
| `STRONG_JEV` | A bounded judgment that exact code approximates badly; a Jev Noul / Choice / Score clearly fits. |
| `POSSIBLE_JEV` | Plausibly a judgment, or only part of the logic is; worth a look but not obviously better with Jev. |
| `NOT_JEV` | Exact code is the right tool. Give a hard-negative reason. |

Every human label needs a written reason. Don't force Jev onto a decision: `NOT_JEV` is a valid, valuable answer.

## Decision categories (for STRONG / POSSIBLE)

| category | definition |
| --- | --- |
| `classification` | Assigns an input to one of several classes or labels. |
| `routing` | Sends work, a request or a message to one destination / handler / queue. |
| `triage` | Sorts incoming items by what needs to happen to them first. |
| `prioritization` | Orders or levels items by importance or urgency. |
| `scoring` | Grades something on a scale (quality, fit, likelihood, severity). |
| `ranking` | Orders candidates by how well they fit. |
| `matching` | Decides whether two things are the same / related (dedup, entity match). |
| `selection` | Picks one tool, model, provider, resource or strategy from several. |
| `next_action` | Decides what the system or user should do next. |
| `workflow_branching` | Chooses a path through a multi-step process. |
| `escalation` | Decides between automatic handling and a human. |
| `risk` | Judges risk, fraud or trustworthiness. |
| `moderation` | Judges safety, abuse, spam or policy compliance of content. |
| `security_judgment` | Judges whether an action or request is suspicious. |
| `verification` | Judges whether an output / result / claim is correct or good enough. |
| `code_review` | Judges code, PRs or changes (triage, risk, reviewer choice). |
| `interpretation` | Interprets a document, policy, reply or instruction. |
| `anomaly` | Decides whether an observation is abnormal and what it means. |
| `recommendation` | Decides what to suggest to someone. |
| `extraction_choice` | Decides which field / label / value a piece of data carries. |
| `dependency` | Decides ordering or dependency between tasks. |
| `ui_context` | Decides what to show a user given their context. |
| `game_strategy` | Chooses a move or strategy in a game or simulation. |
| `other` | A bounded judgment that fits none of the above. |

## Hard-negative reasons (for NOT_JEV)

| reason | definition |
| --- | --- |
| `arithmetic` | Pure calculation; the answer is a formula. |
| `sorting_filtering` | Ordering or filtering by an exact key or comparator. |
| `exact_lookup` | Exact lookup by key / id / database query. |
| `parsing` | Parsing a syntax, protocol, format or character stream. |
| `compiler_ast` | Compiler, AST, lexer or code-model logic. |
| `cryptography` | Cryptography, hashing, signing. |
| `schema_validation` | Validating shape / format / type of data. |
| `exact_business_rule` | A business rule over exact values that must stay exact (limits, thresholds, legal rules). |
| `protocol_status` | HTTP status, error codes, protocol states. |
| `library_error_text` | Branches on machine-generated error text from a library or the app itself. |
| `state_machine` | Deterministic state machine transitions. |
| `feature_flag` | Feature flags / config switches / environment checks. |
| `file_type` | File extension, MIME type, path handling. |
| `performance` | Performance heuristics (batch sizes, retries, caching). |
| `data_transformation` | Reshaping data; no judgment is made. |
| `enum_dispatch` | Dispatch on a closed, typed set of values (enum, union, discriminant). |
| `ui_plumbing` | UI event / rendering plumbing. |
| `trivial_guard` | Null / empty / existence guard with no judgment. |
| `other` | Exact code is correct for another reason (explain in reasoning). |
