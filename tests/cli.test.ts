import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execa } from "execa";
import { startMockServer } from "./mock-typesafe.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, "../apps/cli/src/index.tsx");
const EXAMPLE = path.resolve(here, "../regression/legacy-v1/support-bot");

/** Run the CLI from source. The key is blanked by default so a developer's real key is never used. */
const run = (args: string[], env: Record<string, string> = {}) =>
  execa("npx", ["tsx", CLI, ...args], {
    reject: false,
    env: { NO_COLOR: "1", TYPESAFE_API_KEY: "", TYPESAFE_BASE_URL: "", ...env }
  });

describe("jevx CLI", () => {
  it("prints the version", async () => {
    const r = await run(["--version"]);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("without a key: scan still works, scores stay preliminary and say why", async () => {
    const r = await run(["scan", EXAMPLE, "--json"]);
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.validated).toBe(false);
    expect(out.scoreKind).toBe("preliminary");
    expect(out.validation.skipped).toMatch(/TYPESAFE_API_KEY/);
    expect(out.candidates[0].location).toBe("src/router.ts:7");
    expect(out.candidates.every((c: { score: number }) => c.score >= 50)).toBe(true);
  });

  it("--fail-on strong exits non-zero when a strong candidate exists", async () => {
    const r = await run(["scan", EXAMPLE, "--plain", "--no-validate", "--fail-on", "strong"]);
    expect(r.exitCode).toBe(1);
  });

  it("unbuilt commands say which milestone ships them", async () => {
    const r = await run(["apply", "src/router.ts:7"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("M9+");
  });

  it("explain finds a file in another project without --cwd (root inferred from the file)", async () => {
    const other = mkdtempSync(path.join(tmpdir(), "jevx-other-"));
    try {
      writeFileSync(path.join(other, "package.json"), "{}");
      mkdirSync(path.join(other, "app"));
      writeFileSync(
        path.join(other, "app", "page.tsx"),
        [
          "export function toastFor(msg: string) {",
          "  if (/User rejected|rejected the request|denied/i.test(msg)) return 'cancelled';",
          "  else if (/timed out|timeout/i.test(msg)) return 'retry';",
          "  else if (/insufficient|balance|exceeds|funds/i.test(msg)) return 'funds';",
          "  return 'error';",
          "}",
          ""
        ].join("\n")
      );
      // run from the JevX repo (a different directory), like `pnpm dev explain ~/Desktop/app/...`
      const r = await run(["explain", path.join(other, "app/page.tsx:3"), "--plain", "--no-validate"]);
      expect(r.stderr).toBe("");
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/^app\/page\.tsx:2 /m);
      expect(r.stdout).toContain("regexOnText");

      const miss = await run(["explain", path.join(other, "app/page.tsx:20"), "--plain", "--no-validate"]);
      expect(miss.exitCode).toBe(1);
      expect(miss.stderr).toMatch(/span lines: 2–4/);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("check fails without a key", async () => {
    const r = await run(["check", EXAMPLE]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toMatch(/key: not set/);
  });
});

describe("jevx CLI against a mock TypeSafe API", () => {
  let mock: Awaited<ReturnType<typeof startMockServer>>;
  let project: string;
  const env = () => ({ TYPESAFE_API_KEY: "test-key", TYPESAFE_BASE_URL: mock.url });

  beforeAll(async () => {
    mock = await startMockServer();
    // work on a copy so the validation cache never lands inside regression/legacy-v1/
    project = mkdtempSync(path.join(tmpdir(), "jevx-cli-"));
    cpSync(EXAMPLE, project, { recursive: true });
  });
  afterAll(async () => {
    await mock.close();
    rmSync(project, { recursive: true, force: true });
  });

  it("validates the 50+ band and reports final confidence", async () => {
    const before = mock.calls.length;
    const r = await run(["scan", project, "--json"], env());
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    const sent = mock.calls.slice(before).filter((c) => c.path === "/v1/systemone");
    expect(sent.length).toBe(out.validation.attempted);
    expect(sent.length).toBeGreaterThan(0);
    expect(out.validated).toBe(true);
    expect(out.scoreKind).toBe("final");
    expect(out.candidates[0].score).toBe(93);
    expect(out.candidates[0].scoreKind).toBe("final");
    expect(out.candidates[0].preliminaryScore).toBeGreaterThanOrEqual(50);
    expect(out.candidates[0].validation.status).toBe("confirmed");
    expect(existsSync(path.join(project, ".jevx", "cache", "typesafe.json"))).toBe(true);
  });

  it("second scan is served from the cache", async () => {
    const before = mock.calls.length;
    const r = await run(["scan", project, "--json"], env());
    const out = JSON.parse(r.stdout);
    expect(mock.calls.length - before).toBe(0);
    expect(out.validation.cached).toBe(out.validation.attempted);
  });

  it("--no-validate makes no API calls even with a key", async () => {
    const before = mock.calls.length;
    const r = await run(["scan", project, "--json", "--no-validate"], env());
    const out = JSON.parse(r.stdout);
    expect(mock.calls.length - before).toBe(0);
    expect(out.validated).toBe(false);
    expect(out.scoreKind).toBe("preliminary");
  });

  it("plain output labels scores as TypeSafe-validated", async () => {
    const r = await run(["scan", project, "--plain"], env());
    expect(r.stdout).toContain("(TypeSafe-validated)");
    expect(r.stdout).toMatch(/Scores are final confidence/);
  });

  it("explain validates just that one decision", async () => {
    const before = mock.calls.length;
    const r = await run(["explain", path.join(project, "src/fuzzy.ts:11"), "--cwd", project, "--plain", "--no-cache"], env());
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/final/);
    expect(mock.calls.slice(before).filter((c) => c.path === "/v1/systemone")).toHaveLength(1);
  });

  it("check passes when the API is reachable", async () => {
    const r = await run(["check", project], env());
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/API reachable/);
    expect(r.stdout).toMatch(/test…-key|test-key|••••/);
  });

  it("a bad key stops validation early and says so", async () => {
    const r = await run(["scan", project, "--json", "--no-cache"], { ...env(), TYPESAFE_API_KEY: "bad-key" });
    const out = JSON.parse(r.stdout);
    expect(out.validation.fatal).toMatch(/authentication failed/);
    expect(out.validated).toBe(false);
  });
});
