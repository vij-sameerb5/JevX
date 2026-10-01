# How real projects use Jev (community study)

We read 26 open-source projects that use Jev (from [awesome-typesafe-jev](https://github.com/AbdelStark/awesome-typesafe-jev) and similar lists): 22 had Jev code we could see, giving **82 distinct Jev decisions**. Every decision was labelled with the same fields JevX shares (primitive, input kind, rule kind, pattern, why).

- Raw call sites: `dataset/jev-community/*.json` (local, git-ignored), made by `node scripts/study-jev-repos.mjs` (needs `GITHUB_TOKEN`).
- Labels: `dataset/jev-community-labels.json` (local, git-ignored).

## What we found

| | Count |
|---|---|
| choice / noul / score | 42 / 31 / 9 |
| **Replaces an LLM call** (an LLM picking from a list, or a yes/no) | **43 of 82** |
| Replaces a keyword list | 12 |
| Replaces a threshold | 9 |
| Replaces a lookup-with-default | 6 |
| Replaces a regex / includes / if-else chain | 8 |

| Where Jev sits | Decisions |
|---|---|
| Browser / computer / mobile agents: next action + which element | 26 |
| Code review: risk yes/no checks, severity score, priority | 22 |
| Routing: which model / tool / agent | 13 |
| Search: is this result relevant, which source | 8 |
| Coding agents, context compaction, trading, other | 13 |

## The big lesson for JevX

1. **Half of real Jev use replaces an LLM call, not a hand-written rule.** JevX today only looks for regexes, keyword lists and thresholds. It should also look for *LLM calls that pick from a fixed list or answer yes/no*: `openai.chat.completions.create(...)` whose answer is parsed into one of a few labels. Those are the strongest fits (faster, cheaper, typed) and are why community projects score high while ordinary web apps don't.
2. **Code always builds the options.** In every project, code builds the list Jev chooses from (the elements on the page, the tools, the models), and code keeps the thresholds, permissions and fallback. Jev never generates free text. JevX's edits should keep this shape: options as constants, Jev picks, fallback stays.
3. **Batch questions.** Several projects ask many yes/no questions in one call (one per item or per rule). JevX should propose one batched call instead of a loop of calls.
4. **Thresholds on probabilities.** Projects act only above a confidence level and fall back below it. JevX's generated code should do the same instead of trusting the top answer blindly.
5. **Ordinary apps have fewer fits.** That matches our GlobalCare / Paytm results (33–68%). JevX's 70% bar is not wrong; the strongest fits are in AI-heavy code.

## Per project

| Project | Where Jev sits |
|---|---|
| [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) | Jev is the policy of a browser agent: each observation becomes an indexed element table and one request asks an operation choice plus speculative per-operation target choices. A small LLM only writes text for TYPE_TEXT; success is verified independently. |
| [thruwire/foreman](https://github.com/thruwire/foreman) | Jev sits above coding-agent workers as a supervisor: batches of noul checks over factory evidence feed a Python policy that continues/steers/stops/retries, and another noul batch routes which optional responsibilities apply to a job. |
| [tamaratran/fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction) | Context compaction plugin: for every non-pinned tool call, two nouls (keep call, keep result verbatim) against the whole condensed transcript, then a threshold ladder keeps, truncates, or removes. |
| [jarrodwatts/jev-trader](https://github.com/jarrodwatts/jev-trader) | Every block, a single buy/sell choice over a rich order-book state drives a post-only quote; a momentum heuristic mock is the stand-in, showing Jev directly replacing a numeric signal rule. |
| [gargpratyush/jev-router](https://github.com/gargpratyush/jev-router) | A proxy in front of Claude Code/Codex asks Jev per fresh turn for the cheapest capable model (choice built from available models) plus three complexity scores for explanation; regex overrides and fail-open to current model surround it. |
| [kerpopule/hermes-jev-skills](https://github.com/kerpopule/hermes-jev-skills) | A toolkit with a strict validated client and a declarative policy engine (decide.py) that runs code rules first, skips sensitive state, applies limits, asks Jev, and maps readings to actions with drift fallback; features (routing, triage, search, skills) are policies on top, mostly not shown in the sampled code. |
| [glowbom/glowbom-oss](https://github.com/glowbom/glowbom-oss) | Jev is exposed as an OpenCode tool so the coding agent can pass facts, a question and choices (e.g. build healthy?) via the free Zen endpoint. |
| [vinilana/jev-gateway](https://github.com/vinilana/jev-gateway) | A local proxy between coding agents and their LLM. On each request with tools, one Jev call picks the tool, checks whether a tool is needed at all, and speculatively fills closed-set arguments; code then forces, hints, calls the tool directly, or passes through to the LLM. |
| [kunchenguid/compact-adviser](https://github.com/kunchenguid/compact-adviser) | A Stop hook in Claude Code, Codex, Grok and Pi asks Jev whether the agent's work is finished and what shape the conversation has, then combines the answers into a score gated by a floor that depends on context usage to suggest /compact. |
| [superagents-lab/jev-search](https://github.com/superagents-lab/jev-search) | A search UI where Jev reads the query once (time window, per-source yes/no, best query span, entity span), then reranks API results with one noul per result. Code generates candidates, calls Search1API, and keeps filters editable. |
| [awlevin/typesafe-computer-use](https://github.com/awlevin/typesafe-computer-use) | A computer-use loop: OCR/accessibility or DOM perception builds a closed action space, one Jev request picks action kind, site, target and checks completion, and a post-typing noul verifies fields. An LLM writer is used only for free text and when the classifier stops. |
| [droidrun/mobile-jev](https://github.com/droidrun/mobile-jev) | An Android agent whose policy builds operations and targets from the observed screen and sends them as one System One request; only the target branch for the chosen operation is validated and executed. |
| [moritzkremb/jev-voice-browser](https://github.com/moritzkremb/jev-voice-browser) | A voice-controlled browser: on every partial transcript, one request asks intent, target, site, completeness, addressed-to-me, destructive, scroll amount, correction and span picks; code thresholds decide whether to act, wait, ask or ignore. |
| [realZachi/typesafe-adblock](https://github.com/realZachi/typesafe-adblock) | A Chrome extension finds ad-like DOM candidates with regex, token lists and host lists, then asks Jev one noul per candidate (batched to 30) and removes those above a threshold. |
| [jonymusky/jev-browser-qa](https://github.com/jonymusky/jev-browser-qa) | Playwright drives and records; an askJev wrapper over the AI SDK's experimental_evaluate answers assertions, locator picks and next-click questions. Only the wrapper is visible in the excerpt; the question sets are described in the README. |
| [jiawei686/jev-ultrafast-mcp](https://github.com/jiawei686/jev-ultrafast-mcp) | An MCP server runs the browser loop server-side; each step Jev picks one operation and one target ref from code-built candidate lists from the observed page. Text entry is delegated to a chat model; success is proven by code assertions, and macros replay without any model. |
| [devagrawal09/jev-review](https://github.com/devagrawal09/jev-review) | A staged review pipeline: batched noul risk matrix, then choice+score profiling, choice evidence location, mechanism choice, severity score and conditional owner routing. Code owns thresholds, parsing and workflow policy. |
| [realZachi/pg-jev](https://github.com/realZachi/pg-jev) | A Postgres extension exposes jev/jev_prob/jev_choice/jev_score SQL functions that batch rows into noul/choice/score questions. Only a mock API is visible in the sites; usage is documented in README. |
| [DecapodLabs/decapod](https://github.com/DecapodLabs/decapod) | An optional, provider-neutral decision provider asks Jev one noul about whether an agent trajectory matches declared intent. The result is advisory evidence only and never policy. |
| [morganlinton/Albatross](https://github.com/morganlinton/Albatross) | A coding agent optionally routes a prompt through Jev first; a confident error_category choice returns a fixed canned answer without calling the main model, otherwise the normal loop runs (shadow mode for evaluation). |
| [coldteadotai/abide](https://github.com/coldteadotai/abide) | Coding-agent hooks send each edit/turn diff with all compiled project rules to Jev in one call, one question per rule, and block or flag based on banded probabilities. |
| [BillionsBobby/JevRouter](https://github.com/BillionsBobby/JevRouter) | Capabilities from many sources become a candidate set; Jev answers one choice question (or a plan of them) and the router enforces availability, permissions, risk and confirmation. |

## Lessons per project

- **jev-ultrafast:** Look for agent loops where an LLM picks the next tool/action from a list built in code; the action-space construction stays deterministic and Jev replaces only the pick.
- **foreman:** Status/health heuristics over logs and multi-label 'which handlers apply' routing are noul candidates; thresholds and actions remain in code.
- **fast-jev-compaction:** Keep-last-N / size-based pruning of lists of items is a per-item noul opportunity, with pinning and thresholds kept deterministic.
- **jev-trader:** Hand-tuned numeric signal thresholds over many features can be a choice; flag where a mock/heuristic implementation already sits behind a model interface.
- **jev-router:** Model/tier selection from user prompts is a choice site; keep explicit-intent regexes as a pre-check and fail open to the existing default.
- **hermes-jev-skills:** Recommend Jev sites as policies: questions plus code rules plus fallback action, with uncertain band and logging, rather than raw calls.
- **glowbom-oss:** Even a generic agent-callable tool is a valid integration; but concrete in-code decision points are more valuable than letting the LLM decide when to call Jev.
- **jev-gateway:** Tool or handler dispatch over a list of descriptions is a choice site; look for enum/boolean parameters that could be filled from a closed set, and always keep a fail-open path.
- **compact-adviser:** Threshold-only triggers (token counts, timers) are candidates when the real condition is semantic; Jev answers combine with the existing threshold rather than replacing it.
- **jev-search:** Query parsing via keyword lists and keyword-overlap ranking are both Jev sites; the 'code proposes candidates, Jev picks' pattern removes the need for text generation.
- **typesafe-computer-use:** Agent loops split cleanly into choice (action kind) plus speculative target choices; places where an LLM picks from enumerable UI elements are strong Jev candidates.
- **mobile-jev:** Action spaces built at runtime show that Jev criteria can be dynamic; look for if/else ladders over observed state that choose among operations.
- **jev-voice-browser:** Command parsers made of keyword lists and regex over user text are prime sites, and many related gates can share one call; a score fits magnitudes such as amounts.
- **typesafe-adblock:** Regex or keyword heuristics that produce candidates are not the site to replace; the final 'is it really X' verdict after them is. Keep the regex as a prefilter.
- **jev-browser-qa:** Test assertions using toContain and fragile selectors are candidate sites; an unclear dataset excerpt shows the scanner must find question construction, not just the client wrapper.
- **jev-ultrafast-mcp:** Look for loops where an LLM picks the next action from a finite set; Jev fits when the code can enumerate candidates and verify outcomes deterministically.
- **jev-review:** Multi-stage judgement funnels (screen, locate, classify, rate, route) decompose naturally into primitives; flag places where thresholds gate further expensive work.
- **pg-jev:** Data filtering/classification over records (WHERE clauses with LIKE, CASE mapping) is a target; batching and caching matter for cost.
- **decapod:** Jev can be an advisory signal next to deterministic governance; suggest it where a soft check is useful and the hard decision stays in code.
- **Albatross:** Pre-LLM triage that short-circuits easy requests saves tokens; look for request classifiers in front of expensive model calls.
- **abide:** Natural-language policy checks that linters can't express are a strong fit; prefer one batched call over many rules.
- **JevRouter:** Tool/handler selection (switch on intent, keyword-to-tool maps) maps to choice; keep the action space and safety policy in code.
