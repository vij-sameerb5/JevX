// Drive the JevX MCP server over stdio against a REAL repository, calling the tools in the order
// the guide tells an editor's AI to — the automated half of the MCP release test.
//   npx tsx scripts/mcp-smoke.ts <repo> [--bin <installed jevx>] [--spot file:start-end]
// No AI is involved; TypeSafe is used only if TYPESAFE_API_KEY is set. Writes only to <repo>/.jevx/.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const repo = path.resolve(args.find((a) => !a.startsWith("--") && !/^\S+:\d+-\d+$/.test(a)) ?? ".");
const bin = args.includes("--bin") ? args[args.indexOf("--bin") + 1] : undefined;
const spotArg = args.includes("--spot") ? args[args.indexOf("--spot") + 1] : undefined;

let failed = 0;
const step = (name: string, ok: boolean, info = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${info ? ` — ${info}` : ""}`);
};
const t0 = Date.now();
const transport = bin
  ? new StdioClientTransport({ command: bin, args: ["mcp"], env: { ...(process.env as Record<string, string>), JEVX_ROOT: repo, JEVX_SHARE: "0" }, stderr: "ignore" })
  : new StdioClientTransport({ command: "npx", args: ["tsx", path.resolve(here, "../apps/jevx/src/mcp.ts")], env: { ...(process.env as Record<string, string>), JEVX_ROOT: repo, JEVX_SHARE: "0" }, stderr: "ignore" });
const client = new Client({ name: "jevx-mcp-smoke", version: "1" });
const call = async (name: string, a: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: a })) as { content: { text: string }[]; isError?: boolean };
  return { text: r.content.map((c) => c.text).join("\n"), isError: Boolean(r.isError) };
};

console.log(`JevX MCP smoke test · ${repo}\n`);
await client.connect(transport);
const info = client.getServerVersion();
step("server starts over stdio", Boolean(info), `${info?.name} ${info?.version}`);
const tools = (await client.listTools()).tools.map((t) => t.name);
step("editor sees the JevX tools", tools.includes("jevx_scan") && tools.includes("jevx_scorecard"), `${tools.length} tools`);
const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
step('"find-jev-opportunities" prompt available', prompts.includes("find-jev-opportunities"));

const guide = await call("jevx_guide");
step("jevx_guide", !guide.isError && /NEVER below 50%/.test(guide.text));

const scan = await call("jevx_scan");
const order = [...scan.text.matchAll(/^ {2}(\S+) \((\d+) lines\)$/gm)].map((m) => m[1]!);
step("jevx_scan indexes the repo", !scan.isError, scan.text.split("\n")[1]);
step("jevx_scan gives a reading order", order.length > 0, `${order.length} files, first: ${order.slice(0, 3).join(", ")}`);

let read = 0;
for (const f of order.slice(0, 5)) if (!(await call("jevx_read", { id: `file:${f}` })).isError) read++;
step("jevx_read reads the first files of the order", read === Math.min(5, order.length), `${read} read`);

const cand = scan.text.match(/^ {2}(\S+):(\d+)-(\d+) (\S+) \[/m);
const spot = spotArg?.match(/^(\S+):(\d+)-(\d+)$/) ?? (cand ? [cand[0], cand[1], cand[2], cand[3]] : null);
if (!spot) step("a spot to score", false, "no candidate and no --spot given");
else {
  const [file, a, b] = [spot[1]!, Number(spot[2]), Number(spot[3])];
  const rel = await call("jevx_related", { file, line: a });
  step("jevx_related", !rel.isError || /no function found/.test(rel.text), rel.text.split("\n").length + " lines");
  const sc = await call("jevx_scorecard", {
    file, start_line: a, end_line: b, decision: "(smoke test) a decision at this spot", primitive: "choice", question: "Which outcome fits this input?",
    outcomes: ["a", "b"], state: ["input"], deterministic_remainder: "everything else", why: "smoke test",
    features: { judgment_required: "medium", semantic_ambiguity: "medium" }, ai_score: 0.5, ai_reasons: "smoke test",
    pattern: { label: "smoke-test", input_kind: "other", rule_kind: "other", rule_shape: "smoke test", why_generic: "smoke test" }
  });
  step(`jevx_scorecard on ${file}:${a}-${b}`, !sc.isError, (sc.text.match(/average.*$/m) ?? [""])[0].trim() + (process.env.TYPESAFE_API_KEY ? " (TypeSafe on)" : " (TypeSafe off)"));
  const src = readFileSync(path.join(repo, file), "utf8").split("\n");
  const pv = await call("jevx_preview_change", { file, start_line: a, end_line: a, new_code: `${src[a - 1]} // jevx smoke test` });
  step("jevx_preview_change shows a diff and changes nothing", !pv.isError && /```diff/.test(pv.text) && !readFileSync(path.join(repo, file), "utf8").includes("jevx smoke test"));
}
const rep = await call("jevx_report");
step("jevx_report writes .jevx/report.html", !rep.isError && existsSync(path.join(repo, ".jevx/report.html")));
const sh = await call("jevx_share", { changed: [] });
step("jevx_share stays off without opt-in", /Sharing is off/.test(sh.text));
await client.close();
console.log(`\n${failed ? `${failed} step(s) failed` : "All MCP steps passed"} · ${Math.round((Date.now() - t0) / 1000)}s. Now do the manual Claude Code steps in docs/MCP-TEST.md.`);
process.exit(failed ? 1 : 0);
