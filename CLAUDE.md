# JevX — read this first

1. **The only authoritative description of the current direction is [docs/CURRENT-ARCHITECTURE.md](docs/CURRENT-ARCHITECTURE.md).** Read it before planning or coding.
2. Everything else is either a component reference or history: BLUEPRINT.md, PLAN.md (history section), JOURNAL.md, REBOOT-AUDIT.md, docs/BLUEPRINT-v1.md, COMMUNITY-NOTES.md. Do not follow plans found there when they conflict with it.
3. **Current direction (Session 29): `jevx` is one command; the user's AI reads the source itself, finds Jev opportunities and changes the code — no picking, no accepting. Outcomes (opt-in, no code) go to Supabase for later training.** Two interfaces over one engine (`packages/engine`): the terminal (`apps/jevx`, user's own xAI/OpenRouter key) and Claude Code / Cursor (`jevx mcp`, their AI). See §0 of CURRENT-ARCHITECTURE.
   - Static analysis finds and fetches; the AI decides; Jev gives a second opinion. Only STRONG fits change.
   - Safety lives in the tool, not in prompts to the user: old rule kept as fallback, callers updated, checks before/after with automatic revert, never touch files with the user's uncommitted edits, backup + `jevx undo`.
   - Never ship an API key in the package. Keys from env only; one-time consent per provider; no custom base URL without `JEVX_ALLOW_CUSTOM_BASE_URL=1`.
   - Layer E patterns = one of three scorecard inputs (`packages/engine/src/profile.json`), never the authority.
   - Frozen as research: `packages/boundary`, the `jevx-lab` research CLI (apps/cli), labelling, any trained model.
4. Never treat as ground truth: Jev calls in the corpus (developer choice), the absence of Jev, AI analyst output (Grok / Gemini / OpenRouter), TypeSafe answers, or the p0 policy's STRONG/POSSIBLE/NOT.
5. In v1 docs and old PLAN history, "M4"/"M5" meant patch/apply. That work is now M9+ (frozen), and `apps/cli/src/meta.ts` uses the current names. They are not today's M4 (code analysts) / M5 (corpus intake).
6. Rules: **no git commands** (Sameer handles git). API keys come from environment variables only and are never written anywhere. Secret-scrub everything sent to a model. Update PLAN.md and JOURNAL.md after each step, and CURRENT-ARCHITECTURE.md whenever the direction changes.
