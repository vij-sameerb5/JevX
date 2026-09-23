import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { findConfig } from "@jevx/core";

const TEMPLATE = `import { defineConfig } from "jevx";

export default defineConfig({
  include: ["src/**/*.{ts,tsx,js,jsx}"],
  exclude: ["**/*.test.ts", "**/*.spec.ts", "node_modules", "dist"],
  languages: ["typescript", "javascript"],

  thresholds: {
    minimum: 50,
    strong: 75,
    veryStrong: 90
  },

  // Signal weights. Tune these against regression/legacy-v1/ — every change should be measurable.
  signals: {
    stringIncludes: 25,
    regexOnText: 20,
    keywordList: 20,
    textBranches: 15,
    switchOnText: 15,
    normalizeThenMatch: 10,
    fuzzyMatch: 20,
    hardcodedLabels: 25,
    codeContext: -30 // penalty: lexers, tokenizers, highlighters
  },

  // Keys are read from the environment. Never paste them into this file.
  // Validation sends each 50+ candidate's code snippet to TypeSafe; --no-validate keeps it local.
  typesafe: {
    apiKey: process.env.TYPESAFE_API_KEY,
    model: "jev-latest",
    concurrency: 4
  },
  // Optional code analyst for \`jevx analyze --gemini\` (evidence only, never a label).
  // The key is read from GEMINI_API_KEY and is never accepted here.
  // Adaptive context: JevX indexes the whole repo; Gemini starts with the candidate's file and
  // asks for more (callees, callers, types, constants, folder, repo overview) until it understands.
  gemini: {
    model: "gemini-3.8-flash",
    timeoutMs: 30000,
    concurrency: 4,
    context: { mode: "adaptive", maxRounds: 4, maxChars: 250000 }
  },
  // Optional second code-analyst provider for \`jevx analyze --openrouter\`. Same prompt, schema
  // and adaptive context as gemini (uses gemini.context). Key from OPENROUTER_API_KEY only.
  openrouter: {
    model: "x-ai/grok-4.6",
    timeoutMs: 120000,
    concurrency: 2
  },

  safety: {
    gitCheckpoint: true,
    checkpointMode: "branch",
    typecheckAfterApply: true,
    testCommand: "npm test"
  }
});
`;

export function runInit(root: string, force: boolean): number {
  const existing = findConfig(root);
  if (existing && !force) {
    process.stderr.write(`${chalk.yellow("!")} ${path.relative(root, existing)} already exists. Use --force to overwrite.\n`);
    return 1;
  }
  const target = path.join(root, "jevx.config.ts");
  const hadSrc = existsSync(path.join(root, "src"));
  const body = hadSrc ? TEMPLATE : TEMPLATE.replace('"src/**/*.{ts,tsx,js,jsx}"', '"**/*.{ts,tsx,js,jsx}"');
  writeFileSync(target, body);
  const out = (s = "") => process.stdout.write(s + "\n");
  out(`${chalk.green("✓")} Created ${path.relative(process.cwd(), target) || "jevx.config.ts"}`);
  out();
  out("API keys are read from the environment, never written into the config:");
  out(chalk.gray("  export TYPESAFE_API_KEY=...   # TypeSafe validation (final confidence)"));
  out(chalk.gray("  export GEMINI_API_KEY=...     # optional: jevx analyze --gemini (code-analyst evidence)"));
  out(chalk.gray("  export OPENROUTER_API_KEY=... # optional: jevx analyze --openrouter (same analyst, other provider)"));
  out();
  out(`Add ${chalk.bold(".jevx/")} to your .gitignore — JevX keeps local metrics there.`);
  out(`Next: ${chalk.cyan("jevx check")} then ${chalk.cyan("jevx analyze")}`);
  return 0;
}
