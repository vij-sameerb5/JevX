# Jev community notes (saved for later)

> Reference material, not architecture. Current direction: [docs/CURRENT-ARCHITECTURE.md](docs/CURRENT-ARCHITECTURE.md).

> Sources: TypeSafe / Jev Discord, 2026-09-19. Part 1 is ≈2:57–5:36 AM and Part 2 is ≈3:19–7:37 PM; Part 3 is from the day before ("yesterday"), ≈9:56 AM–12:25 PM. All pasted by Sameer.
> Reference only — not part of the JevX plan. Links as posted; not verified.

## Takeaways worth remembering for JevX

- **"Brilliant decider, terrible writer."** Jev is a decision primitive (noul / choice / score + confidence), not a generator. Several people proved this the hard way by making it write word-by-word. → JevX's framing (AST finds decisions, Jev makes them) fits the model's real strength.
- **Deterministic code first, Jev only where judgement is needed.** Echoed by JEV FC (geometry/rules in Python, Jev as "coach"), RuleRaven (deterministic rules first, Jev only on ambiguous signals). Same split as JevX: AST owns provenance, TypeSafe owns meaning.
- **Cost/speed is the pitch:** OpenRouter: "10x cheaper and faster than an LLM"; Pinecone Cultivar: 18× faster, ~38× cheaper than Claude. Someone asked whether they measured *accuracy* too — the right question (JevX has an eval for exactly this).
- **Scores for graded judgements:** Allie (TypeSafe) uses Score questions with semantic levels (0 = not mentioned … 3 = thoroughly discussed) and tunes the threshold — a pattern JevX could use later (e.g. "how brittle is this branch").
- **Pushback heard:** "only so much Jev can do — primary use case is cost saving and speed for defined tasks"; "why do you even need Jev? that's a simple poll"; lag concerns when putting Jev on every button. → Pick decisions that are genuinely semantic; don't Jev everything (JevX's precision focus).
- **Distribution:** Jev is also on **OpenRouter** (usable without a TypeSafe invite). Lots of MCPs already exist (day 3–4). Plugins for Claude/Codex being built.
- **Cost warning:** one builder said generation-style use is "so expensive" — fine for decisions, not for token-by-token tricks.

## Projects & links

### Dev tools / agents (closest to JevX)
- **Tripmine_enjoyer** — Jev filters + sorts files relevant to a task, then feeds them to an LLM to edit/write/explain (proof of concept).
- **Gameson** — idea: LLM (Luna) generates question + options → Jev decides → route to Astra/Sol for implementation. Made an MCP.
- **Sataniel** — plugin for Claude & Codex where Jev picks which model to use per session.
- **Joy** — agent task autoscheduler: Jev rates dependencies between all task pairs → builds a DAG for parallelism. https://x.com/JoymFL/status/2101074155605225899
- **GuitarGuyNick — Rune**: adaptive agent harness; LLMs teach it to function without them. https://gitea.thingscouldgetdicey.online/conductor/rune
- **Kachowtowmater — terminal-board**: terminal kanban for people + AI agents. https://github.com/kachowtowmater/terminal-board
- **Sergio / LangWatch — Instant Evals**: run evals over all production traces, cheap, via Jev. https://x.com/_rchaves_/status/2101050389898338709
- **arjun (Pinecone) — Cultivar**: evaluate/benchmark agent skills & docs in sandboxes; Jev = 18× faster, ~38× cheaper than Claude. https://github.com/pinecone-io/cultivar
- **Oncooldown** — using TypeSafe's SDE cascade cookbook (mini → verify → reasoning) for loops. https://docs.typesafe.ai/cookbooks/sde_cascade
- **MrJoy** — applied for Jev for software-quality / architectural coherence in a "software factory", plus game analytics. https://mrjoy.com/hoo3

