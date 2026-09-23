// Keys from a file, for people who'd rather not export them in every terminal.
//
//   JEVX_ENV_FILE=/path/to/.env   read that file
//   (otherwise)                   read ~/.jevx/.env (or $JEVX_HOME/.env) if it exists
//
// Only KEY=value lines. Variables already set in the shell always win, so a file can never
// override what the user exported. Nothing from the file is printed, logged or written anywhere.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function envFilePath(): string {
  const explicit = process.env.JEVX_ENV_FILE?.trim();
  if (explicit) return path.resolve(explicit.replace(/^~(?=$|\/)/, homedir()));
  return path.join(process.env.JEVX_HOME?.trim() || path.join(homedir(), ".jevx"), ".env");
}

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2]!;
    const q = v[0];
    if ((q === '"' || q === "'") && v.endsWith(q) && v.length >= 2) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "").trim();
    out[m[1]!] = v;
  }
  return out;
}

/** Load the env file into process.env without overriding anything already set. Returns the path used, if any. */
export function loadEnvFile(): string | undefined {
  const f = envFilePath();
  let text: string;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    return undefined;
  }
  for (const [k, v] of Object.entries(parseEnv(text))) if (process.env[k] === undefined && v !== "") process.env[k] = v;
  return f;
}
