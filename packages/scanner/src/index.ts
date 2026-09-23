import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import ignore from "ignore";
import { Project, ScriptKind, ts, type SourceFile } from "ts-morph";

export interface ScanOptions {
  /** Project root. All globs are relative to it. */
  root: string;
  include: string[];
  exclude: string[];
  /** Respect the root .gitignore (default true). */
  respectGitignore?: boolean;
}

export interface ScannedProject {
  root: string;
  project: Project;
  files: SourceFile[];
  /** Files that could not be read or parsed, with the reason. */
  skipped: { file: string; reason: string }[];
}

const ALWAYS_IGNORED = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.git/**",
  "**/.jevx/**",
  "**/*.d.ts",
  "**/*.min.js",
  "**/*.bundle.js"
];

/** Files larger than this are almost always generated. */
const MAX_FILE_BYTES = 512 * 1024;

/** Bundled / minified output: very long lines, very few of them. */
export function looksGenerated(text: string): boolean {
  if (text.length > MAX_FILE_BYTES) return true;
  const lines = text.split("\n");
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  return longest > 2000 || (text.length > 5000 && text.length / lines.length > 300);
}

/** Turn a bare folder name like "node_modules" into a glob that matches it anywhere. */
function normalizeExclude(pattern: string): string {
  if (/[*?{[]/.test(pattern) || pattern.includes("/")) return pattern;
  return `**/${pattern}/**`;
}

export async function findFiles(opts: ScanOptions): Promise<string[]> {
  const root = path.resolve(opts.root);
  const entries = await fg(opts.include, {
    cwd: root,
    ignore: [...ALWAYS_IGNORED, ...opts.exclude.map(normalizeExclude)],
    onlyFiles: true,
    dot: false,
    followSymbolicLinks: false
  });

  let files = entries;
  const gitignorePath = path.join(root, ".gitignore");
  if (opts.respectGitignore !== false && existsSync(gitignorePath)) {
    const ig = ignore().add(readFileSync(gitignorePath, "utf8"));
    files = files.filter((f) => !ig.ignores(f));
  }
  return files.sort().map((f) => path.join(root, f));
}

function scriptKindFor(file: string): ScriptKind {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case ".tsx":
      return ScriptKind.TSX;
    case ".jsx":
      return ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ScriptKind.JS;
    default:
      return ScriptKind.TS;
  }
}

/** Walk the repo, apply ignores, and load every matching file into a ts-morph project. */
export async function scanProject(opts: ScanOptions): Promise<ScannedProject> {
  const root = path.resolve(opts.root);
  const paths = await findFiles(opts);

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noLib: false,
      skipLibCheck: true,
      strict: false
    }
  });

  const files: SourceFile[] = [];
  const skipped: ScannedProject["skipped"] = [];
  for (const file of paths) {
    try {
      const text = readFileSync(file, "utf8");
      if (looksGenerated(text)) {
        skipped.push({ file, reason: "generated or minified" });
        continue;
      }
      files.push(project.createSourceFile(file, text, { overwrite: true, scriptKind: scriptKindFor(file) }));
    } catch (err) {
      skipped.push({ file, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { root, project, files, skipped };
}
