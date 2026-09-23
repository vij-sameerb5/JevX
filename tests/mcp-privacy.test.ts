// The MCP server's privacy and read-only promises, checked from the outside:
//   - guide / scan / read / search / related write NOTHING into the repository
//   - scorecard / report write only inside .jevx/ (JevX's own git-ignored folder)
//   - even with sharing switched on, nothing reaches Supabase except an explicit jevx_share call
//   - jevx_read takes several ids at once (fewer calls → fewer approval prompts)
//   - without a TypeSafe key the scan says so, instead of scores silently using 2 sources
import { cpSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let repo: string;
let client: Client;
let sb: Server;
const hits: { url: string; body: string }[] = [];

const files = (dir: string, base = dir): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p, base) : [path.relative(base, p)];
  });
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { text: r.content.map((c) => c.text).join("\n"), isError: Boolean(r.isError) };
};

beforeAll(async () => {
  repo = mkdtempSync(path.join(tmpdir(), "jevx-priv-"));
  cpSync(path.resolve(here, "../examples/jev-demo"), repo, { recursive: true });
  sb = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      hits.push({ url: req.url ?? "", body: b });
      res.writeHead(201).end();
    });
  });
  await new Promise<void>((ok) => sb.listen(0, "127.0.0.1", ok));
  const env = { ...(process.env as Record<string, string>), JEVX_ROOT: repo, JEVX_SHARE: "1", JEVX_SUPABASE_URL: `http://127.0.0.1:${(sb.address() as AddressInfo).port}`, JEVX_SUPABASE_ANON_KEY: "anon", JEVX_ALLOW_CUSTOM_BASE_URL: "1", TYPESAFE_API_KEY: "", JEVX_ENV_FILE: "" };
  client = new Client({ name: "privacy-test", version: "1" });
  await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", path.resolve(here, "../apps/jevx/src/mcp.ts")], env, stderr: "ignore" }));
}, 60_000);
afterAll(async () => {
  await client.close();
  sb.close();
  rmSync(repo, { recursive: true, force: true });
});

describe("MCP server: read-only means read-only; nothing leaves without jevx_share", () => {
  it("guide, scan, read (batch), search and related write no file and send nothing", async () => {
    const before = files(repo).sort();
    expect((await call("jevx_guide")).isError).toBe(false);
    const scan = await call("jevx_scan");
    expect(scan.text).toMatch(/TypeSafe: NOT configured — scorecards use 2 of 3 sources/);
    const batch = await call("jevx_read", { ids: ["file:src/routing.ts", "file:src/priority.ts", "file:nope.ts"] });
    expect(batch.text).toMatch(/=== \[file:src\/routing\.ts\][\s\S]*=== \[file:src\/priority\.ts\][\s\S]*=== \[file:nope\.ts\] not found/);
    await call("jevx_search", { query: "routeTicket" });
    await call("jevx_related", { file: "src/routing.ts", line: 8 });
    expect(files(repo).sort()).toEqual(before);
    expect(hits).toEqual([]);
  });

  it("scorecard and report write only inside .jevx/, and still send nothing", async () => {
    const before = files(repo).filter((f) => !f.startsWith(".jevx")).sort();
    const sc = await call("jevx_scorecard", {
      file: "src/routing.ts", start_line: 8, end_line: 14, decision: "Which team.", primitive: "choice", question: "Which team?", outcomes: ["billing", "technical"], state: ["body"],
      deterministic_remainder: "", why: "keywords", features: { judgment_required: "high" }, ai_score: 0.8, ai_reasons: "x",
      pattern: { label: "keyword-intent-router", input_kind: "user_text", rule_kind: "keyword_list", rule_shape: "keyword lists on ticket text", why_generic: "paraphrases" }
    });
    expect(sc.text).toMatch(/TypeSafe: unavailable .* 2 of 3 sources/);
    await call("jevx_report");
    expect(files(repo).filter((f) => !f.startsWith(".jevx")).sort()).toEqual(before);
    expect(files(repo).some((f) => f.startsWith(".jevx/proposals/"))).toBe(true);
    expect(hits).toEqual([]);
  });

  it("only jevx_share sends — one anonymous row per proposal, no code or paths", async () => {
    const r = await call("jevx_share", { changed: [] });
    expect(r.text).toMatch(/Shared 1 anonymous finding/);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.url).toBe("/rest/v1/jevx_findings");
    for (const leak of ["routing", "routeTicket", "src/", "BILLING_WORDS"]) expect(hits[0]!.body).not.toContain(leak);
  });
});