### Ops / data
- **Diego Dal Cero — RuleRaven**: open-source Kubernetes incident triage; deterministic rules first, Jev on ambiguous signals; read-only, no auto-remediation. https://github.com/ddalcero/ruleraven
- **psharma89** — Jev + OliverDB (OLAP) → on-the-fly OTel analysis / AI SRE. https://oliverdb.ai/
- **Adarsh — ZeroSweep**: "Jev vs LLM" triage + email workflow benchmark. https://sysadarsh-zerosweep.vercel.app/
- **brainstormity** — Jev Twitter market-sentiment analysis (claims a winning BTC call; code to be open-sourced). https://x.com/brainstormity/status/2101008659639672833
- **Frogboy — Clairvoyance**: Obsidian-like app; Jev classifies files with metadata.
- **MahJunks** — using Jev to QA their website. **Singularity 1.61** — integrated Jev into their SaaS.

### UI / generative UI
- **casungo — NoFlow**: Jev between a button and a modal; buttons express intent, Jev picks behaviour from click + app state. https://x.com/casungo/status/2101037798614499387 (discussion: better for longer-term behaviour / composing design-system modals than per-click)
- **Chris Tate — json-render + Jev**: instant generative UI from your own components. https://x.com/ctatedev/status/2101022101750571357
- **blackgirlbytes — Girl Dinner**: Jev decides what up to 8 people should eat. https://x.com/blackgirlbytes/status/2101051229249929516

### Games / simulations
- **Drags — JEV FC**: RoboCupJunior/Webots robot football; Jev = tactical coach several times/sec, Python does geometry/control; live probabilities shown. (repo coming)
- **Max Yankov — Jev plays StarCraft II**: Astra writes code, Jev decides; beat 3 campaign missions unattended. https://github.com/golergka/jev-plays-starcraft-2 · stream: https://x.com/i/broadcasts/1oJMvNMOYpOxQ
- **manub — Jev Arena**: 36 real-time games in one API call. https://jev-arena.vercel.app/
- **metasteve** — Jev plays Tetris in browser; "how much Jev wants a tetris" changes its play.
- **Kingpin / Sprite Fusion** — real-time game level generation with Jev. https://www.spritefusion.com/blog/generating-game-level-in-real-time-with-jev
- **RocketmanJP** — Jev plays a debug build of their game with decisions overlaid, no training.
- **TypeSafe stream** — Jev server you can join from a ZDoom client.
- **DigiDuncan** — "Superman vs Batman" choice question (fun; prep-time variants changed the odds).

### "Make Jev write" experiments (limits)
- **Finetuning singh — jev-chatbot**: word/letter-at-a-time replies; 254 meaning groups over 30k words, $0.003/reply; answers present, sentences broken ("is the is im is whale"). https://github.com/finetuningsingh/jev-chatbot
- **Charlie Graham** — next-word prediction with Jev. https://x.com/imcharliegraham/status/2101084015113744591

### Other / misc
- **OpenRouter explainer** on decision models: https://x.com/OpenRouter/status/2101061688338575739
- **Cal — Kracuible Garden v0.6** (multi-AI Discord garden, Forge artifact tool). https://calkra.substack.com/p/kracuible-update-09192026
- **taky — Rebind**: programmable input layer (Luau scripts, hardware USB output). https://www.rebind.gg/
- **myselfkushal — Poko**: AI motion video editor (waiting for Jev access). https://poko.video/
- Several people waiting on waitlist/invites (pedronaosn, d3adr1nger, Humayan_Kabir, TomTom).


---

# Part 2 — 2026-09-19, ≈3:19–7:37 PM

## Takeaways worth remembering for JevX

- **Closest prior art to JevX:**
  - **valentynkit's "Jev as grep replacement."** One English sentence ("builds a SQL query by string concatenation") is asked over every function in a buffer, in one request, and the results are ranked. That's ~$0.0005 per buffer and ~100 ms. Their point: the grep found 5 injection sites and there were 12. A reply suggested turning checks like this into an IDE lint or an agent-harness hook. This is the same shape as JevX: the AST finds candidates, Jev judges.
  - **nolan's PR-triage checks:** deadlocking migrations, mismatched up/down, whether tests triangulate on the intended behaviour, whether test names match their expectations.
  - **gavel:** routes bugs, triages failures and gates PRs.
