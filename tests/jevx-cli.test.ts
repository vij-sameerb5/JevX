// `jevx` end to end: the one-command autonomous run on a copy of examples/jev-demo, with a mock
// xAI (answers from tests/mock-engine.ts) and a mock TypeSafe API. No human input anywhere.
//   routeTicket → strong → changed (its caller in inbox.ts updated too)
//   priorityOf  → strong → written, breaks the project's test → reverted automatically
//   addonPrice, intake → not opportunities → untouched
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execa } from "execa";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { startMockXai } from "./mock-xai.js";
import { startMockServer } from "./mock-typesafe.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, "../apps/jevx/src/index.ts");
const DEMO = path.resolve(here, "../examples/jev-demo");

let xai: Awaited<ReturnType<typeof startMockXai>>;
let ts: Awaited<ReturnType<typeof startMockServer>>;
const dirs: string[] = [];

function demo(): string {
  const d = mkdtempSync(path.join(tmpdir(), "jevx-cli-"));
  dirs.push(d);
  cpSync(DEMO, d, { recursive: true });
  // the project's own test: fails if a change leaves a BROKEN marker in the code
  writeFileSync(path.join(d, "check.mjs"), 'import { readFileSync } from "node:fs";\nfor (const f of ["src/routing.ts","src/priority.ts","src/inbox.ts"]) if (readFileSync(f,"utf8").includes("BROKEN")) { console.error("broken: " + f); process.exit(1); }\nconsole.log("ok");\n');
  const pkg = JSON.parse(readFileSync(path.join(d, "package.json"), "utf8"));
  pkg.scripts = { test: "node check.mjs" };
  writeFileSync(path.join(d, "package.json"), JSON.stringify(pkg, null, 2));
  return d;
}

const jevx = (args: string[], env: Record<string, string> = {}) =>
  execa("npx", ["tsx", CLI, ...args], {
    reject: false,
    env: {
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      JEVX_HOME: dirs[0] ?? tmpdir(),
      XAI_API_KEY: "xai-test-key",
      XAI_BASE_URL: xai.url,
      JEVX_ALLOW_CUSTOM_BASE_URL: "1",
      OPENROUTER_API_KEY: "",
      TYPESAFE_API_KEY: "test-key",
      TYPESAFE_BASE_URL: ts.url,
      JEVX_ENV_FILE: "",
      JEVX_SHARE: "0",
      ...env
    }
  });

