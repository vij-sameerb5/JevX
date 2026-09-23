// Opt-in, anonymous outcomes for the JevX dataset (Supabase). This is how JevX learns from what
// the AI found: every finding becomes one row, labelled by what actually happened to it.
//
//   Sent:     the kind of decision (primitive, a one-line description), feature levels, the three
//             scores, the verdict, and the outcome: changed / reverted by tests / preview / left.
//             Later, `jevx undo` adds an "undone" row for the run.
//   Never:    code, file contents, file or function names, paths, repo names, keys. The repo is a
//             random id kept in .jevx/repo-id.
//
// Off unless JEVX_SHARE=1 (or --share). Needs JEVX_SUPABASE_URL + JEVX_SUPABASE_ANON_KEY; the
// tables only accept inserts from that key (see supabase/jevx-dataset.sql). A failed upload never
// fails the run.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { scrubSecrets } from "@jevx/core";
import type { ApplyResult } from "./apply.js";
import type { Opportunity } from "./pipeline.js";
import { ENGINE_PROMPT_VERSION } from "./prompts.js";

export const shareEnabled = (flag?: boolean) => flag === true || process.env.JEVX_SHARE?.trim() === "1";

export function shareTarget(): { url: string; key: string } | { error: string } {
  const url = process.env.JEVX_SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = process.env.JEVX_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return { error: "JEVX_SUPABASE_URL and JEVX_SUPABASE_ANON_KEY are not set" };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { error: "JEVX_SUPABASE_URL is not a URL" };
  }
  if (u.protocol !== "https:" && process.env.JEVX_ALLOW_CUSTOM_BASE_URL !== "1") return { error: "JEVX_SUPABASE_URL must be https" };
  if (!u.hostname.endsWith(".supabase.co") && process.env.JEVX_ALLOW_CUSTOM_BASE_URL !== "1") return { error: "JEVX_SUPABASE_URL is not a supabase.co address (set JEVX_ALLOW_CUSTOM_BASE_URL=1 for a self-hosted one)" };
  return { url, key };
}

export function repoId(root: string): string {
  const f = path.join(root, ".jevx", "repo-id");
  try {
    const v = readFileSync(f, "utf8").trim();
    if (/^[0-9a-f-]{36}$/.test(v)) return v;
  } catch {
    /* first time */
  }
  const id = randomUUID();
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, id + "\n");
  return id;
}

const PATH_KINDS: [RegExp, string][] = [
  [/(^|\/)api\//, "api"],
  [/(^|\/)(lib|utils?|helpers?|core|domain)\//, "lib"],
  [/(^|\/)(server|services?|handlers?|workers?|jobs?|actions?)\//, "server"],
  [/(^|\/)components\//, "component"],
  [/(^|\/)(app|pages)\//, "page"]
];
export const pathKind = (file: string) => PATH_KINDS.find(([r]) => r.test(file))?.[1] ?? "other";
const clip = (s: string | undefined, n: number) => (s ? scrubSecrets(s.replace(/\s+/g, " ").trim()).text.slice(0, n) : null);
const r3 = (x: number | undefined) => (typeof x === "number" ? Math.round(x * 1000) / 1000 : null);

export interface ShareInput {
  root: string;
  runId: string;
  version: string;
  provider: string;
  model: string;
  dryRun: boolean;
  opportunities: Opportunity[];
  applied?: ApplyResult;
}

export function findingRows(x: ShareInput) {
  const repo = repoId(x.root);
  const changed = new Set(x.applied?.changed.map((o) => o.id) ?? []);
  const reverted = new Map(x.applied?.reverted.map((r) => [r.opportunity.id, r.reason]) ?? []);
  const skipped = new Map(x.applied?.skipped.map((r) => [r.opportunity.id, r.reason]) ?? []);
  const before = x.applied?.checks.baseline.every((c) => c.ok);
  const after = x.applied?.checks.after.length ? x.applied.checks.after.every((c) => c.ok) : undefined;
  return x.opportunities
    .filter((o) => o.assessment)
    .map((o) => {
      const sc = o.record?.scorecard;
      const result = changed.has(o.id) ? "changed" : reverted.has(o.id) ? "reverted" : skipped.has(o.id) ? "skipped" : x.dryRun && o.edits?.length ? "preview" : "left";
      return {
        run_id: x.runId,
        repo_id: repo,
        jevx_version: x.version,
        prompt_version: ENGINE_PROMPT_VERSION,
        provider: x.provider,
        model: x.model,
        origin: o.origin,
        file_ext: path.extname(o.file).slice(1).slice(0, 8) || null,
        path_kind: pathKind(o.file),
        is_opportunity: o.assessment!.is_opportunity,
        primitive: o.assessment!.primitive,
        decision: clip(o.assessment!.decision, 200),
        outcome_count: o.assessment!.outcomes.length,
        features: o.assessment!.features,
        ai_score: r3(sc?.scores.ai ?? o.assessment!.ai_score),
        pattern_score: r3(sc?.scores.patterns),
        typesafe_score: r3(sc?.scores.typesafe),
        average: r3(sc?.average),
        verdict: sc?.verdict ?? "NOT_OPPORTUNITY",
        status: o.status,
        result,
        result_reason: clip(reverted.get(o.id) ?? skipped.get(o.id), 120),
        checks_before_ok: x.applied ? (before ?? null) : null,
        checks_after_ok: after ?? null
      };
    });
}

async function post(table: string, rows: unknown[], timeoutMs = 8000): Promise<{ ok: true } | { error: string }> {
  const t = shareTarget();
  if ("error" in t) return t;
  try {
    const res = await fetch(`${t.url}/rest/v1/${table}`, {
      method: "POST",
      headers: { apikey: t.key, Authorization: `Bearer ${t.key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(rows),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) return { error: `Supabase answered ${res.status}: ${(await res.text()).slice(0, 160)}` };
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function shareRun(x: ShareInput): Promise<{ sent: number } | { error: string }> {
  const rows = findingRows(x);
  if (!rows.length) return { sent: 0 };
  const r = await post("jevx_findings", rows);
  return "error" in r ? r : { sent: rows.length };
}

/** `jevx undo` → the run's changes were not kept. */
export async function shareUndo(root: string, runId: string): Promise<{ ok: true } | { error: string }> {
  return post("jevx_outcomes", [{ run_id: runId, repo_id: repoId(root), outcome: "undone" }]);
}
