// JevX for GitHub: the analysis. Pure functions with an injected `fetch`, so the same code
// runs in the extension and in Node tests. Read-only: nothing is ever written to GitHub.
//
// Flow: repo URL → file tree (GitHub API) → pick likely files (local, free) → fetch them
// (raw.githubusercontent.com) → one AI call (Gemini, xAI or OpenRouter, your key) reads them and names Jev spots →
// each spot gets a scorecard: AI + patterns + TypeSafe (Jev's own opinion, if you add a TypeSafe key),
// plus how often real open-source Jev projects use the same kind of decision (docs/COMMUNITY-PATTERNS.md).
import PROFILE from "./profile.json" with { type: "json" };
import COMMUNITY from "./community.json" with { type: "json" };

export const DEFAULT_MODEL = "auto"; // Gemini: pick the newest flash-lite this key can use (free tier friendly)
export const PROVIDERS = {
  gemini: { label: "Gemini", model: "auto", keyHint: "aistudio.google.com/apikey", hostname: "generativelanguage.googleapis.com" },
  xai: { label: "xAI (Grok)", model: "grok-4.6", keyHint: "console.x.ai", hostname: "api.x.ai" },
  openrouter: { label: "OpenRouter", model: "x-ai/grok-4.6", keyHint: "openrouter.ai/keys", hostname: "openrouter.ai" }
};
export const PROMPT_VERSION = "ext-1";
const MAX_FILE_BYTES = 80_000;
// Two depths. Scanning is local and free (plain file downloads + regex signals); only the
// best-signal files go to the AI, so the AI bill grows much slower than the repo.
export const DEPTHS = {
  standard: { scan: 400, promptChars: 120_000 }, // ~35k AI tokens
  deep: { scan: 2500, promptChars: 360_000 } // whole repo for most projects; ~100k AI tokens
};

// ─── URL ───
const NOT_REPO = new Set(["settings", "orgs", "marketplace", "explore", "topics", "notifications", "pulls", "issues", "login", "signup", "features", "sponsors", "about", "pricing", "search", "new", "codespaces", "collections", "trending", "apps", "enterprise", "organizations", "users", "site", "security"]);
/** owner/repo (and branch/path when on a tree or blob page) from a github.com URL, or null. */
export function parseRepoUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname !== "github.com") return null;
  const [owner, repo, kind, ref, ...rest] = u.pathname.split("/").filter(Boolean);
  if (!owner || !repo || NOT_REPO.has(owner.toLowerCase())) return null;
  const name = repo.replace(/\.git$/, "");
  return { owner, repo: name, full: `${owner}/${name}`, ...(kind === "tree" || kind === "blob" ? { ref, path: rest.join("/") } : {}) };
}

