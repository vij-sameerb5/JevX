// Study open-source projects that already use Jev: find every Jev call site and save the
// code around it, so we can learn WHERE and WHY people use Jev. Output is local only
// (dataset/jev-community/, git-ignored). Never uploads anything.
//
//   GITHUB_TOKEN=… node scripts/study-jev-repos.mjs [owner/repo …]   (defaults to the list below)
//
// The token is read from the environment only and never printed or saved.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const DEFAULT = [
  "browser-use/jev-ultrafast", "thruwire/foreman", "tamaratran/fast-jev-compaction", "jarrodwatts/jev-trader",
  "kerpopule/hermes-jev-skills", "gargpratyush/jev-router", "0xNatoshi/jev-codex-router", "vinilana/jev-gateway",
  "kunchenguid/compact-adviser", "superagents-lab/jev-search", "awlevin/typesafe-computer-use", "droidrun/mobile-jev",
  "moritzkremb/jev-voice-browser", "realZachi/typesafe-adblock", "jonymusky/jev-browser-qa", "jiawei686/jev-ultrafast-mcp",
  "nourhelmi/pi-jev-compaction", "devagrawal09/jev-review", "realZachi/pg-jev", "DecapodLabs/decapod",
  "morganlinton/Albatross", "coldteadotai/abide", "glowbom/glowbom-oss", "BillionsBobby/JevRouter",
  "suenot/codex-jev-router", "shimo4228/jev-skill-router"
];
const repos = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
const token = process.env.GITHUB_TOKEN?.trim();
if (!token) { console.error("Set GITHUB_TOKEN (read-only is enough)."); process.exit(1); }
// curl (not fetch) so the shell's proxy and CAs work. The token is passed on stdin as a curl
// config (never in argv, so it can't show up in process lists or error messages).
const gh = (url, out) => {
  const cfg = `header = "Authorization: Bearer ${token}"\nheader = "User-Agent: jevx-study"\nheader = "Accept: application/vnd.github+json"\n`;
  try {
    return execFileSync("curl", ["-sSL", "--fail", "--max-time", "150", "--config", "-", ...(out ? ["-o", out] : []), url], { input: cfg, maxBuffer: 64 << 20, stdio: ["pipe", "pipe", "ignore"] }).toString();
  } catch (e) { throw new Error(`download failed (curl exit ${e.status})`, { cause: e }); } // the token is on stdin, so the cause never contains it
};

const OUT = path.resolve("dataset/jev-community");
mkdirSync(OUT, { recursive: true });
const SRC = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|rb)$/;
const SKIP = /(^|\/)(node_modules|dist|build|vendor|\.next|coverage|__pycache__|\.venv|venv)\//;
const PRIM = (s) => (/\bnoul\b/i.test(s) ? "noul" : /\bchoice\b/i.test(s) ? "choice" : /\bscore\b/i.test(s) ? "score" : "call");
const CTX = 30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// lines that look like a Jev call or the shape of a Jev request
const CALL = /systemOne|system_one|api\.typesafe|typesafe\.ai\/|TypeSafeClient|@typesafe-ai\/sdk|\bnoul\s*\(|\bchoice\s*\(|\bscore\s*\(|questions\s*[:=]|\bjev\w*\s*\.\s*\w+\s*\(/i;

for (const full of repos) {
  if (existsSync(path.join(OUT, `${full.replace("/", "__")}.json`)) && !process.env.FORCE) { console.log(`= ${full}: already studied`); continue; }
  try {
    const meta = JSON.parse(gh(`https://api.github.com/repos/${full}`));
    if (!meta.full_name) { console.log(`✗ ${full}: not found`); continue; }
    // code search finds the files that mention TypeSafe / Jev; we fetch only those (no full clone)
    const found = new Set();
    for (const term of ["typesafe", "systemOne"]) {
      const r = JSON.parse(gh(`https://api.github.com/search/code?q=${term}+repo:${full}&per_page=30`));
      for (const it of r.items ?? []) if (SRC.test(it.path) && !SKIP.test(it.path) && !/\.(test|spec)\./.test(it.path)) found.add(it.path);
      await sleep(6500); // code search allows ~10 requests a minute
    }
    const sites = [];
    for (const rel of [...found].slice(0, 14)) {
      let text;
      try { text = execFileSync("curl", ["-sSL", "--fail", "--max-time", "60", "--config", "-", "-H", "Accept: application/vnd.github.raw", `https://api.github.com/repos/${full}/contents/${encodeURI(rel)}`], { input: `header = "Authorization: Bearer ${token}"\nheader = "User-Agent: jevx-study"\n`, maxBuffer: 16 << 20, stdio: ["pipe", "pipe", "ignore"] }).toString(); } catch { continue; }
      const lines = text.split("\n");
      let hit = false;
      lines.forEach((l, i) => {
        if (!CALL.test(l)) return;
        hit = true;
        if (sites.some((s) => s.file === rel && Math.abs(s.line - (i + 1)) < CTX)) return;
        sites.push({ repo: full, file: rel, line: i + 1, primitive: PRIM(l), snippet: lines.slice(Math.max(0, i - CTX), i + CTX).join("\n") });
      });
      if (!hit) sites.push({ repo: full, file: rel, line: 1, primitive: "file", snippet: lines.slice(0, 2 * CTX).join("\n") });
    }
    let readme = "";
    try { readme = execFileSync("curl", ["-sSL", "--fail", "--max-time", "30", "--config", "-", "-H", "Accept: application/vnd.github.raw", `https://api.github.com/repos/${full}/readme`], { input: `header = "Authorization: Bearer ${token}"\n`, stdio: ["pipe", "pipe", "ignore"] }).toString().slice(0, 4000); } catch { /* none */ }
    const rec = { repo: full, url: meta.html_url, stars: meta.stargazers_count, language: meta.language, description: meta.description, files: found.size, sites, readme };
    writeFileSync(path.join(OUT, `${full.replace("/", "__")}.json`), JSON.stringify(rec, null, 1));
    console.log(`✓ ${full}: ${found.size} file(s), ${sites.length} site(s)`);
  } catch (e) { console.log(`✗ ${full}: ${e.message}`); }
}
const idx = readdirSync(OUT).filter((f) => f.endsWith(".json") && !f.startsWith("_")).map((f) => { const r = JSON.parse(readFileSync(path.join(OUT, f), "utf8")); return { repo: r.repo, stars: r.stars, language: r.language, files: r.files, sites: r.sites.length }; });
writeFileSync(path.join(OUT, "_index.json"), JSON.stringify(idx, null, 1));
console.log(`\n${idx.length} repos · ${idx.reduce((a, r) => a + r.sites, 0)} sites → dataset/jev-community/`);
