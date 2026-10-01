// The side panel: shows the repo in the current tab, runs the analysis on click, renders scorecards.
import { analyzeRepo, parseRepoUrl, PROVIDERS } from "./lib/analyze.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (x) => (typeof x === "number" ? `${Math.round(x * 100)}%` : "—");
// what each verdict means for the reader, in one plain line (shown as a banner on the card)
const HEADLINE = {
  STRONG_FIT: ["Jev fits here", "Worth changing: the current rule is a judgment call."],
  POSSIBLE_FIT: ["Jev could help here", "Optional: a smaller win. Only change it if this case matters to you."],
  REVIEW_DISAGREE: ["Mixed signals: check before changing", "The scores disagree. Read the code; it may be fine as it is."],
  WEAK_FIT: ["Jev is not needed here", "Keep the current code: exact logic does this job."]
};
const VERDICT = { STRONG_FIT: "STRONG", POSSIBLE_FIT: "POSSIBLE", REVIEW_DISAGREE: "DISAGREE", WEAK_FIT: "WEAK" };

let current = null; // { owner, repo, full, ref?, path?, url }
let running = false;

const show = (id, on) => ($(id).hidden = !on);
const cacheKey = (full) => `result:${full}`;

async function settings() {
  const s = await chrome.storage.local.get(["provider", "geminiKey", "xaiKey", "openrouterKey", "githubToken", "typesafeKey", "models", "model"]);
  const provider = PROVIDERS[s.provider] ? s.provider : "gemini";
  const models = s.models ?? (s.model ? { gemini: s.model } : {});
  return { provider, apiKey: s[`${provider}Key`], model: models[provider] || undefined, githubToken: s.githubToken, typesafeKey: s.typesafeKey };
}

async function activeUrl() {
  // panel.html?url=… pins a repo (used when the panel is opened as a normal tab, and by the tests)
  const pinned = new URLSearchParams(location.search).get("url");
  if (pinned) return pinned;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url ?? "";
}

const ICON = {
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  ext: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
  people: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4a3 3 0 0 1 0 6M21 20c0-2.6-1.6-4.8-4-5.6"/></svg>',
  term: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6l6 6-6 6M12 18h8"/></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/></svg>'
};
const TIPS = [
  "Looking for regexes that guess what text means…",
  "Checking keyword lists and includes() chains…",
  "Spotting LLM calls that only pick a label…",
  "Weighing judgment calls against exact logic…",
  "Money, auth and parsing stay exact: skipping those…",
  "Big repos take 30–90 seconds. Still working…"
];
const STEPS = [["tree", "Reading the repo's file list"], ["fetch", "Picking the likely logic files"], ["ai", "AI is reading the code"], ["typesafe", "TypeSafe (Jev) is scoring each spot"]];

async function refresh() {
  if (running) return;
  const url = await activeUrl();
  const r = parseRepoUrl(url);
  current = r ? { ...r, url } : null;
  const s = await settings();
  show("error", false);
  show("progress", false);
  show("welcome", !current);
  show("ctx", Boolean(current));
  if (!current) {
    show("setup", false);
    show("go", false);
    $("results").innerHTML = "";
    return;
  }
  const P = PROVIDERS[s.provider];
  $("repo-name").innerHTML = `<span class="owner">${esc(current.owner)} /</span> ${esc(current.repo)}${current.path ? ` <span class="owner">· ${esc(current.path)}</span>` : ""}`;
  $("ctx-chips").innerHTML = [
    `<span class="chip ${s.apiKey ? "on" : "off"}" title="AI provider (change in settings)"><i></i>${esc(P.label)}${s.model ? ` · ${esc(s.model)}` : ""}</span>`,
    `<span class="chip ${s.typesafeKey ? "on" : "off"}" title="${s.typesafeKey ? "Jev's own opinion is on" : "Add a TypeSafe key in settings for the third score"}"><i></i>TypeSafe ${s.typesafeKey ? "on" : "off"}</span>`,
    current.ref ? `<span class="chip"><i></i>${esc(current.ref)}</span>` : ""
  ].join("");
  show("setup", !s.apiKey);
  show("go", Boolean(s.apiKey));
  $("setup-title").textContent = `Connect ${P.label}`;
  $("setup-msg").textContent = `JevX reads the repo with your own ${P.label} key. Keys stay in this browser and are never sent to JevX.`;
  $("go-msg").textContent = `${P.label} reads up to 40 likely logic files (secrets removed). Read-only: nothing changes on GitHub.`;
  const cached = (await chrome.storage.local.get(cacheKey(current.full)))[cacheKey(current.full)];
  $("results").innerHTML = cached ? render(cached, true) : "";
  $("run").textContent = cached ? "Run again" : "Find where Jev fits";
}