beforeAll(async () => {
  xai = await startMockXai();
  ts = await startMockServer();
  dirs.push(mkdtempSync(path.join(tmpdir(), "jevx-home-")));
});
afterAll(async () => {
  await xai.close();
  await ts.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("jevx (one command, no human in the loop)", () => {
  it("finds, judges, changes the strong fit, reverts the one that breaks tests, and undo restores everything", async () => {
    const d = demo();
    const before = { routing: readFileSync(path.join(d, "src/routing.ts"), "utf8"), inbox: readFileSync(path.join(d, "src/inbox.ts"), "utf8"), priority: readFileSync(path.join(d, "src/priority.ts"), "utf8"), billing: readFileSync(path.join(d, "src/billing.ts"), "utf8") };
    const r = await jevx([d, "--yes", "--no-install"]);
    expect(r.exitCode).toBe(0);
    const out = r.stdout;
    expect(out).toMatch(/Indexed 6 files · 3 possible spot\(s\)/);
    expect(out).toMatch(/xAI is reading \d+ file\(s\) in 1 part\(s\)/);
    expect(out).toMatch(/xAI found 3 spot\(s\) worth checking/);
    expect(out).toMatch(/Checks before: tests pass/);
    expect(out).toMatch(/Reverted priorityOf\(\): tests failed/);
    expect(out).toMatch(/#1 {2}routeTicket\(\) {2}src\/routing\.ts:8/);
    expect(out).toMatch(/JEV FIT +\d+% {2}STRONG {2}→ changed/);
    expect(out).toMatch(/→ not changed: tests failed after this change/);
    expect(out).toMatch(/\+export async function routeTicket/); // red/green in the terminal
    expect(out).toMatch(/-export function routeTicket/);
    expect(out).toMatch(/1 changed/);
    expect(out).toMatch(/Checks after: tests pass/);
    expect(out).toMatch(/Added @typesafe-ai\/sdk to package\.json/);
    expect(out).toMatch(/Source Control/);
    expect(out).toMatch(/npx jevx undo/);
    expect(out).toMatch(/AI call\(s\)/);

    // the code on disk
    const routing = readFileSync(path.join(d, "src/routing.ts"), "utf8");
    expect(routing).toMatch(/export async function routeTicket\(t: Ticket\): Promise<Team>/);
    expect(routing).toMatch(/return legacyRouteTicket\(t\);/);
    expect(readFileSync(path.join(d, "src/inbox.ts"), "utf8")).toMatch(/const team = await routeTicket\(t\);/); // caller updated
    expect(readFileSync(path.join(d, "src/priority.ts"), "utf8")).toBe(before.priority); // reverted
    expect(readFileSync(path.join(d, "src/billing.ts"), "utf8")).toBe(before.billing); // never touched
    expect(readFileSync(path.join(d, "src/inbox.ts"), "utf8")).not.toMatch(/POSSIBLE_EDIT/); // possible: not written by default
    expect(out).toMatch(/→ left as is · --include-possible writes it/);
    expect(JSON.parse(readFileSync(path.join(d, "package.json"), "utf8")).dependencies["@typesafe-ai/sdk"]).toBe("^0.6.0");
    expect(existsSync(path.join(d, ".jevx/report.html"))).toBe(true);
    expect(readFileSync(path.join(d, ".jevx/.gitignore"), "utf8")).toMatch(/^\*$/m); // .jevx never committed
    expect(JSON.parse(readFileSync(path.join(d, ".jevx/debug/read-part-1.json"), "utf8")).kept.length).toBe(4);

    // undo
    const u = await jevx(["undo", d]);
    expect(u.stdout).toMatch(/Restored \d+ file\(s\)/);
    expect(readFileSync(path.join(d, "src/routing.ts"), "utf8")).toBe(before.routing);
    expect(readFileSync(path.join(d, "src/inbox.ts"), "utf8")).toBe(before.inbox);
    expect(JSON.parse(readFileSync(path.join(d, "package.json"), "utf8")).dependencies).toBeUndefined();
    expect((await jevx(["undo", d])).stdout).toMatch(/Nothing to undo/);
  }, 120_000);

  it("--dry-run shows the red/green change and writes nothing", async () => {
    const d = demo();
    const before = readFileSync(path.join(d, "src/routing.ts"), "utf8");
    const r = await jevx([d, "--yes", "--dry-run"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/preview only/);
    expect(r.stdout).toMatch(/→ preview below/);
    expect(r.stdout).toMatch(/\+export async function routeTicket/);
    expect(r.stdout).toMatch(/2 strong fit\(s\) · 1 possible · nothing written \(preview mode\)/);
    expect(r.stdout).toMatch(/POSSIBLE +→ preview · needs --include-possible/);
    expect(r.stdout).toMatch(/\+ +\/\/ POSSIBLE_EDIT/); // the possible change is previewed too
    expect(readFileSync(path.join(d, "src/routing.ts"), "utf8")).toBe(before);
  }, 120_000);

  it("--include-possible also writes POSSIBLE fits (still tested, still undoable)", async () => {
    const d = demo();
    const r = await jevx([d, "--yes", "--no-install", "--include-possible"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/2 changed/);
    const inbox = readFileSync(path.join(d, "src/inbox.ts"), "utf8");
    expect(inbox).toMatch(/\/\/ POSSIBLE_EDIT/);
    expect(inbox).toMatch(/const team = await routeTicket\(t\);/); // both changes to inbox.ts kept
    await jevx(["undo", d]);
    expect(readFileSync(path.join(d, "src/inbox.ts"), "utf8")).not.toMatch(/POSSIBLE_EDIT/);
  }, 120_000);

  it("without an AI key it explains the options and changes nothing", async () => {
    const d = demo();
    const r = await jevx([d, "--yes"], { XAI_API_KEY: "", OPENROUTER_API_KEY: "" });
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toMatch(/No AI key found\. JevX uses your own AI key — it never ships one/);
    expect(r.stdout).toMatch(/jevx mcp install/);
  });

  it("never sends code to a custom address unless explicitly allowed", async () => {
    const d = demo();
    const r = await jevx([d, "--yes"], { JEVX_ALLOW_CUSTOM_BASE_URL: "" });
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toMatch(/XAI_BASE_URL is set to a custom address/);
  });

  it("asks before the first send when not told --yes, and refuses silently-piped runs", async () => {
    const d = demo();
    const r = await jevx([d], { JEVX_HOME: mkdtempSync(path.join(tmpdir(), "jevx-fresh-")) });
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toMatch(/your source files to read \(not \.env files/);
    expect(r.stdout).toMatch(/re-run with --yes/);
  });

  it("if the AI can't read the code, it falls back to the ranked static candidates", async () => {
    const d = demo();
    writeFileSync(path.join(d, "src/billing.ts"), readFileSync(path.join(d, "src/billing.ts"), "utf8") + "\n// MOCK_READ_FAILS\n");
    const r = await jevx([d, "--yes", "--dry-run"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/could not read the code/);
    expect(r.stdout).toMatch(/Checking \d+ static candidate\(s\) instead/);
    expect(r.stdout).toMatch(/\+export async function routeTicket/);
  }, 120_000);

  it("--share sends anonymous rows (no code, no paths) and undo reports it", async () => {
    const got: { url: string; body: unknown; auth: string }[] = [];
    const sb = createServer((req, res) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        got.push({ url: req.url ?? "", body: JSON.parse(b || "null"), auth: String(req.headers.apikey ?? "") });
        res.writeHead(201).end();
      });
    });
    await new Promise<void>((ok) => sb.listen(0, "127.0.0.1", ok));
    const url = `http://127.0.0.1:${(sb.address() as AddressInfo).port}`;
    try {
      const d = demo();
      const env = { JEVX_SUPABASE_URL: url, JEVX_SUPABASE_ANON_KEY: "anon-test" };
      const r = await jevx([d, "--yes", "--no-install", "--share"], env);
      expect(r.stdout).toMatch(/Shared \d+ anonymous finding\(s\)/);
      const f = got.find((g) => g.url === "/rest/v1/jevx_findings")!;
      expect(f.auth).toBe("anon-test");
      const rows = f.body as { result: string; primitive: string }[];
      expect(rows.some((x) => x.result === "changed")).toBe(true);
      expect(rows.some((x) => x.result === "reverted")).toBe(true);
      const json = JSON.stringify(rows);
      for (const leak of ["routing", "routeTicket", "src/", "keyword"]) expect(json).not.toContain(leak);
      await jevx(["undo", d], { ...env, JEVX_SHARE: "1" });
      expect(got.some((g) => g.url === "/rest/v1/jevx_outcomes" && (g.body as { outcome: string }[])[0]!.outcome === "undone")).toBe(true);
    } finally {
      sb.close();
    }
  }, 120_000);

  it("the MCP server is served by the same package: `jevx mcp`", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const c = new Client({ name: "t", version: "0" });
    await c.connect(new StdioClientTransport({ command: "npx", args: ["tsx", CLI, "mcp"], env: { ...(process.env as Record<string, string>), JEVX_ROOT: demo() }, stderr: "ignore" }));
    expect((await c.listTools()).tools.map((t) => t.name)).toContain("jevx_scorecard");
    await c.close();
  }, 60_000);
});
