// Build jevx.mcpb — the one-click Claude Desktop extension (MCP Bundle).
//   pnpm build && node scripts/build-mcpb.mjs      → apps/jevx/jevx-<version>.mcpb
// The bundle holds the built MCP server + its production dependencies + a manifest. Claude Desktop
// shows two settings when it's installed: the project folder, and an optional TypeSafe key (stored
// by Claude Desktop as a secret, passed to the server as TYPESAFE_API_KEY — never written by us).
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(ROOT, "apps/jevx");
const pkg = JSON.parse(readFileSync(path.join(APP, "package.json"), "utf8"));
const OUT = path.join(ROOT, "build/mcpb");
if (!existsSync(path.join(APP, "dist/mcp.js"))) throw new Error("apps/jevx/dist is missing — run `pnpm build` first");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(path.join(OUT, "server"), { recursive: true });
for (const f of readdirSync(path.join(APP, "dist"))) copyFileSync(path.join(APP, "dist", f), path.join(OUT, "server", f));
copyFileSync(path.join(APP, "assets/icon.png"), path.join(OUT, "icon.png"));
copyFileSync(path.join(APP, "LICENSE"), path.join(OUT, "LICENSE"));
cpSync(path.join(APP, "README.md"), path.join(OUT, "README.md"));
writeFileSync(path.join(OUT, "server/package.json"), JSON.stringify({ name: "jevx-mcpb-server", version: pkg.version, private: true, type: "module", dependencies: pkg.dependencies }, null, 2));
console.log("▸ installing production dependencies into the bundle…");
execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--silent"], { cwd: path.join(OUT, "server"), stdio: "inherit", shell: process.platform === "win32" });

const tool = (name, description) => ({ name, description });
const manifest = {
  manifest_version: "0.3",
  name: "jevx",
  display_name: "JevX",
  version: pkg.version,
  description: "Find where Jev fits in your codebase: hardcoded rules that are really judgment calls.",
  long_description:
    "JevX gives Claude the tools to find places in a TypeScript / JavaScript project where a regex, keyword list or fixed ranking is really a judgment call, score each one three ways (Claude, TypeSafe/Jev, learned patterns), preview the change as a red/green diff, and apply it safely — backup, your tests before and after, automatic revert, undo. Say: \"use jevx to find where Jev fits in ~/code/my-app\".",
  author: { name: "Sameer Shaik", url: "https://github.com/vij-sameerb5" },
  repository: { type: "git", url: "https://github.com/vij-sameerb5/JevX" },
  homepage: "https://github.com/vij-sameerb5/JevX",
  documentation: "https://github.com/vij-sameerb5/JevX#readme",
  support: "https://github.com/vij-sameerb5/JevX/issues",
  icon: "icon.png",
  server: {
    type: "node",
    entry_point: "server/mcp.js",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/server/mcp.js"],
      env: { JEVX_ROOT: "${user_config.project_folder}", TYPESAFE_API_KEY: "${user_config.typesafe_api_key}" }
    }
  },
  tools: [
    tool("jevx_guide", "Read-only · what a Jev opportunity is (and isn't), and how to write the change"),
    tool("jevx_scan", "Read-only · index a project: candidates, existing Jev use, and the reading order"),
    tool("jevx_read", "Read-only · read files, outline, folder, function or the repo overview (secrets scrubbed)"),
    tool("jevx_related", "Read-only · callers, callees, types and constants of a function"),
    tool("jevx_search", "Read-only · find a function, type or file by name"),
    tool("jevx_scorecard", "Writes only .jevx/ · score a proposed Jev decision: patterns + AI + TypeSafe"),
    tool("jevx_preview_change", "Writes only .jevx/ · red/green diff of a change — edits nothing"),
    tool("jevx_apply", "Changes files · apply a previewed change: backup, tests before/after, auto-revert"),
    tool("jevx_undo", "Changes files · restore every file the last change touched"),
    tool("jevx_report", "Writes only .jevx/ · write .jevx/report.html with every scorecard and diff"),
    tool("jevx_share", "Sends anonymous data (opt-in) · share anonymous outcomes (no code) to improve JevX")
  ],
  keywords: ["jev", "typesafe", "refactor", "code-analysis", "typescript"],
  license: "MIT",
  compatibility: { platforms: ["darwin", "win32", "linux"], runtimes: { node: ">=20.10.0" } },
  user_config: {
    project_folder: { type: "directory", title: "Project folder", description: "The codebase JevX looks at by default. You can also name another folder in chat.", required: false },
    typesafe_api_key: { type: "string", title: "TypeSafe API key (optional)", description: "Adds Jev's own opinion to every scorecard. Stored by Claude Desktop, never by JevX.", sensitive: true, required: false }
  }
};
writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// ── what goes in must be only what a user needs: check before packing ──
function walk(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))]));
}
const all = walk(OUT);
const FORBIDDEN = [/(^|\/)\.env(\.|$)/, /^(BLUEPRINT|CLAUDE|AGENTS|COMMUNITY-NOTES|REBOOT-AUDIT|JOURNAL|PLAN)\.md$/, /(^|\/)dataset\//, /Claude outputs/, /(^|\/)_to_delete\//, /(^|\/)\.jevx\//];
const bad = all.filter((f) => FORBIDDEN.some((r) => r.test(f)));
if (bad.length) throw new Error(`refusing to pack — files that must not ship:\n  ${bad.join("\n  ")}`);
for (const f of readdirSync(path.join(OUT, "server")).filter((x) => x.endsWith(".js"))) {
  const src = readFileSync(path.join(OUT, "server", f), "utf8");
  if (/\/(Users|home)\/[\w.-]+\//.test(src)) throw new Error(`refusing to pack — server/${f} contains an absolute path from this machine`);
  if (/xai-[A-Za-z0-9]{20,}|sk-(or-|proj-|ant-)?[A-Za-z0-9_-]{24,}|eyJhbGciOi[A-Za-z0-9_-]{20,}/.test(src)) throw new Error(`refusing to pack — server/${f} contains a key-like string`);
}
console.log(`▸ contents checked: ${all.length} files, no personal notes, .env, research data, keys or local paths`);

const mcpb = (...a) => execFileSync("npx", ["-y", "@anthropic-ai/mcpb@2.1.2", ...a], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
console.log("▸ validating manifest…");
mcpb("validate", path.join(OUT, "manifest.json"));
const file = path.join(APP, `jevx-${pkg.version}.mcpb`);
rmSync(file, { force: true });
console.log("▸ packing…");
mcpb("pack", OUT, file);
console.log(`\n✓ ${path.relative(ROOT, file)} — double-click it (or drag it into Claude Desktop → Settings → Extensions).`);