// ─── GitHub ───
async function gh(fetch, url, token, accept = "application/vnd.github+json") {
  const r = await fetch(url, { headers: { Accept: accept, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (r.status === 404) throw new Error("Repo not found. If it's private, add a GitHub token in JevX options.");
  if (r.status === 403 || r.status === 429) throw new Error("GitHub rate limit reached. Add a GitHub token in JevX options (free, read-only).");
  if (!r.ok) throw new Error(`GitHub error ${r.status}`);
  return r;
}

export async function repoTree({ fetch, owner, repo, token, ref }) {
  const meta = await (await gh(fetch, `https://api.github.com/repos/${owner}/${repo}`, token)).json();
  const branch = ref || meta.default_branch;
  const tree = await (await gh(fetch, `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, token)).json();
  const files = (tree.tree ?? []).filter((t) => t.type === "blob").map((t) => ({ path: t.path, size: t.size ?? 0 }));
  return { meta: { stars: meta.stargazers_count, language: meta.language, description: meta.description, private: meta.private }, branch, files, truncated: Boolean(tree.truncated) };
}

// ─── picking files (local, free) ───
const SRC = /\.(ts|tsx|js|jsx|mjs|cjs|py)$/;
const SKIP = /(^|\/)(node_modules|dist|build|out|vendor|coverage|\.next|\.nuxt|__pycache__|\.venv|venv|public|static|assets|fixtures|__mocks__|migrations)\/|\.d\.ts$|\.min\.js$|(^|\/)(test|tests|__tests__|e2e|spec)\/|\.(test|spec|stories)\.\w+$|(^|\/)(jest|vite|vitest|webpack|rollup|babel|eslint|tailwind|postcss|next|nuxt|playwright|tsup)\.config\.\w+$/i;
const LOGIC = /(^|\/)(api|lib|server|services?|core|agents?|routes?|handlers?|controllers?|domain|utils?|engine|bot|workers?|jobs?|llm|ai|pipeline|src)\//i;
const UI = /(^|\/)(components?|ui|views?|pages?|styles?|app\/\(.*\))\//i;

// file names that usually hold a judgment call
const DECIDES = /(classif|categor|moderat|filter|spam|detect|intent|route|router|triage|rank|scor|priorit|label|sentiment|tone|toxic|policy|guard|valid|review|match|recommend|prompt|llm|agent|judge|decid|select|pick|tag)/i;

export function pickFiles(files, scopePath, limit = DEPTHS.standard.scan) {
  return files
    .filter((f) => SRC.test(f.path) && !SKIP.test(f.path) && f.size <= MAX_FILE_BYTES)
    // one-line re-exports and index barrels hold no decisions (kept only if that's all there is)
    .filter((f, _i, all) => f.size >= 300 || scopePath || all.every((g) => g.size < 300))
    .filter((f) => !scopePath || f.path === scopePath || f.path.startsWith(scopePath.replace(/\/?$/, "/")))
    .map((f) => ({ ...f, prior: (LOGIC.test(f.path) ? 2 : 0) + (DECIDES.test(f.path.split("/").pop()) ? 3 : 0) - (UI.test(f.path) ? 1 : 0) + (/\.(tsx|jsx)$/.test(f.path) ? -0.5 : 0) }))
    // within the same prior, bigger files first: that is where the logic lives
    .sort((a, b) => b.prior - a.prior || b.size - a.size)
    .slice(0, limit);
}

/** Cheap signals that a file holds judgment calls written as rules (or as LLM calls). */
export function signals(text) {
  const count = (re) => (text.match(re) ?? []).length;
  const s = {
    regexTest: count(/\/[^/\n]{3,}\/[gimsuy]*\.test\(/g) + count(/\.match\(\s*\//g) + count(/re\.(search|match)\(/g),
    keywordList: count(/\[\s*(["'`][\w\s-]{2,}["'`]\s*,\s*){3,}/g),
    includesChain: count(/\.(includes|startsWith|endsWith)\(\s*["'`]/g) + count(/\bin\s+\w+\.lower\(\)/g),
    sliceTopN: count(/\.slice\(\s*0\s*,\s*\d+\s*\)/g) + count(/\[\s*:\s*\d+\s*\]/g),
    threshold: count(/[<>]=?\s*0\.\d+/g),
    llmCall: count(/chat\.completions\.create|messages\.create\(|generateContent\(|\.invoke\(|ChatOpenAI|ChatAnthropic|generateText\(|generateObject\(|streamText\(|\/chat\/completions|\/v1\/messages|ollama\.|litellm|completion\(\s*model|\bresponse_format\b|structured_output|with_structured_output/g),
    stringSwitch: count(/case\s+["'`][\w\s-]+["'`]\s*:/g),
    jev: count(/systemOne|@typesafe-ai\/sdk|TypeSafeClient/g)
  };
  const score = s.regexTest * 2 + s.keywordList * 2 + s.includesChain + s.sliceTopN + s.threshold + s.llmCall * 3 + s.stringSwitch * 0.5;
  return { ...s, score };
}

// secrets never leave the browser: scrub anything that looks like a key before sending code to the AI
const SECRET = [/(sk|pk|rk)[-_](live|test|proj|ant|or)?[-_]?[A-Za-z0-9_-]{16,}/g, /xai-[A-Za-z0-9]{20,}/g, /AIza[0-9A-Za-z_-]{30,}/g, /gh[pousr]_[A-Za-z0-9]{30,}/g, /github_pat_[A-Za-z0-9_]{30,}/g, /eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, /AKIA[0-9A-Z]{16}/g, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g];
export function scrub(text) {
  return SECRET.reduce((t, re) => t.replace(re, "[secret removed]"), text);
}

export async function fetchFiles({ fetch, owner, repo, branch, files, token, concurrency = 12, onProgress }) {
  const out = [];
  let i = 0;
  let done = 0;
  const one = async () => {
    while (i < files.length) {
      const f = files[i++];
      try {
        // raw.githubusercontent.com is not rate limited like the API (private repos need the API + token)
        const r = token
          ? await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${f.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`, { headers: { Accept: "application/vnd.github.raw", Authorization: `Bearer ${token}` } })
          : await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${f.path.split("/").map(encodeURIComponent).join("/")}`);
        if (r.ok) out.push({ path: f.path, text: await r.text(), prior: f.prior });
      } catch { /* skip this file */ }
      if (++done % 25 === 0) onProgress?.(done, files.length);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, one));
  return out;
}

/** Files to show the AI: highest signals first, within the prompt budget. */
export function chooseForPrompt(fetched, budget = DEPTHS.standard.promptChars) {
  const ranked = fetched.map((f) => ({ ...f, sig: signals(f.text) })).sort((a, b) => b.sig.score + b.prior - (a.sig.score + a.prior));
  const chosen = [];
  let used = 0;
  for (const f of ranked) {
    if (f.sig.jev > 0 && f.sig.score === 0) continue;
    // files with no signal only fill in when nothing else was found (judgment may still hide in plain ifs)
    if (f.sig.score === 0 && chosen.length >= 8) continue;
    const size = f.text.length + 200;
    if (used + size > budget) continue;
    chosen.push(f);
    used += size;
  }
  return { chosen, existingJev: ranked.filter((f) => f.sig.jev > 0).map((f) => f.path), withSignal: ranked.filter((f) => f.sig.score > 0).length };
}

// ─── the AI ───
const FEATURES = ["semantic_ambiguity", "context_dependence", "deterministic_expressibility", "judgment_required", "rule_stability", "risk_or_policy_component", "natural_language_understanding", "decision_complexity"];
const LEVELS = ["none", "low", "medium", "high"];

export function buildPrompt({ full, description, files, existingJev }) {
  const numbered = files.map((f) => `=== FILE ${f.path} ===\n${scrub(f.text).split("\n").map((l, i) => `${i + 1}: ${l}`).join("\n")}`).join("\n\n");
  return [
    "You are JevX. Find places in this repository where a decision should be made by Jev (TypeSafe), a typed judgment model with three primitives:",
    "- noul: a yes/no judgment (e.g. 'Is this message asking for a refund?')",
    "- choice: pick one option from a fixed list the code provides (e.g. which team, which tool, which error kind)",
    "- score: a rating on a fixed scale (e.g. urgency 1–5)",
    "",
    "Strong fits (seen in real Jev projects):",
    "1. An LLM call whose answer is parsed into one of a few labels or a yes/no (routing, classification, next action, relevance). Jev does this faster and typed. This is the most common real use.",
    "2. Regexes / keyword lists / includes() chains that guess what free text means (user messages, error messages, AI output, names).",
    "3. Hardcoded ranking or top-N of messy items where 'best' is a judgment, and magic thresholds on fuzzy signals.",
    "Not fits (exact logic): money and payments, auth and permissions, parsing and format validation, state machines, math, UI layout, anything with one correct answer.",
    "In every good Jev use, code builds the options, Jev picks, and the old rule stays as the fallback.",
    "",
    `ai_score rubric (use the whole scale): 0.9 = like real Jev uses — messy input judged, the current rule visibly fails or an LLM is used just to pick a label, outcomes are bounded; 0.7 = clear improvement; 0.5 = plausible but small; 0.3 = exact rules would do; 0.1 = exact logic.`,
    "Name at most 8 spots, best first. Use exact file paths and line numbers from the numbered code. Return [] if nothing fits — an empty answer is fine.",
    existingJev.length ? `The repo already uses Jev in: ${existingJev.join(", ")} — don't repeat those.` : "",
    "",
    `Repository: ${full}${description ? ` — ${description}` : ""}`,
    "",
    numbered
  ].filter((l) => l !== "").join("\n");
}

const str = (description) => ({ type: "STRING", description });
export const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    spots: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          file: str("exact path"),
          start_line: { type: "INTEGER" },
          end_line: { type: "INTEGER" },
          function: str("function or block name"),
          decides: str("one sentence: what this code decides today"),
          current_rule: { type: "STRING", enum: ["llm_call", "regex", "keyword_list", "includes_or_startswith", "lookup_with_default", "sort_or_slice", "threshold", "if_else_chain", "switch", "other"] },
          input_kind: { type: "STRING", enum: ["user_text", "error_message", "ai_output", "external_api_results", "free_text_name", "structured_app_data", "ui_state", "code_or_diff", "other"] },
          primitive: { type: "STRING", enum: ["noul", "choice", "score"] },
          question: str("the question Jev would answer"),
          outcomes: { type: "ARRAY", items: { type: "STRING" } },
          why: str("one sentence: why Jev beats the current rule"),
          fallback: str("what stays as the fallback"),
          ai_score: { type: "NUMBER" },
          features: { type: "OBJECT", properties: Object.fromEntries(FEATURES.map((f) => [f, { type: "STRING", enum: [...LEVELS, "unknown"] }])) }
        },
        required: ["file", "start_line", "end_line", "decides", "primitive", "question", "why", "ai_score"]
      }
    }
  },
  required: ["spots"]
};

const GEMINI = "https://generativelanguage.googleapis.com/v1beta";

/** Models this key can call with generateContent, newest-looking first. */
export async function listGeminiModels({ fetch, key }) {
  const r = await fetch(`${GEMINI}/models?pageSize=200`, { headers: { "x-goog-api-key": key } });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.models ?? []).filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent")).map((m) => String(m.name).replace(/^models\//, ""));
}

/** The closest available model to what was asked: same family (flash-lite → flash → pro), newest version first. */
export function pickModel(wanted, available) {
  if (available.includes(wanted)) return wanted;
  const usable = available.filter((m) => /^gemini-/.test(m) && !/(embedding|aqa|tts|image|live|audio|vision|exp|preview-\d{2}-\d{2})/.test(m));
  const ver = (m) => Number((m.match(/gemini-(\d+(?:\.\d+)?)/) ?? [])[1] ?? 0);
  const fam = (m) => (/flash-lite/.test(m) ? "flash-lite" : /flash/.test(m) ? "flash" : /pro/.test(m) ? "pro" : "other");
  const want = fam(wanted);
  for (const f of [want, "flash-lite", "flash", "pro"]) {
    const c = usable.filter((m) => fam(m) === f).sort((a, b) => ver(b) - ver(a) || a.length - b.length);
    if (c.length) return c[0];
  }
  return undefined;
}

async function geminiError(r) {
  let msg = "";
  try { msg = (await r.json())?.error?.message ?? ""; } catch { /* not json */ }
  return msg;
}

export async function askGemini({ fetch, key, model = DEFAULT_MODEL, prompt }) {
  const call = (m) => fetch(`${GEMINI}/models/${encodeURIComponent(m)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA } })
  });
  let used = model && model !== "auto" ? model : undefined;
  if (!used) {
    used = pickModel("gemini-flash-lite", await listGeminiModels({ fetch, key }));
    if (!used) throw new Error("This Gemini key can't list any models. Check the key at aistudio.google.com/apikey.");
  }
  let r = await call(used);
  if (r.status === 404) {
    // the model was renamed or retired, or this key can't use it: pick the closest one the key can use
    const next = pickModel(used, (await listGeminiModels({ fetch, key })).filter((m) => m !== used));
    if (!next) throw new Error(`Gemini model "${used}" isn't available for this key, and no other Gemini model was found. Check the key at aistudio.google.com/apikey.`);
    used = next;
    r = await call(used);
  }
  if (!r.ok) {
    const msg = await geminiError(r);
    if (r.status === 400 && /API key/i.test(msg)) throw new Error("Gemini rejected the API key. Check it in JevX options.");
    if (r.status === 401 || r.status === 403) throw new Error(`Gemini refused the request (${r.status})${msg ? `: ${msg}` : ""}. Use an API key from aistudio.google.com/apikey.`);
    if (r.status === 429) throw new Error("Gemini quota reached. Try again in a minute.");
    throw new Error(`Gemini error ${r.status}${msg ? `: ${msg}` : ""}`);
  }
  const j = await r.json();
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error(`Gemini returned no answer${j.promptFeedback?.blockReason ? ` (blocked: ${j.promptFeedback.blockReason})` : ""}. Try again.`);
  const usage = j.usageMetadata ?? {};
  return { text, model: used, tokens: { input: usage.promptTokenCount ?? 0, output: usage.candidatesTokenCount ?? 0 } };
}

/** xAI and OpenRouter speak the OpenAI chat format. The schema goes in the prompt; the answer must be JSON. */
export async function askChat({ fetch, provider, key, model, prompt }) {
  const P = PROVIDERS[provider];
  const url = provider === "xai" ? "https://api.x.ai/v1/chat/completions" : "https://openrouter.ai/api/v1/chat/completions";
  const used = model && model !== "auto" ? model : P.model;
  const body = {
    model: used,
    temperature: 0,
    max_tokens: 16000, // reasoning models think before answering
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `Answer with one JSON object only, matching this JSON schema (types in Google-style uppercase):\n${JSON.stringify(RESPONSE_SCHEMA)}` },
      { role: "user", content: prompt }
    ]
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...(provider === "openrouter" ? { "X-Title": "JevX for GitHub" } : {}) },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    let msg = "";
    try { const j = await r.json(); msg = j?.error?.message ?? (typeof j?.error === "string" ? j.error : ""); } catch { /* not json */ }
    if (r.status === 401 || r.status === 403) throw new Error(`${P.label} rejected the API key${msg ? `: ${msg}` : ""}. Check it in JevX options.`);
    if (r.status === 404) throw new Error(`${P.label} doesn't know the model "${used}"${msg ? `: ${msg}` : ""}. Change it in JevX options.`);
    if (r.status === 402) throw new Error(`${P.label}: no credits left on this key${msg ? ` (${msg})` : ""}.`);
    if (r.status === 429) throw new Error(`${P.label} rate limit reached. Try again in a minute.`);
    throw new Error(`${P.label} error ${r.status}${msg ? `: ${msg}` : ""}`);
  }
  const j = await r.json();
  const raw = j.choices?.[0]?.message?.content ?? "";
  const text = String(raw).replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  if (!text.trim()) throw new Error(`${P.label} returned no answer. Try again or pick another model.`);
  return { text, model: j.model ?? used, tokens: { input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0 } };
}

export function askAI({ provider = "gemini", ...rest }) {
  return provider === "gemini" ? askGemini(rest) : askChat({ provider, ...rest });
}

// ─── scorecard (same rules as the CLI) ───
const rank = (l) => LEVELS.indexOf(l);
export function patternScore(levels = {}) {
  let sum = 0;
  let n = 0;
  for (const f of FEATURES) {
    const l = levels[f];
    const p = PROFILE.features[f];
    if (!l || l === "unknown" || !p || rank(l) < 0) continue;
    const dj = Math.abs(rank(l) - rank(p.jevTop));
    const dd = Math.abs(rank(l) - rank(p.deterministicTop));
    sum += dj < dd ? 1 : dj > dd ? 0 : 0.5;
    n++;
  }
  return n ? sum / n : undefined;
}

export function combine(scores) {
  const present = Object.entries(scores).filter(([, v]) => typeof v === "number");
  if (!present.length) return { scores, verdict: "WEAK_FIT" };
  const average = present.reduce((s, [, v]) => s + v, 0) / present.length;
  const yes = present.some(([, v]) => v >= 0.5);
  const no = present.some(([, v]) => v < 0.5);
  const verdict = yes && no ? "REVIEW_DISAGREE" : average >= 0.7 ? "STRONG_FIT" : average >= 0.5 ? "POSSIBLE_FIT" : "WEAK_FIT";
  return { scores, average, verdict };
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export function parseSpots(text, files) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("The AI's answer wasn't valid JSON. Try again."); }
  const byPath = new Map(files.map((f) => [f.path, f.text.split("\n").length]));
  const out = [];
  for (const s of data.spots ?? []) {
    const lines = byPath.get(s.file);
    if (!lines) continue; // a file it wasn't shown: drop
    const start = clamp(Math.round(s.start_line), 1, lines);
    const end = clamp(Math.round(s.end_line ?? start), start, Math.min(lines, start + 80));
    const ai = clamp(Number(s.ai_score) || 0, 0, 1);
    const patterns = patternScore(s.features);
    out.push({ ...s, start_line: start, end_line: end, outcomes: (s.outcomes ?? []).slice(0, 8), card: combine({ ai, ...(patterns === undefined ? {} : { patterns }) }) });
  }
  return out.sort((a, b) => (b.card.average ?? 0) - (a.card.average ?? 0)).slice(0, 8);
}

// ─── TypeSafe: Jev's own opinion (same questions and formula as the CLI's scorecard) ───
const TS_QUESTIONS = {
  judgment: { type: "noul", instructions: "Does the decision in boundary_code require interpreting meaning or context (what something is about, how good, how risky, what should happen next), rather than applying an exact rule to exact values?", criteria: { true: "Choosing the outcome needs judgment: two people could reasonably disagree, paraphrases or new situations should lead to the same outcome, and the code is approximating that judgment.", false: "The outcome follows exactly from the inputs: arithmetic, exact lookups, parsing, protocol or status handling, typed enum dispatch, validation, formatting, or a business rule that must stay exact." } },
  bounded: { type: "noul", instructions: "Are the possible outcomes of this decision a small, known set of options or a graded level?", criteria: { true: "The outcomes can be listed (labels, routes, actions, yes/no) or are a level on a scale.", false: "The outcome is open-ended: generated text, arbitrary data, a computed value with no fixed set of options." } },
  deterministic_is_correct: { type: "noul", instructions: "Would exact, deterministic code still be the right way to make this decision even if a reliable semantic model were available?", criteria: { true: "Exactness is required or the rule is fully specified: money, security, protocols, legal limits, parsing, data plumbing.", false: "The hardcoded rule is a brittle stand-in for a judgment a model could make better." } }
};
/** The CLI's formula (packages/engine/src/scorecard.ts typesafeScore). */
export const typesafeScore = (a) => a.bounded * (0.6 * a.judgment + 0.4 * (1 - a.deterministicIsCorrect));

export async function askTypeSafe({ fetch, key, file, code, spot }) {
  const state = {
    language: /\.py$/.test(file) ? "Python" : /\.(ts|tsx|mts|cts)$/.test(file) ? "TypeScript" : "JavaScript",
    file,
    decision_summary: spot.decides,
    proposed_primitive: spot.primitive,
    proposed_question: spot.question,
    outcomes: (spot.outcomes ?? []).slice(0, 12),
    stays_deterministic: spot.fallback ?? "",
    boundary_code: scrub(code)
  };
  const r = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ state, questions: TS_QUESTIONS, model: "jev-latest" })
  });
  if (r.status === 401 || r.status === 403) throw new Error("TypeSafe rejected the API key. Check it in JevX options.");
  if (!r.ok) throw new Error(`TypeSafe error ${r.status}`);
  const j = await r.json();
  const a = { judgment: j.answers?.judgment?.noul, bounded: j.answers?.bounded?.noul, deterministicIsCorrect: j.answers?.deterministic_is_correct?.noul };
  if (![a.judgment, a.bounded, a.deterministicIsCorrect].every((x) => typeof x === "number")) throw new Error("TypeSafe returned an unexpected answer");
  return { score: typesafeScore(a), answers: a };
}

/** How often the 82 Jev decisions in real open-source projects replace this kind of rule. Context, not a score. */
export function communityNote(spot) {
  const r = COMMUNITY.byRule[spot.current_rule];
  if (!r) return undefined;
  return { count: r.count, total: COMMUNITY.total, projects: COMMUNITY.projects, repos: r.repos, rule: spot.current_rule };
}

// ─── reading in parts, two at a time ───
export const PARALLEL = 2; // two AI calls at once: faster, and well inside every provider's per-minute limits
const PART_CHARS = 40_000;

/** Split the chosen files into up to 8 parts of similar size (big files first). */
export function splitParts(files) {
  const total = files.reduce((n, f) => n + f.text.length, 0);
  // small repos: one call. Otherwise 2–4 parts, so two can run at once
  const k = files.length < 4 ? 1 : Math.min(8, Math.max(2, Math.ceil(total / PART_CHARS)));
  const parts = Array.from({ length: k }, () => ({ files: [], size: 0 }));
  for (const f of [...files].sort((a, b) => b.text.length - a.text.length)) {
    const p = parts.reduce((a, b) => (b.size < a.size ? b : a));
    p.files.push(f);
    p.size += f.text.length;
  }
  return parts.filter((p) => p.files.length).map((p) => p.files);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const retryable = (e) => /rate limit|quota|error 5\d\d|timed out|Failed to fetch|NetworkError|no answer/i.test(e instanceof Error ? e.message : String(e));

/** One AI call with a time limit, retried twice on rate limits / server hiccups (3s, then 8s). */
async function askWithRetry(args, onRetry) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await Promise.race([askAI(args), sleep(150_000).then(() => { throw new Error("The AI timed out after 150s"); })]);
    } catch (e) {
      if (attempt >= 2 || !retryable(e)) throw e;
      const wait = attempt === 0 ? 3000 : 8000;
      onRetry?.(wait, e);
      await sleep(wait);
    }
  }
}

