import { existsSync } from "node:fs";
import path from "node:path";
import { ts, type Project } from "ts-morph";

/**
 * Apply the analyzed project's own module resolution (baseUrl / paths, incl. `extends`) so
 * imports like "@/lib/types" resolve and literal-union / enum types are visible across files.
 * Only resolution options are taken; nothing else about the project's build is changed.
 */
export function applyProjectResolution(project: Project, root: string): boolean {
  const file = ["tsconfig.json", "jsconfig.json"].map((f) => path.join(root, f)).find((f) => existsSync(f));
  if (!file) return false;
  try {
    const read = ts.readConfigFile(file, ts.sys.readFile);
    if (read.error) return false;
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(file));
    const o = parsed.options;
    if (!o.paths && !o.baseUrl) return false;
    project.compilerOptions.set({ baseUrl: o.baseUrl, paths: o.paths, pathsBasePath: (o as { pathsBasePath?: string }).pathsBasePath });
    return true;
  } catch {
    return false;
  }
}
