// jevx-mcp — JevX as an MCP server. The user's own AI (Claude Code, Cursor, Copilot…) does the
// thinking with the user's own tokens; JevX gives it local repository tools, Jev-specific
// guidance, a three-source scorecard and a red/green preview of each change.
//
// Nothing here edits source files. Writes go only to <root>/.jevx/ (proposals, patches, report,
// caches). Network: only jevx_scorecard, and only to TypeSafe when TYPESAFE_API_KEY is set.
import { readFileSync } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  FEATURES,
  GUIDE,
  LEVELS,
  PROFILE,
  INPUT_KINDS,
  RULE_KINDS,
  allProposals,
  askJev,
  blendPatterns,
  combine,
  learnedScore,
  planRead,
  shareEnabled,
  shareRun,
  hunksOf,
  loadProposal,
  patternScore,
  previewDiff,
  proposalId,
  renderCard,
  resolveRoot,
  saveProposal,
  typesafeScore,
  workspace,
  writeReport,
  type FeatureLevels,
  type Opportunity,
  type Proposal,
  type ProposalRecord
} from "@jevx/engine";

export const VERSION = "0.4.0";
const MAX_TEXT = 60_000;

const text = (s: string) => ({ content: [{ type: "text" as const, text: s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}\n… (truncated at ${MAX_TEXT} characters — read a narrower item)` : s }] });
const fail = (s: string) => ({ content: [{ type: "text" as const, text: `Error: ${s}` }], isError: true });
const rootArg = z.string().optional().describe("Repository root. Default: JEVX_ROOT or the server's working directory.");
const relFile = (root: string, file: string) => path.relative(root, path.resolve(root, file)).split(path.sep).join("/");

export function createServer(): McpServer {
  const server = new McpServer({ name: "jevx", version: VERSION }, { instructions: "JevX finds where TypeSafe Jev (Noul / Choice / Score) would improve a codebase. Start with jevx_guide, then jevx_scan." });

  server.registerTool(
    "jevx_guide",
    {
      title: "How to find Jev opportunities",
      description: "Read this first. Explains what a Jev opportunity is (and is not), the workflow with the other jevx tools, how to write the Jev change, and the scorecard inputs.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async () => text(GUIDE)
  );

  server.registerTool(
    "jevx_scan",
    {
      title: "Scan the repository",
      description:
        "Local, free, no AI: indexes the repository and lists the functions static analysis thinks MIGHT hold a decision (a starting list, not a verdict), plus where Jev is already used. Returns ids to pass to jevx_read.",
      inputSchema: {
        root: rootArg,
        limit: z.number().int().min(1).max(300).optional().describe("Max candidates to list (default 60)."),
        refresh: z.boolean().optional().describe("Re-index even if no file changed.")
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ root, limit, refresh }) => {
      try {
        const ws = await workspace(root, refresh);
        const a = ws.analysis;
        const lines: string[] = [];
        lines.push(`JevX scan · ${ws.root}`);
        lines.push(`${ws.files.length} files · ${a.candidates.length} candidate decision(s) · ${a.filtered.length} ruled out as exact logic · ${ws.jev.stats.decisionSites} existing Jev decision(s)`);
        lines.push(`Read the repository overview with jevx_read id "repo:overview".`, "");
        if (ws.jev.sites.length) {
          lines.push("Already using Jev (do not re-propose these):");
          for (const s of ws.jev.sites.filter((x) => x.role === "decision")) lines.push(`  ${s.file}:${s.unit.start} ${s.unit.name} — ${s.questions.map((q) => q.primitive + (q.key ? `:${q.key}` : "")).join(", ")}`);
          lines.push("");
        }
        const n = limit ?? 60;
        lines.push(`Candidates (static shapes, not verdicts)${a.candidates.length > n ? ` — first ${n} of ${a.candidates.length}` : ""}:`);
        for (const c of a.candidates.slice(0, n)) {
          const outs = c.outputs.values.length ? ` → ${c.outputs.values.slice(0, 5).join(" | ")}${c.outputs.values.length > 5 ? " …" : ""}` : "";
          lines.push(`  ${c.file}:${c.unit.start}-${c.unit.end} ${c.unit.name} [${c.generators.map((g) => g.generator).join(", ")}]${outs}`);
          lines.push(`      id: unit:${c.file}#${c.unit.name}@${c.unit.start}`);
        }
        if (!a.candidates.length) lines.push("  (none — read the source yourself, below)");
        const plan = planRead(ws.root, ws.files, Number.POSITIVE_INFINITY);
        lines.push("", `READING ORDER — read these source files yourself with jevx_read "file:<path>" (logic first, UI last; ${plan.skipped.length} tests/configs/ui-kit files skipped):`);
        for (const f of plan.read.slice(0, 200)) lines.push(`  ${f} (${plan.lines.get(f) ?? "?"} lines)`);
        if (plan.read.length > 200) lines.push(`  … and ${plan.read.length - 200} more`);
        lines.push("", "Static analysis misses things: most real spots are found by reading the files, not from the candidate list.");
        return text(lines.join("\n"));
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.registerTool(
    "jevx_read",
    {
      title: "Read code from the repository",
      description:
        'Read one item by id: "repo:overview" (package, README head, tree, exports), "file:<path>", "outline:<path>" (imports + signatures), "module:<folder>" (outlines of a folder), "unit:<path>#<name>@<line>" (a function), or any id returned by jevx_related / jevx_search. Secrets are scrubbed.',
      inputSchema: { root: rootArg, id: z.string().describe('e.g. "repo:overview", "file:src/router.ts", "unit:src/router.ts#route@12"') },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ root, id }) => {
      try {
        const ws = await workspace(root);
        const item = ws.index.resolve(id.trim());
        if (!item) return fail(`nothing found for "${id}". Use jevx_search, or an id from jevx_scan / jevx_related.`);
        return text(`${item.title}\n${item.text}`);
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.registerTool(
    "jevx_related",
    {
      title: "What a function connects to",
      description: "For the function starting at <file>:<line>: its callees, callers, the types and constants it uses, files that import its file, its folder and the repo overview — as ids for jevx_read.",
      inputSchema: { root: rootArg, file: z.string(), line: z.number().int().min(1).describe("The line the function starts on."), name: z.string().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ root, file, line, name }) => {
      try {
        const ws = await workspace(root);
        const f = relFile(ws.root, file);
        const { catalog } = ws.index.initial({ file: f, unit: { name: name ?? "", start: line } });
        if (!catalog.length) return fail(`no function found at ${f}:${line} (pass the line the function starts on)`);
        return text([`Related to ${f}:${line}:`, ...catalog.map((r) => `  [${r.kind}] ${r.title}\n      id: ${r.id}`)].join("\n"));
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.registerTool(
    "jevx_search",
    {
      title: "Search the repository",
      description: "Find functions, types, constants or files by name or description. Returns ids for jevx_read.",
      inputSchema: { root: rootArg, query: z.string(), limit: z.number().int().min(1).max(30).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ root, query, limit }) => {
      try {
        const ws = await workspace(root);
        const refs = ws.index.search(query, limit ?? 8);
        if (!refs.length) return text(`No match for "${query}". Try a function, type or file name.`);
        return text(refs.map((r) => `[${r.kind}] ${r.title}\n    id: ${r.id}`).join("\n"));
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    }
  );

  const level = z.enum([...LEVELS, "unknown"]);
  server.registerTool(
    "jevx_scorecard",
    {
      title: "Score a proposed Jev decision",
      description:
        "Scores ONE proposed Jev decision three ways — patterns (how it compares with real Jev sites JevX studied), your AI score, and TypeSafe (Jev's own opinion, needs TYPESAFE_API_KEY) — and averages them. Saves the proposal to .jevx/proposals and updates .jevx/report.html. Changes no source code. Call before jevx_preview_change.",
      inputSchema: {
        root: rootArg,
        file: z.string(),
        start_line: z.number().int().min(1).describe("First line of the code the decision lives in (usually the function)."),
        end_line: z.number().int().min(1),
        decision: z.string().describe("What is decided, in one sentence."),
        primitive: z.enum(["noul", "choice", "score"]),
        question: z.string().describe("The question Jev would answer."),
        outcomes: z.array(z.string()).describe("Possible answers: the choice labels, yes/no, or the scale."),
        state: z.array(z.string()).describe("The inputs Jev would see."),
        deterministic_remainder: z.string().describe("What stays exact code around the Jev call."),
        why: z.string().describe("Why a judgment is needed here, concretely."),
        features: z.object(Object.fromEntries(FEATURES.map((f) => [f, level.optional()])) as Record<(typeof FEATURES)[number], z.ZodOptional<typeof level>>),
        ai_score: z.number().min(0).max(1).describe("Your confidence (0–1) that Jev genuinely improves this decision."),
        ai_reasons: z.string(),
        pattern: z
          .object({
            label: z.string().describe("generic kebab-case slug, e.g. error-message-regex-classifier"),
            input_kind: z.enum(INPUT_KINDS),
            rule_kind: z.enum(RULE_KINDS),
            rule_shape: z.string().describe("one generic sentence on the code shape — no names from this repo"),
            why_generic: z.string().describe("one generic sentence on why Jev beats the rule"),
            failure_example: z.string().optional().describe("an INVENTED input the rule gets wrong")
          })
          .optional()
          .describe("The KIND of code, in generic words with no names, paths or literals from this repository. Lets JevX learn across projects.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (args) => {
      try {
        const root = resolveRoot(args.root);
        const file = relFile(root, args.file);
        const src = readFileSync(path.join(root, file), "utf8").split("\n");
        if (args.end_line < args.start_line || args.end_line > src.length) return fail(`lines ${args.start_line}-${args.end_line} are outside ${file} (${src.length} lines)`);
        const code = src.slice(args.start_line - 1, args.end_line).join("\n");
        const proposal: Proposal = {
          decision: args.decision,
          primitive: args.primitive,
          question: args.question,
          outcomes: args.outcomes,
          state: args.state,
          deterministic_remainder: args.deterministic_remainder,
          why: args.why
        };
        const pat = patternScore(args.features as FeatureLevels);
        const pattern = args.pattern ? { ...args.pattern, label: args.pattern.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60), failure_example: args.pattern.failure_example ?? "" } : undefined;
        const learned = learnedScore(pattern);
        const jev = await askJev(root, file, code, proposal);
        const card = combine({ patterns: blendPatterns(pat.score, learned.score), ai: args.ai_score, typesafe: jev.ok ? typesafeScore(jev.answers) : undefined });
        const id = proposalId(file, args.start_line);
        const prev = loadProposal(root, id);
        const rec: ProposalRecord = {
          id,
          file,
          startLine: args.start_line,
          endLine: args.end_line,
          proposal,
          features: args.features as FeatureLevels,
          ai: { score: args.ai_score, reasons: args.ai_reasons },
          patterns: pat.matches,
          ...(jev.ok ? { jev: jev.answers } : { jevError: jev.error }),
          scorecard: card,
          ...(pattern ? { pattern } : {}),
          ...(prev?.patch && prev.startLine === args.start_line && prev.endLine === args.end_line ? { patch: prev.patch } : {}),
          at: new Date().toISOString()
        };
        saveProposal(root, rec);
        const out = [
          "```",
          renderCard(card, `${file}:${args.start_line} · ${proposal.primitive}`),
          "```",
          `Patterns: ${pat.matches.map((m) => `${m.feature}=${m.level} (${m.looksLike === "jev" ? "like Jev sites" : m.looksLike === "deterministic" ? "like exact code" : "in between"})`).join(", ") || "no features given"}.`,
          jev.ok
            ? `TypeSafe: judgment ${jev.answers.judgment.toFixed(2)}, bounded ${jev.answers.bounded.toFixed(2)}, exact code still right ${jev.answers.deterministicIsCorrect.toFixed(2)}, suggests ${jev.answers.primitive} (${jev.answers.category})${jev.cached ? " · cached" : ""}.`
            : `TypeSafe: ${jev.error}`,
          jev.ok && jev.answers.primitive !== args.primitive && jev.answers.primitive !== "none" ? `Note: Jev would use ${jev.answers.primitive}, you proposed ${args.primitive}.` : "",
          `Learned profile: ${PROFILE.from.jevSites} Jev sites and ${PROFILE.from.deterministicDecisions} deterministic decisions from ${PROFILE.from.projects} projects — a small pilot.${learned.basis ? ` Shared outcomes: ${learned.basis}.` : ""}`,
          "",
          card.verdict === "WEAK_FIT" ? "Next: probably leave this as exact code." : `Next: write the Jev implementation and call jevx_preview_change with file, start_line ${args.start_line}, end_line ${args.end_line}.`
        ].filter(Boolean);
        return text(out.join("\n"));
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.registerTool(
    "jevx_preview_change",
    {
      title: "Preview the Jev change (red/green diff)",
      description:
        "Shows the exact change as a red/green unified diff: lines start_line..end_line of the file replaced with new_code. DOES NOT modify the file. Saves the patch to .jevx/proposals and the report. Show the diff to the user; apply it with your own edit tool only after they agree.",
      inputSchema: {
        root: rootArg,
        file: z.string(),
        start_line: z.number().int().min(1),
        end_line: z.number().int().min(1),
        new_code: z.string().describe("The full replacement for those lines, including any new imports only if they fall inside the range."),
        imports: z.string().optional().describe("Import lines to add at the top of the file (e.g. the TypeSafe SDK import), if needed.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (args) => {
      try {
        const root = resolveRoot(args.root);
        const file = relFile(root, args.file);
        let { patch, added, removed } = previewDiff(root, file, args.start_line, args.end_line, args.new_code);
        if (args.imports?.trim()) {
          // imports go above the change: build the full new file and diff it once
          const src = readFileSync(path.join(root, file), "utf8").split("\n");
          const body = [...src.slice(0, args.start_line - 1), ...args.new_code.replace(/\n$/, "").split("\n"), ...src.slice(args.end_line)];
          const lastImport = body.reduce((last, l, i) => (/^\s*import\s/.test(l) ? i : last), -1);
          body.splice(lastImport + 1, 0, ...args.imports.trim().split("\n"));
          const { createTwoFilesPatch } = await import("diff");
          patch = createTwoFilesPatch(`a/${file}`, `b/${file}`, src.join("\n"), body.join("\n"), "current", "with Jev", { context: 3 });
          const ls = patch.split("\n");
          added = ls.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
          removed = ls.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
        }
        const id = proposalId(file, args.start_line);
        const rec = loadProposal(root, id);
        if (rec) saveProposal(root, { ...rec, patch });
        else writeReport(root);
        return text(
          [
            `Proposed change to ${file} — +${added} −${removed} (NOT applied):`,
            "",
            "```diff",
            hunksOf(patch),
            "```",
            "",
            rec ? `Scorecard: ${rec.scorecard.verdict} · average ${typeof rec.scorecard.average === "number" ? Math.round(rec.scorecard.average * 100) + "%" : "—"}.` : "No scorecard for this location yet — run jevx_scorecard first so the user can judge the fit.",
            `Saved to .jevx/proposals/${id}.patch · report: .jevx/report.html`,
            "Apply it with your edit tool only after the user agrees, then run the tests."
          ].join("\n")
        );
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.registerTool(
    "jevx_report",
    {
      title: "Write the JevX report",
      description: "Writes .jevx/report.html (every scorecard with its red/green diff) and returns a summary table of all proposals.",
      inputSchema: { root: rootArg },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ root }) => {
      const r = resolveRoot(root);
      const f = writeReport(r);
      const rows = allProposals(r).map(
        (p) =>
          `| ${p.file}:${p.startLine} | ${p.proposal.primitive} | ${pct(p.scorecard.scores.patterns)} | ${pct(p.scorecard.scores.ai)} | ${pct(p.scorecard.scores.typesafe)} | **${pct(p.scorecard.average)}** | ${p.scorecard.verdict} | ${p.patch ? "yes" : "—"} |`
      );
      return text(
        [
          `Report written: ${f}`,
          "",
          "| location | primitive | patterns | AI | TypeSafe | average | verdict | diff |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          ...rows,
          rows.length ? "" : "(no proposals yet)"
        ].join("\n")
      );
    }
  );

  server.registerTool(
    "jevx_share",
    {
      title: "Share anonymous outcomes (opt-in)",
      description:
        "Only when the user opted in (JEVX_SHARE=1 plus JEVX_SUPABASE_URL / JEVX_SUPABASE_ANON_KEY). Sends one anonymous row per scored proposal to the JevX dataset: the generic pattern, the scores, the verdict and whether you changed it. Never code, paths, file or function names (scrubbed in code). Call once at the end with the ids of the proposals you actually changed.",
      inputSchema: {
        root: rootArg,
        changed: z.array(z.string()).describe("Proposal ids you applied (as in jevx_report / .jevx/proposals)."),
        min_fit: z.number().min(50).max(100).optional().describe("The minimum fit the user asked for, in percent (default 70).")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ root, changed, min_fit }) => {
      if (!shareEnabled()) return text("Sharing is off (JEVX_SHARE is not 1). Nothing was sent.");
      const r = resolveRoot(root);
      const recs = allProposals(r);
      const verdictStatus: Record<string, Opportunity["status"]> = { STRONG_FIT: "strong", POSSIBLE_FIT: "possible", REVIEW_DISAGREE: "review", WEAK_FIT: "weak" };
      const opportunities: Opportunity[] = recs.map((p) => ({
        id: p.id,
        file: p.file,
        unit: { name: "", start: p.startLine, end: p.endLine },
        origin: "ai",
        status: verdictStatus[p.scorecard.verdict] ?? "weak",
        assessment: { is_opportunity: true, decision: p.proposal.decision, primitive: p.proposal.primitive as "noul" | "choice" | "score", question: p.proposal.question, outcomes: p.proposal.outcomes, state: p.proposal.state, deterministic_remainder: p.proposal.deterministic_remainder, why: p.proposal.why, features: p.features, ai_score: p.ai.score, context_sufficient: true, missing_context: [], understanding_confidence: "high", ...(p.pattern ? { pattern: p.pattern } : {}) },
        record: p
      }));
      const set = new Set(changed);
      const applied = { changed: opportunities.filter((o) => set.has(o.id)), reverted: [], skipped: [], checks: { baseline: [], after: [], gate: [] }, backupDir: "", files: [] };
      const res = await shareRun({ root: r, runId: `mcp-${new Date().toISOString().replace(/[:.]/g, "-")}`, version: VERSION, provider: "mcp", model: "editor", dryRun: false, minFit: (min_fit ?? 70) / 100, opportunities, applied });
      return "error" in res ? fail(`not shared: ${res.error}`) : text(`Shared ${res.sent} anonymous finding(s) with the JevX dataset (no code, no names).`);
    }
  );

  server.registerPrompt(
    "find-jev-opportunities",
    { title: "Find Jev opportunities in this repository", description: "Runs the JevX workflow: scan, read, propose, score, preview.", argsSchema: { focus: z.string().optional().describe("A folder or feature to focus on") } },
    ({ focus }) => ({
      messages: [{ role: "user", content: { type: "text", text: `${GUIDE}\n\nNow do it for this repository${focus ? `, focusing on ${focus}` : ""}. Start with jevx_scan, then read the source files in its reading order. Change every STRONG_FIT directly (callers included) — or, if I state a minimum fit (e.g. "use Jev where the fit is at least 55%"), every fit at or above it, never below 50%. Run the tests, revert anything that breaks them, then summarise with the scorecards. Don't ask me to pick.` } }]
    })
  );

  return server;
}

const pct = (x?: number) => (typeof x === "number" ? `${Math.round(x * 100)}%` : "—");