/** The whole analysis. `progress(step, detail)` reports each stage to the UI. */
export async function analyzeRepo({ fetch, url, provider = "gemini", apiKey, geminiKey, githubToken, typesafeKey, model, depth = "standard", progress = () => {} }) {
  const D = DEPTHS[depth] ?? DEPTHS.standard;
  const P = PROVIDERS[provider];
  if (!P) throw new Error(`Unknown AI provider "${provider}".`);
  const key = apiKey ?? geminiKey;
  const r = parseRepoUrl(url);
  if (!r) throw new Error("Open a GitHub repository page first.");
  if (!key) throw new Error(`Add your ${P.label} API key in JevX options first.`);
  progress("tree", `Reading ${r.full}…`);
  const { meta, branch, files, truncated } = await repoTree({ fetch, owner: r.owner, repo: r.repo, token: githubToken, ref: r.ref });
  const picked = pickFiles(files, r.path, D.scan);
  const candidates = files.filter((f) => SRC.test(f.path) && !SKIP.test(f.path)).length;
  if (!picked.length) return { repo: r.full, branch, meta, spots: [], note: "No JavaScript, TypeScript or Python source files found.", stats: { files: files.length, fetched: 0, sent: 0 } };
  progress("fetch", `Scanning ${picked.length} source file(s) on your computer…`, { scanned: 0, total: picked.length });
  const fetched = await fetchFiles({ fetch, owner: r.owner, repo: r.repo, branch, files: picked, token: githubToken, onProgress: (n, t) => progress("fetch", `Scanned ${n} of ${t}`, { scanned: n, total: t }) });
  const { chosen, existingJev, withSignal } = chooseForPrompt(fetched, D.promptChars);
  // the AI reads in parts, PARALLEL at a time; every part reports its own progress
  const groups = splitParts(chosen);
  const parts = groups.map((g, i) => ({ n: i + 1, files: g.map((f) => f.path), status: "waiting" }));
  const report = () => progress("ai", `${P.label} is reading ${chosen.length} file(s) in ${parts.length} part(s)`, { parts: parts.map((x) => ({ ...x })) });
  report();
  const answers = [];
  let next = 0;
  let usedModel = model;
  const worker = async () => {
    while (next < groups.length) {
      const i = next++;
      const part = parts[i];
      part.status = "reading";
      part.started = Date.now();
      report();
      try {
        const prompt = buildPrompt({ full: r.full, description: meta.description, files: groups[i], existingJev });
        const ans = await askWithRetry({ provider, fetch, key, model: usedModel, prompt }, (wait) => { part.status = "retrying"; part.wait = wait; report(); });
        if (ans.model) usedModel = usedModel && usedModel !== "auto" ? usedModel : ans.model; // later parts reuse the model the first one found
        const found = parseSpots(ans.text, groups[i]);
        answers.push({ ans, found });
        Object.assign(part, { status: "done", spots: found.length, ms: Date.now() - part.started });
      } catch (e) {
        Object.assign(part, { status: "error", error: e instanceof Error ? e.message : String(e), ms: Date.now() - part.started });
      }
      report();
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, groups.length) }, worker));
  const failed = parts.filter((x) => x.status === "error");
  if (!answers.length) throw new Error(failed[0]?.error ?? "The AI returned nothing.");
  const ans = { model: answers[0].ans.model, tokens: answers.reduce((t, a) => ({ input: t.input + (a.ans.tokens?.input ?? 0), output: t.output + (a.ans.tokens?.output ?? 0) }), { input: 0, output: 0 }) };
  let spots = answers.flatMap((a) => a.found).sort((a, b) => (b.card.average ?? 0) - (a.card.average ?? 0)).slice(0, 8);
  let typesafe = { status: typesafeKey ? "on" : "off" };
  if (typesafeKey && spots.length) {
    progress("typesafe", `TypeSafe (Jev) is scoring ${spots.length} spot(s)…`);
    const byPath = new Map(chosen.map((f) => [f.path, f.text.split("\n")]));
    const errors = [];
    await Promise.all(spots.map(async (s) => {
      const lines = byPath.get(s.file) ?? [];
      const code = lines.slice(Math.max(0, s.start_line - 6), s.end_line + 5).join("\n");
      try {
        const t = await askTypeSafe({ fetch, key: typesafeKey, file: s.file, code, spot: s });
        s.card = combine({ ...s.card.scores, typesafe: t.score });
      } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
    }));
    if (errors.length) typesafe = { status: "error", error: errors[0], failed: errors.length };
    spots = spots.sort((a, b) => (b.card.average ?? 0) - (a.card.average ?? 0));
  }
  // keep the exact lines (secrets removed) so the card can show *where* — capped to stay small in storage
  const linesOf = new Map(chosen.map((f) => [f.path, f.text.split("\n")]));
  for (const s of spots) {
    s.community = communityNote(s);
    const lines = linesOf.get(s.file) ?? [];
    const end = Math.min(s.end_line, s.start_line + 13);
    s.code = scrub(lines.slice(s.start_line - 1, end).join("\n")).slice(0, 2000);
    s.code_more = s.end_line > end;
  }
  progress("done", `${spots.length} spot(s)`);
  return { repo: r.full, branch, meta, spots, existingJev, truncated, provider, typesafe, model: ans.model, tokens: ans.tokens, parts: parts.map(({ n, files: f, status, spots: k, ms, error }) => ({ n, files: f, status, spots: k, ms, error })), depth, stats: { files: files.length, candidates, fetched: fetched.length, withSignal, sent: chosen.length, failedParts: failed.length }, at: new Date().toISOString() };
}