- **Rewrite inspiration for M4:** **Seems** (kaveh) is Python plus plain-English conditions answered yes/no/unsure by Jev. It comes from a customer-service agent handling ~10K cases/day. A reply suggested going further: hook into the AST and treat anything that fails to parse as an English statement. That's the mirror image of JevX, which finds English-ish judgement already buried in code.
- **Calibration lessons (FlyingDutchGeek, GL-account coding):** these match our M3 findings.
  - Gate on confidence bands: p ≥ 0.7 fills the field automatically; below that, it fills it and flags it for review. In their sample, everything ≥ 0.84 was correct and everything ≤ 0.58 was arguable. Pick bands from **your own traffic**, not from what looks tidy.
  - Put candidates in `state` and bare ids as Choice options. Moving descriptions into criteria was ~8 points worse.
  - Choice has a **255-option limit**, which they work around with two rounds (category, then account). If round 1 drops the right category, round 2 can't recover.
  - More context fixed a wrong answer: one question per invoice instead of per line. Two accounts had the same name; per line it picked the wrong one at 0.79, with the whole invoice the right one at 0.94. That's the same lesson as JevX's `enclosing_function` fix.
  - **Non-determinism:** a 0.46 / 0.43 near-tie flipped between runs. They cache hard, and A/B-testing a prompt change needs many runs to beat the noise.
  - **Relevance to JevX:** our cache pins answers, so a few-case difference between prompt versions may just be noise. Borderline cases like `isGreeting` (0.49) and `retryable` (0.47) should be read with that in mind.