const blobUrl = (res, s) => `https://github.com/${res.repo}/blob/${encodeURIComponent(res.branch)}/${s.file.split("/").map(encodeURIComponent).join("/")}#L${s.start_line}-L${s.end_line}`;

function ring(v) {
  const C = 2 * Math.PI * 12;
  const f = Math.max(0, Math.min(1, v ?? 0));
  return `<svg class="ring" viewBox="0 0 30 30" aria-hidden="true"><circle class="track" cx="15" cy="15" r="12"/><circle class="val" cx="15" cy="15" r="12" stroke-dasharray="${(f * C).toFixed(1)} ${C.toFixed(1)}"/></svg>`;
}

function scoreBox(label, v, missing) {
  if (typeof v === "number") return `<div class="sc"><div class="t"><span>${label}</span><b>${pct(v)}</b></div><div class="m"><i style="width:${Math.round(v * 100)}%"></i></div></div>`;
  return `<div class="sc na"><div class="t"><span>${label}</span><b>—</b></div><div class="x">${esc(missing)}</div></div>`;
}

function codeBlock(s, open) {
  if (!s.code) return "";
  const lines = s.code.split("\n");
  const body = lines.map((l, k) => `<div class="ln"><span>${s.start_line + k}</span><span>${esc(l) || " "}</span></div>`).join("");
  return `<details class="code"${open ? " open" : ""}><summary>Current code · lines ${s.start_line}–${s.end_line}${s.code_more ? " (first lines shown)" : ""}</summary><pre>${body}</pre></details>`;
}

function card(s, i, res) {
  const c = s.card;
  const link = blobUrl(res, s);
  const slash = s.file.lastIndexOf("/");
  const dir = slash >= 0 ? s.file.slice(0, slash + 1) : "";
  const base = s.file.slice(slash + 1);
  const where = `${s.file}:${s.start_line}-${s.end_line}`;
  const prompt = `Use JevX (the jevx MCP tools) on my local copy of ${res.repo}. Look at ${s.file} lines ${s.start_line}-${s.end_line}${s.function ? ` (${s.function})` : ""}: ${s.decides} Suggested Jev ${s.primitive}: "${s.question}"${s.outcomes?.length ? ` with options ${s.outcomes.join(", ")}` : ""}. Score it with jevx_scorecard, preview the change, keep the current rule as the fallback, and only apply it if the fit is at least 70%.`;
  const cmd = `npx @vij-sameerb5/jevx --dry-run --only ${s.file}`;
  const tsMissing = res.typesafe?.status === "error" ? "TypeSafe call failed" : "Add a TypeSafe key in settings";
  return `<article class="card ${c.verdict === "STRONG_FIT" ? "strong" : ""}">
    <div class="c-head">
      <span class="rank">#${i + 1}</span>
      <span class="verdict ${c.verdict}">${VERDICT[c.verdict]}</span>
      <div class="fit" title="Jev fit: the average of the scores below. 70%+ is strong.">${ring(c.average)}<div><div class="num">${pct(c.average)}</div><div class="lbl">Jev fit</div></div></div>
    </div>
    <div class="headline ${c.verdict}"><b>${HEADLINE[c.verdict][0]}</b><span>${HEADLINE[c.verdict][1]}</span></div>
    <h3 class="c-title">${esc(s.decides)}</h3>
    <div class="where">
      <div class="lab">${ICON.pin} Where to add Jev</div>
      <a class="path" href="${esc(link)}" target="_blank" rel="noopener" title="Open these lines on GitHub"><span class="dir">${esc(dir)}</span>${esc(base)}</a>
      <div class="meta"><span class="lines">Lines ${s.start_line}–${s.end_line}</span>${s.function ? `<span>in ${esc(s.function)}()</span>` : ""}</div>
      <div class="acts">
        <a class="btn primary sm" href="${esc(link)}" target="_blank" rel="noopener">Open on GitHub ${ICON.ext}</a>
        <button class="btn sm" type="button" data-copy="${esc(where)}">${ICON.copy} Copy location</button>
      </div>
    </div>
    ${codeBlock(s, i === 0)}
    <div class="jev">
      <span class="k">Jev would ask</span>
      <div class="ask"><span class="prim">${esc(s.primitive)}</span><q>${esc(s.question)}</q></div>
      ${s.outcomes?.length ? `<div class="opts">${s.outcomes.map((o) => `<span>${esc(o)}</span>`).join("")}</div>` : ""}
    </div>
    <div class="facts">
      <div class="fact"><span class="k">Why</span><span>${esc(s.why)}</span></div>
      ${s.fallback ? `<div class="fact"><span class="k">Keeps</span><span>${esc(s.fallback)} as the fallback</span></div>` : ""}
    </div>
    <div class="scores">
      ${scoreBox("AI", c.scores.ai, "")}
      ${scoreBox("Patterns", c.scores.patterns, "Not enough signal")}
      ${scoreBox("TypeSafe", c.scores.typesafe, tsMissing)}
    </div>
    ${s.community ? `<p class="seen">${ICON.people}<span>${s.community.count} of ${s.community.total} Jev decisions in real open-source projects replace a ${esc(s.community.rule.replace(/_/g, " "))} (${esc(s.community.repos.slice(0, 3).join(", "))}).</span></p>` : ""}
    <div class="c-acts">
      <button class="btn sm" type="button" data-copy="${esc(prompt)}">${ICON.spark} Copy prompt for Claude</button>
      <button class="btn sm" type="button" data-copy="${esc(cmd)}">${ICON.term} Copy JevX command</button>
    </div>
  </article>`;
}

