import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execa } from "execa";
import { startMockServer } from "./mock-typesafe.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, "../apps/cli/src/index.tsx");
const SAMPLE = path.resolve(here, "../regression/legacy-v1/support-bot");

const run = (args: string[], env: Record<string, string> = {}) =>
  execa("npx", ["tsx", CLI, ...args], { reject: false, env: { NO_COLOR: "1", TYPESAFE_API_KEY: "", TYPESAFE_BASE_URL: "", JEVX_DATASET: "", ...env } });

describe("jevx analyze / label / eval / dataset (Phase 1 loop)", () => {
  let work: string;
  let ds: string;
  beforeAll(() => {
    work = mkdtempSync(path.join(tmpdir(), "jevx-p1-"));
    cpSync(SAMPLE, path.join(work, "app"), { recursive: true });
    ds = path.join(work, "dataset");
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it("analyze is offline by default and reports candidates + filtered with reasons", async () => {
    const r = await run(["analyze", path.join(work, "app"), "--json"]);
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.semantic).toBeNull();
    expect(out.candidates.length).toBeGreaterThan(0);
    expect(out.candidates[0]).not.toHaveProperty("code");
    expect(out.filtered.every((c: { triage: { reason: string } }) => c.triage.reason)).toBe(true);
    expect(out.candidates.map((c: { unit: { name: string } }) => c.unit.name)).toContain("routeMessage");
  });

  it("--save requires an explicit --public / --private choice", async () => {
    const r = await run(["analyze", path.join(work, "app"), "--save", "--dataset", ds]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/--public .* --private/);
  });

  it("project → decisions → labels → dataset → evaluation", async () => {
    const saved = await run(["analyze", path.join(work, "app"), "--save", "--private", "--project", "support-bot", "--split", "dev", "--dataset", ds, "--json"]);
    expect(saved.exitCode).toBe(0);
    expect(JSON.parse(saved.stdout).saved).toMatchObject({ project: "support-bot", split: "dev", visibility: "private" });
    const entries = readFileSync(path.join(ds, "projects", "support-bot", "entries.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(entries.every((e) => e.code === undefined)).toBe(true);
    const route = entries.find((e) => e.unit.name === "routeMessage");

    const l = await run(["label", "support-bot", route.id.slice(0, 8), "s", "--reason", "routes messages by meaning", "--category", "routing", "--dataset", ds]);
    expect(l.exitCode).toBe(0);
    expect(l.stdout).toContain("STRONG_JEV");
    const bad = await run(["label", "support-bot", route.id, "maybe", "--reason", "x", "--dataset", ds]);
    expect(bad.exitCode).toBe(1);

    const m = await run(["dataset", "missed", "support-bot", "src/flows.ts:3", "STRONG_JEV", "--reason", "escalation in flow", "--dataset", ds]);
    expect(m.exitCode).toBe(0);

    const ev = await run(["eval", "--json", "--dataset", ds]);
    const rep = JSON.parse(ev.stdout);
    expect(rep.splits.dev.total).toMatchObject({ projects: 1, labelled: 2, unclassified: 1 });
    expect(rep.splits.dev.total.coverage).toMatchObject({ proposedPositives: 1, missedPositives: 1 });
    expect(rep.splits.train.total.projects).toBe(0);

    const check = await run(["dataset", "check", "--dataset", ds]);
    expect(check.exitCode).toBe(0);
    expect(check.stdout).toContain("privacy");
  });

  it("--validate talks to TypeSafe only when asked, and --offline replays the cache", async () => {
    const mock = await startMockServer();
    try {
      const env = { TYPESAFE_API_KEY: "test-key", TYPESAFE_BASE_URL: mock.url };
      const r = await run(["analyze", path.join(work, "app"), "--validate", "--json"], env);
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.semantic.apiCalls).toBe(out.candidates.length);
      expect(out.candidates.every((c: { classification?: { label: string } }) => c.classification?.label)).toBe(true);
      const before = mock.calls.length;
      const off = await run(["analyze", path.join(work, "app"), "--validate", "--offline", "--json"], { TYPESAFE_API_KEY: "" });
      expect(JSON.parse(off.stdout).semantic).toMatchObject({ apiCalls: 0, errors: 0 });
      expect(mock.calls.length).toBe(before);
    } finally {
      await mock.close();
    }
  });

  it("review refuses to run without a terminal and points at `jevx label`", async () => {
    const r = await run(["review", "support-bot", "--dataset", ds]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("jevx label");
  });

  it("legacy scan is untouched", async () => {
    const r = await run(["scan", SAMPLE, "--json"]);
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout).candidates[0].location).toBe("src/router.ts:7");
  });
});
