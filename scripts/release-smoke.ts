// Smoke test of an INSTALLED jevx (from the packed tarball), the way a new user gets it.
//   npx tsx scripts/release-smoke.ts <path-to-installed-jevx-bin>
// Runs against the mock xAI + mock TypeSafe — never a real API, never a real key.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startMockXai } from "../tests/mock-xai.js";
import { startMockServer } from "../tests/mock-typesafe.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = process.argv[2];
if (!bin) {
  console.error("usage: release-smoke.ts <installed jevx bin>");
  process.exit(2);
}
const checks: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  checks.push([name, ok, detail]);
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${!ok && detail ? `\n      ${detail.slice(0, 400).replace(/\n/g, "\n      ")}` : ""}`);
};

const xai = await startMockXai();
const ts = await startMockServer();
const home = mkdtempSync(path.join(tmpdir(), "jevx-rel-home-"));
const repo = mkdtempSync(path.join(tmpdir(), "jevx-rel-repo-"));
cpSync(path.resolve(here, "../examples/jev-demo"), repo, { recursive: true });
const env = { NO_COLOR: "1", JEVX_HOME: home, JEVX_ENV_FILE: "", JEVX_SHARE: "0", XAI_API_KEY: "xai-test-key", XAI_BASE_URL: xai.url, JEVX_ALLOW_CUSTOM_BASE_URL: "1", OPENROUTER_API_KEY: "", TYPESAFE_API_KEY: "test-key", TYPESAFE_BASE_URL: ts.url };
try {
  const v = await execa(bin, ["--version"], { reject: false, env });
  const pkg = JSON.parse(readFileSync(path.resolve(here, "../apps/jevx/package.json"), "utf8")) as { version: string };
  check(`jevx --version = ${pkg.version}`, v.stdout.trim() === pkg.version, v.stdout + v.stderr);
  const h = await execa(bin, ["--help"], { reject: false, env });
  check("jevx --help lists the public flags", ["--dry-run", "--min-fit", "--share", "undo", "mcp"].every((x) => h.stdout.includes(x)), h.stdout);
  const first = await execa(bin, [repo, "--yes", "--dry-run"], { reject: false, env });
  check("first run shows the JEVX welcome", first.stdout.includes("Find where Jev fits in your codebase."), first.stdout);
  check("dry run finds and previews the strong fit", /STRONG +→ preview below/.test(first.stdout) && first.stdout.includes("+export async function routeTicket"), first.stdout + first.stderr);
  check("dry run writes nothing", !readFileSync(path.join(repo, "src/routing.ts"), "utf8").includes("TypeSafeClient"));
  const low = await execa(bin, [repo, "--yes", "--min-fit", "40"], { reject: false, env });
  check("--min-fit under 50 is refused", low.exitCode === 1 && low.stdout.includes("never writes a fit under 50%"), low.stdout);
  const nokey = await execa(bin, [repo, "--yes"], { reject: false, env: { ...env, XAI_API_KEY: "", OPENROUTER_API_KEY: "" } });
  check("no key → explains, changes nothing", nokey.exitCode === 1 && nokey.stdout.includes("never ships one"), nokey.stdout);

  const client = new Client({ name: "release-smoke", version: "1" });
  await client.connect(new StdioClientTransport({ command: bin, args: ["mcp"], env: { ...(process.env as Record<string, string>), ...env, JEVX_ROOT: repo }, stderr: "ignore" }));
  const tools = (await client.listTools()).tools.map((t) => t.name);
  check("jevx mcp: 11 tools over stdio", tools.length === 11 && tools.includes("jevx_scan") && tools.includes("jevx_share"), tools.join(", "));
  const scan = (await client.callTool({ name: "jevx_scan", arguments: {} })) as { content: { text: string }[] };
  check("jevx mcp: jevx_scan gives a reading order", /READING ORDER/.test(scan.content[0]!.text), scan.content[0]!.text);
  await client.close();
  writeFileSync(path.join(home, "done"), "");
} finally {
  await xai.close();
  await ts.close();
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
}
const failed = checks.filter((c) => !c[1]).length;
console.log(failed ? `\n${failed} check(s) failed.` : `\nAll ${checks.length} smoke checks passed.`);
process.exit(failed ? 1 : 0);
