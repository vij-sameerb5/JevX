// jevx — find where Jev (TypeSafe Noul / Choice / Score) belongs in your codebase, and change it.
//
//   jevx                  do it: find, judge, change the strong fits, run your checks
//   jevx --dry-run        same, but only show the changes
//   jevx undo             put back everything the last run changed
//   jevx mcp install      let Claude Code / Cursor do it with the AI you already use
//   jevx mcp              the MCP server itself (what Claude Code / Cursor start)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { Command } from "commander";
import { shareEnabled, shareUndo, undoLast } from "@jevx/engine";
import { loadEnvFile } from "./env.js";
import { bigLogo } from "./logo.js";
import { VERSION } from "./server.js";
import { run } from "./run.js";
import { accent, banner, box, dim, ok, warn } from "./ui.js";

const log = (s = "") => void process.stdout.write(s + "\n");
// keys from JEVX_ENV_FILE or ~/.jevx/.env; the shell's own variables always win
const envFile = loadEnvFile();

const program = new Command()
  .name("jevx")
  .description("Find where Jev fits in your codebase, and change it.")
  .version(VERSION)
  .argument("[path]", "project folder", ".")
  .option("--dry-run", "show the changes without writing them")
  .option("--welcome", "show the JEVX welcome again")
  .option("--provider <name>", "xai | openrouter (default: whichever key is set)")
  .option("--model <id>", "model to use with that provider")
  .option("--max <n>", "most places to inspect (default 12)", Number)
  .option("--budget <tokens>", "token budget for the run (default 400000)", Number)
  .option("--no-verify", "don't run your tests / typecheck")
  .option("--no-install", "don't install @typesafe-ai/sdk")
  .option("-y, --yes", "don't ask before sending code to the AI")
  .option("--share", "share anonymous outcomes (no code) with the JevX dataset; same as JEVX_SHARE=1")
  .option("--min-fit <percent>", "lowest fit that gets written, 50–100 (default 70 = strong fits only)", Number)
  .option("--include-possible", "same as --min-fit 50")
  .option("--include-disagree", "also write fits the sources disagree on, if they reach --min-fit")
  .option("--report-json <file>", "also write the full result as JSON (stays on your machine)")
  .option("--fast", "less AI reasoning while reading the code (cheaper, may miss spots)")
  .action(async (p: string, o: { welcome?: boolean; dryRun?: boolean; provider?: string; model?: string; max?: number; budget?: number; verify: boolean; install: boolean; yes?: boolean; share?: boolean; minFit?: number; includePossible?: boolean; includeDisagree?: boolean; fast?: boolean; reportJson?: string }) => {
    if (o.welcome) return log(bigLogo(VERSION));
    process.exitCode = await run({ root: p, provider: o.provider, model: o.model, max: o.max, budget: o.budget, dryRun: Boolean(o.dryRun), verify: o.verify, install: o.install, yes: Boolean(o.yes), share: o.share, envFile, minFit: o.minFit ?? (o.includePossible ? 50 : undefined), includeDisagree: Boolean(o.includeDisagree), fast: Boolean(o.fast), reportJson: o.reportJson });
  });

program
  .command("undo")
  .description("put back every file the last run changed")
  .argument("[path]", "project folder", ".")
  .action(async (p: string) => {
    const r = undoLast(p);
    if (!r.runId) return log(dim("  Nothing to undo."));
    log(ok(`Restored ${r.files.length} file(s) from the run of ${r.runId.slice(0, 16).replace("T", " ")}`));
    if (shareEnabled()) {
      const s = await shareUndo(path.resolve(p), r.runId);
      if ("error" in s) log(warn(`Stats not shared: ${s.error}`));
    }
  });

const mcp = program
  .command("mcp")
  .description("run the MCP server (Claude Code / Cursor start this)")
  .action(async () => {
    await import("./mcp.js");
  });

mcp
  .command("install")
  .description("add JevX to Claude Code and Cursor")
  .action(() => {
    log(banner());
    // Prefer the installed `jevx` command; fall back to this exact file.
    let command = "jevx";
    let args = ["mcp"];
    try {
      execFileSync(process.platform === "win32" ? "where" : "which", ["jevx"], { stdio: "ignore" });
    } catch {
      command = process.execPath;
      args = [fileURLToPath(import.meta.url), "mcp"];
    }
    let any = false;
    // Claude Code
    try {
      execFileSync("claude", ["mcp", "remove", "--scope", "user", "jevx"], { stdio: "ignore" });
    } catch {
      /* not there yet */
    }
    try {
      execFileSync("claude", ["mcp", "add", "--scope", "user", "jevx", "--", command, ...args], { stdio: "ignore" });
      log(ok("Claude Code — added for every project"));
      any = true;
    } catch {
      log(dim("  ○ Claude Code not found (skipped)"));
    }
    // Cursor
    const cursorDir = path.join(homedir(), ".cursor");
    if (existsSync(cursorDir)) {
      const f = path.join(cursorDir, "mcp.json");
      let cfg: { mcpServers?: Record<string, unknown> } = {};
      try {
        if (existsSync(f)) cfg = JSON.parse(readFileSync(f, "utf8")) as typeof cfg;
      } catch {
        return log(warn(`${f} is not valid JSON — add JevX by hand: "jevx": { "command": "${command}", "args": ${JSON.stringify(args)} }`));
      }
      cfg.mcpServers = { ...(cfg.mcpServers ?? {}), jevx: { command, args } };
      mkdirSync(cursorDir, { recursive: true });
      writeFileSync(f, JSON.stringify(cfg, null, 2) + "\n");
      log(ok("Cursor — added for every project"));
      any = true;
    } else log(dim("  ○ Cursor not found (skipped)"));
    log("");
    log(
      any
        ? box([`Restart Claude Code / Cursor, open any project and say:`, accent(`  "use jevx to find where Jev fits in this repo"`), "", dim("Optional: set TYPESAFE_API_KEY so scorecards include Jev's own opinion.")], "READY")
        : box(["Neither Claude Code nor Cursor was found.", `Add this MCP server by hand: command ${chalk.bold(command)} args ${chalk.bold(args.join(" "))}`], "JEVX")
    );
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(chalk.red(`jevx: ${err instanceof Error ? err.message : String(err)}\n`));
  process.exitCode = 1;
});