function render(res, cached = false) {
  const links = `<nav><a href="https://jevx.live" target="_blank" rel="noopener">jevx.live</a><a href="https://jevx.live/docs.html" target="_blank" rel="noopener">Docs</a><a href="https://github.com/vij-sameerb5/JevX" target="_blank" rel="noopener">JevX on GitHub</a><a href="https://github.com/vij-sameerb5/JevX/issues" target="_blank" rel="noopener">Report an issue</a></nav>`;
  if (res.note) return `<div class="empty"><b>Nothing to read here</b><span>${esc(res.note)}</span></div><footer class="foot">${links}</footer>`;
  const strong = res.spots.filter((s) => s.card.verdict === "STRONG_FIT").length;
  const possible = res.spots.filter((s) => s.card.verdict === "POSSIBLE_FIT").length;
  const stats = `<div class="stats">
    <div class="stat g"><b>${strong}</b><span>strong fits (70%+)</span></div>
    <div class="stat a"><b>${possible}</b><span>possible (50–69%)</span></div>
    <div class="stat"><b>${res.stats.sent}</b><span>of ${res.stats.files.toLocaleString()} files read</span></div>
  </div>${res.existingJev?.length ? `${res.stats.failedParts ? `<p class="note warn">${res.stats.failedParts} of ${res.parts.length} parts couldn't be read (the AI was busy or failed), so some files weren't checked. Run again to retry them.</p>` : ""}<p class="note">This repo already uses Jev in ${res.existingJev.length} file(s); those weren't repeated.</p>` : ""}`;
  const main = res.spots.filter((s) => (s.card.average ?? 0) >= 0.5 && s.card.verdict !== "WEAK_FIT");
  const rest = res.spots.filter((s) => !main.includes(s));
  const cards = main.map((s, i) => card(s, i, res)).join("");
  const more = rest.length ? `<details class="more"><summary>Show ${rest.length} weaker spot(s) (under 50% or the scores disagree)</summary><div>${rest.map((s, i) => card(s, main.length + i, res)).join("")}</div></details>` : "";
  const anyGood = res.spots.some((s) => s.card.verdict === "STRONG_FIT" || s.card.verdict === "POSSIBLE_FIT");
  const none = !anyGood
    ? `<div class="verdict-banner no"><b>This repo doesn't need Jev right now</b><span>${res.spots.length ? "Nothing reached 50% with all scores agreeing. The spots below are borderline; the current code is fine." : "No judgment calls hiding as rules in the files read. Most code is exact logic, and that's a good answer."}</span></div>`
    : `<div class="verdict-banner yes"><b>${strong ? `Jev fits in ${strong} place${strong === 1 ? "" : "s"}` : `Jev could help in ${possible} place${possible === 1 ? "" : "s"}`}</b><span>${strong ? "Start with the strong fits below." : "No strong fits; the possible ones are optional."}</span></div>`;
  const when = new Date(res.at).toLocaleString();
  const ts = res.typesafe?.status === "on" ? "TypeSafe on" : res.typesafe?.status === "error" ? `TypeSafe failed: ${esc(res.typesafe.error)}` : "TypeSafe off";
  const foot = `<footer class="foot"><div class="meta">${esc(res.model)} · ${ts}${res.tokens ? ` · ${res.tokens.input.toLocaleString()} in / ${res.tokens.output.toLocaleString()} out tokens` : ""} · ${cached ? "saved " : ""}${esc(when)}</div><div>Read-only: nothing was changed on GitHub. Apply a change locally with Claude (JevX MCP) or the JevX command; your tests run before and after.</div>${links}</footer>`;
  return none + stats + cards + more + foot;
}