- **Question design (from the thread on o_o's agent-safety guard):** don't mix orthogonal ideas in one Choice. `needs_user_approval` is orthogonal to `on_task`, and `on_task` vs `malicious` can both be true at once. They split it into two Choices (intent: on_task / off_task / injected / needs_more_context; risk: safe / needs_approval / harmful), and someone suggested making risk a **Score**. Option ordering may also shift outcomes. This supports JevX's separate atomic questions (`semantic`, `humanText`, `kind`).
- **Known weak spot (fibs, Cognitive Fab):** they found three kinds of decision where Jev is excellent, and a fourth where it "answered confidently and was right half the time." Worth asking them which kind.
- **Baseline comparison (Espresso):** a Random Forest trained on the data vs. Jev with no training; Jev came surprisingly close. Explicitly not a claim that it's better.
- **OpenRouter:** someone asked for `OPENROUTER_API_KEY` support. Idea for JevX: let people validate through OpenRouter as well as the TypeSafe key (the SDK takes a custom `baseURL`, but the API compatibility is unverified).
- **Cost data points:** jev-commit's median commit is 1,048 input tokens, $0.000044, "four cents per thousand commits." gavel is 200 ms and $0.00002 per decision.

## Projects & links (Part 2)

### Code quality / dev workflow (most relevant)
- **valentynkit — jev-commit**: a commit-msg hook. It sends the message plus the staged diff in one call and asks five yes/no questions: does the message match the diff, debug leftovers, unmentioned work, a credential on an added line. It only blocks a staged private key; every error path exits 0. https://github.com/valentynkit/jev-commit · https://x.com/valentynkit/status/2101247446936346711
- **valentynkit — Jev as grep** (SQL-injection search in the editor). https://x.com/valentynkit/status/2101261981114142871
- **nolan** — PR triage tools (migrations, test triangulation, test naming).
- **plutus — gavel**: OpenClaw plugin to route bugs, triage failures and gate PRs. https://github.com/gregb100/gavel
- **kaveh — Seems**: a Python superset with plain-English conditions. https://kavehmz.github.io/seems-lang/ · https://github.com/kavehmz/seems-lang
- **Nasr — jev-cli**: a CLI covering Jev's capabilities, plus agent skills and hooks, including compaction. https://github.com/Nasrallah-AL/jev-cli
- **Gameson — Jevbridge**: an OSS ACP/MCP bridge that brings Jev into Codex, Claude, Grok and OpenCode. https://github.com/tacticocc/Jevbridge
- **(o_o)** — a Pi agent extension where Jev checks every tool call (on_task / needs approval / malicious / needs more context). It caught a README prompt-injection that tried to read `.env`.
- **Pedro Dias** — built a local Jev stand-in while waiting for access. https://www.digitaldias.com/blog/2026-09-19-jev-before-the-waitlist/
- **Jon — SkillBundle**: find and track AI coding skills, with Jev filtering by category. https://skillbundle.dev/
- **João Galego — Jevs-Garage**: small experiments building critical systems with Jev. https://github.com/JGalego/Jevs-Garage
- **Maris — Jev Playground.** https://jevtypesafe.vercel.app/

### Ops / infra / agents
- **Minh Nghia — jev-k8s-awareness**: Pod context in, Jev evaluates and acts (proof of concept). https://github.com/minhnghia2k3/jev-k8s-awareness
- **Njaal — HEIMEL**: an open-source "consequence boundary" for agents that checks authority, state and effect at execution time. https://github.com/Heimel-open/Heimel
- **EXUP (valoresearch)**: execution optimizer for AI systems (benchmark, optimize, prove the delta). https://valoresearch.org/exup/
- **Terrylim2768 — AI SMITH**: enterprise "governed digital workforce"; Jev as the decision layer (finance workflow, lead scoring, routing). No link.
- **fibs — Cognitive Fab**: extracts expertise from agent logs; measured Jev across four kinds of decision (see takeaways).

### Data / business
- **FlyingDutchGeek** — Dutch accounting SaaS that auto-codes invoice GL accounts (see takeaways).
- **dmd9898 — polar_llama**: Jev as a Polars dataframe plugin for feature extraction and rule-based row selection. https://github.com/pnthn-ai/polar_llama
- **Cure** — replaced Algolia (hosted search) with Jev and saves $60–100/month.
- **Espresso** — classification comparison against a Random Forest.
- **kaveh** — customer-service agent, ~90% automated, ~10K cases/day.

### Home / media / other
- **Colin — HA-Jev**: Home Assistant integration (sensors, automation actions, conversation agent). https://github.com/AboveColin/HA-Jev
- **valentynkit — jev-skip**: YouTube sponsor/intro/outro detection from captions, one probability per 30 s segment. https://x.com/valentynkit/status/2101277651780452542
- **snkii — Sori-1B-MCQ**: a 1B audio-language model that answers multiple-choice questions, inspired by Jev. https://huggingface.co/snkii/Sori-1B-MCQ
- **MithrilMan** — game sidekick companion using Jev. https://x.com/FabioAngela79/status/2101298338070941874
- **firehoses (n3o) — n3os**: AI tool directory. https://n3os.com/
- **Bulls&Bears** — a Chrome extension for trade risk (Massive API + Jev), distributed as an unsigned ZIP on Google Drive and untested by its own author. ⚠️ Don't install it from that link.
- **PJ** — idea: detect AI-agent "slop" in a server in real time.
- **Ezbaze** — ~500 npm downloads, all their own (joke).


---

# Part 3 — the day before, ≈9:56 AM–12:25 PM

## Takeaways worth remembering for JevX

- **Jev is on OpenRouter:** `openrouter.ai/~typesafe/jev-latest` costs $0.042 per million input tokens, $0 output, with a 32K context. People are using it there to skip the waitlist.
  - John (Swamp) uses the TypeSafe API directly, not OpenRouter.
  - This strengthens the case for letting JevX use an `OPENROUTER_API_KEY` option (compatibility not yet verified).
- **"It can't make a PowerPoint; it can tell you whether one covers what you wanted" (Solar).** That's the decider-not-writer rule again.
- **Real production numbers:**
  - **Swamp / John Watson — alert triage:** 91% cheaper and 14.8% faster. The pattern is "TypeSafe screens, Swamp routes, Claude gets the work worth paying for." Asked about accuracy: "very"; they missed no real alert across 100 signals.
  - **Solar:** call-outcome detection 10× faster at 70% lower cost, with fewer false follow-up locks. Live-objection detection +40 points. Email sentiment 10× faster, 70% cheaper, about +20 points.
  - **Piotr:** accounting bot is "so-so," but over 90% when the history is rich. Context matters, which is the same lesson as JevX's `enclosing_function`.
  - **sh0rtythegreat:** line-by-line ToS search was 23× faster than DeepSeek V4 Flash, and the LLM had a false positive Jev avoided. But **token counts were very high**, so per-line scoring can cost more than an LLM despite the cheap input-only pricing.
    - **Relevance to JevX:** watch state size. Our 55-case eval used ~51K input tokens, about 940 per call.
- **Advice worth keeping (John):** prepare by building a framework with screening decisions in place, so Jev just slots in. That's what JevX's decision-policy layer is.
- **Computer use with Jev as the action picker** (OCR or elements in, Jev chooses, a small LLM only for free text): ~155× cheaper than Opus 5 and ~20× faster, per its author. One tester said browser-use's jev-ultrafast "didn't pass my evals."

## Projects & links (Part 3)

### Agents / computer use / dev tools
- **awlevin — typesafe-computer-use**: OCR the screen, Jev classifies the next action, click. ~$0.0002 per step, macOS. https://github.com/awlevin/typesafe-computer-use · https://x.com/awlevin/status/2100262612428894676
- **vlad-terin — jev-browser**: Jev-powered element selection for an agent's existing computer-use tools (Codex). https://github.com/vlad-terin/jev-browser
- **jkudish — jev-browser**: browser use with Jev (less robust, more general). https://github.com/jkudish/jev-browser
- **browser-use — jev-ultrafast** (one tester: failed their evals). https://github.com/browser-use/jev-ultrafast
- **BlissF00l** — a research doc generated end to end with jev-browser in Codex. https://docs.google.com/document/d/137TWXtW30vn6C1PnI9DT0kz0_Qotse1K3eBh4xJ-DD4/edit
- **complexxsnake** — Jev + Claude Code + Unreal Engine MCP building a game (burned most of 5 h of Opus usage).
- **Autark — typesafe.zig**: a Zig 0.16 client for the System One API. https://mattneel.github.io/typesafe.zig
- **Patrick** — Discord/Slack message analyzer before sending, <0.1 s, debounced while typing.

### Production / business
- **John Watson (Swamp)** — alert triage writeup. https://blog.watson-labs.co.uk/typesafe-ai-alert-fatigue/
- **Solar** — call-outcome, objection and email-sentiment detection (numbers above).
- **Piotr Sobolewski** — accounting bot.
- **mmx** — wants to benchmark Jev for low-latency market decisions (enter/exit/hold/cancel) against LLMs and quant models.
- **sh0rtythegreat** — ToS ownership-clause finder based on the semantic_find cookbook. https://docs.typesafe.ai/cookbooks/semantic_find

### Learning / experiments
- **willdog** — "What if judgment were parallel?": 11 measured experiments. https://typesafe-parallel-judgment-lab.every-4573.chatgpt.site/ · from the Every article: https://every.to/also-true-for-humans/mini-vibe-check-typesafe-s-jev-judged-everything-i-ve-written-in-0-7-seconds
- **n86499** — "Jev Thermolinguistics": measuring how linguistic structure shifts Jev's judgments (text file shared in Discord, not saved).
- **Parzival — Magic-8-Jev.** https://willprout.github.io/magic-8-ball/
- **Anot** — a reality checker. https://x.com/Anot/status/2100822237221724317
- **riv** — Jev "hearing" music (toxicity). https://x.com/rrriviannn/status/2100807838566383819
- **fluxus — Textured**: words into soundtracks. https://textured.fyi/
- **Holokat** — real-time note classifier (LLM-written, engagement farming) plus ad blocker; they noted it may be against platform terms.
- **OpenRouter model page.** https://openrouter.ai/~typesafe/jev-latest
- Community suggestion: turn the show-and-tell channel into a forum so implementations are easier to find.
