import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Where `import ... from "jevx"` should resolve inside a user's jevx.config.ts. */
export function selfModule(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of ["config.js", "config.ts"]) {
    const p = path.join(here, candidate);
    if (existsSync(p)) return p;
  }
  return path.join(here, "config.ts");
}