$("run").addEventListener("click", async () => {
  if (!current || running) return;
  const s = await settings();
  running = true;
  $("run").disabled = true;
  $("run").textContent = "Reading…";
  show("error", false);
  $("results").innerHTML = "";
  const prog = $("progress");
  const steps = STEPS.filter(([k]) => k !== "typesafe" || s.typesafeKey);
  const label = (k, l) => (k === "ai" ? `${PROVIDERS[s.provider].label} is reading the code` : l);
  const started = Date.now();
  let at = "tree";
  let parts = [];
  let tip = 0;
  const secs = (ms) => `${Math.max(0, Math.round(ms / 1000))}s`;
  const short = (files) => {
    const names = files.map((f) => f.split("/").pop());
    return names.slice(0, 2).join(", ") + (names.length > 2 ? ` +${names.length - 2}` : "");
  };
  const partRow = (p) => {
    const st = p.status;
    const right =
      st === "done" ? `<span class="ok">${p.spots} spot${p.spots === 1 ? "" : "s"} · ${(p.ms / 1000).toFixed(1)}s</span>`
      : st === "reading" ? `<span class="live">${secs(Date.now() - p.started)}</span>`
      : st === "retrying" ? `<span class="warn">busy · retrying</span>`
      : st === "error" ? `<span class="bad" title="${esc(p.error)}">skipped</span>`
      : `<span class="q">queued</span>`;
    return `<div class="part ${st}"><span class="dot"></span><span class="pf"><b>Part ${p.n}</b> · ${esc(short(p.files))}</span>${right}</div>`;
  };
  const draw = () => {
    const idx = steps.findIndex(([k]) => k === at);
    const rows = steps.map(([k, l], j) => {
      const cls = at === "done" || j < idx ? "done" : j === idx ? "now" : "";
      const sub = k === "ai" && parts.length && (cls === "now" || cls === "done") ? `<div class="parts">${parts.map(partRow).join("")}</div>` : "";
      return `<div class="step ${cls}"><span class="dot"></span><span>${esc(label(k, l))}${k === "ai" && parts.length ? ` <em>${parts.length} parts · ${Math.min(2, parts.length)} at a time</em>` : ""}</span></div>${sub}`;
    }).join("");
    prog.innerHTML = `<div class="ph"><span>Working on it</span><span class="clock">${secs(Date.now() - started)}</span></div>${rows}<p class="tip">${esc(TIPS[tip % TIPS.length])}</p>`;
  };
  const tick = setInterval(() => { tip = Math.floor((Date.now() - started) / 4000); draw(); }, 1000);
  show("progress", true);
  $("results").innerHTML = `<div class="skel"><i></i><i></i><i></i></div>`;
  draw();
  try {
    const res = await analyzeRepo({ fetch: (...a) => fetch(...a), url: current.url, provider: s.provider, apiKey: s.apiKey, githubToken: s.githubToken || undefined, typesafeKey: s.typesafeKey || undefined, model: s.model, progress: (step, _d, extra) => { at = step; if (extra?.parts) parts = extra.parts; draw(); } });
    await chrome.storage.local.set({ [cacheKey(res.repo)]: res });
    $("results").innerHTML = render(res);
    show("progress", false);
  } catch (e) {
    $("results").innerHTML = "";
    $("error").innerHTML = `<b>Couldn't finish</b>${esc(e instanceof Error ? e.message : String(e))}`;
    show("error", true);
    show("progress", false);
  } finally {
    clearInterval(tick);
    running = false;
    $("run").disabled = false;
    $("run").textContent = "Run again";
  }
});

document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-copy]");
  if (!b) return;
  await navigator.clipboard.writeText(b.getAttribute("data-copy"));
  const old = b.innerHTML;
  b.textContent = "Copied ✓";
  setTimeout(() => (b.innerHTML = old), 1300);
});
const openOpts = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };
$("opts").addEventListener("click", openOpts);
$("open-opts").addEventListener("click", openOpts);

chrome.tabs.onActivated.addListener(refresh);
chrome.tabs.onUpdated.addListener((_id, info) => info.url && refresh());
chrome.storage.onChanged.addListener((ch) => (ch.typesafeKey || ch.provider || ch.geminiKey || ch.xaiKey || ch.openrouterKey || ch.githubToken || ch.models) && refresh());
refresh();
