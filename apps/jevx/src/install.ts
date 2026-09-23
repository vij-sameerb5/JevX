// `jevx mcp install` / `jevx mcp uninstall`: register the JevX MCP server with every AI app found
// on this machine. Each app keeps its MCP servers in its own config file; we add (or remove) one
// "jevx" entry and leave everything else untouched.
//
//   - A config file is backed up once (<file>.jevx-backup) before its first change.
//   - Unreadable JSON is never overwritten: the app is skipped with the snippet to paste by hand.
//   - Apps launched from the dock/start menu don't get your shell's PATH, so they get absolute
//     paths (node + this script). Terminal tools (Claude Code, Codex, Gemini CLI) use `jevx`.
//   - Keys are never written anywhere. Only JEVX_ENV_FILE (the path of your key file) is passed on,
//     if you set one.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface Launch {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface InstallContext {
  home: string;
  platform: NodeJS.Platform;
  appData?: string; // Windows %APPDATA%
  /** How GUI apps start JevX (absolute paths). */
  gui: Launch;
  /** How terminal tools start JevX (`jevx mcp` when on PATH). */
  cli: Launch;
  /** Runs the `claude` CLI; injected in tests. Throws if it isn't installed. */
  claude?: (args: string[]) => void;
}

export type Outcome = { app: string; status: "added" | "removed" | "unchanged" | "not-found" | "skipped"; detail?: string };

type JsonShape = "mcpServers" | "vscode";

interface JsonTarget {
  app: string;
  file: string;
  detect: string; // folder that exists only if the app is installed
  shape: JsonShape;
  launch: "gui" | "cli";
}

export function jsonTargets(c: InstallContext): JsonTarget[] {
  const h = c.home;
  const mac = c.platform === "darwin";
  const win = c.platform === "win32";
  const appData = c.appData ?? path.join(h, "AppData", "Roaming");
  const claudeDesktopDir = mac ? path.join(h, "Library", "Application Support", "Claude") : win ? path.join(appData, "Claude") : path.join(h, ".config", "Claude");
  const vscodeUser = mac ? path.join(h, "Library", "Application Support", "Code", "User") : win ? path.join(appData, "Code", "User") : path.join(h, ".config", "Code", "User");
  return [
    { app: "Claude Desktop", file: path.join(claudeDesktopDir, "claude_desktop_config.json"), detect: claudeDesktopDir, shape: "mcpServers", launch: "gui" },
    { app: "Cursor", file: path.join(h, ".cursor", "mcp.json"), detect: path.join(h, ".cursor"), shape: "mcpServers", launch: "gui" },
    { app: "Windsurf", file: path.join(h, ".codeium", "windsurf", "mcp_config.json"), detect: path.join(h, ".codeium", "windsurf"), shape: "mcpServers", launch: "gui" },
    { app: "VS Code (Copilot)", file: path.join(vscodeUser, "mcp.json"), detect: vscodeUser, shape: "vscode", launch: "gui" },
    { app: "Gemini CLI", file: path.join(h, ".gemini", "settings.json"), detect: path.join(h, ".gemini"), shape: "mcpServers", launch: "cli" }
  ];
}

const entry = (l: Launch, shape: JsonShape) => ({ ...(shape === "vscode" ? { type: "stdio" } : {}), command: l.command, args: l.args, ...(l.env && Object.keys(l.env).length ? { env: l.env } : {}) });

function backupOnce(file: string) {
  const b = `${file}.jevx-backup`;
  if (existsSync(file) && !existsSync(b)) copyFileSync(file, b);
}

function editJson(t: JsonTarget, change: (servers: Record<string, unknown>) => boolean): Outcome {
  if (!existsSync(t.detect)) return { app: t.app, status: "not-found" };
  let cfg: Record<string, unknown> = {};
  if (existsSync(t.file)) {
    try {
      const raw = readFileSync(t.file, "utf8");
      cfg = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      return { app: t.app, status: "skipped", detail: `${t.file} is not plain JSON — add JevX by hand` };
    }
  }
  const key = t.shape === "vscode" ? "servers" : "mcpServers";
  const servers = { ...((cfg[key] as Record<string, unknown>) ?? {}) };
  if (!change(servers)) return { app: t.app, status: "unchanged" };
  backupOnce(t.file);
  mkdirSync(path.dirname(t.file), { recursive: true });
  writeFileSync(t.file, JSON.stringify({ ...cfg, [key]: servers }, null, 2) + "\n");
  return { app: t.app, status: "added" };
}

const codexFile = (c: InstallContext) => path.join(c.home, ".codex", "config.toml");
const tomlStr = (s: string) => JSON.stringify(s); // TOML basic strings share JSON's escaping
function codexBlock(l: Launch): string {
  const lines = ["[mcp_servers.jevx]", `command = ${tomlStr(l.command)}`, `args = [${l.args.map(tomlStr).join(", ")}]`];
  if (l.env && Object.keys(l.env).length) lines.push(`env = { ${Object.entries(l.env).map(([k, v]) => `${k} = ${tomlStr(v)}`).join(", ")} }`);
  return lines.join("\n");
}
// the [mcp_servers.jevx] table: its header line plus every following line that is not another table header
const CODEX_BLOCK = /(^|\n)\[mcp_servers\.jevx\][^\n]*(\n(?!\[)[^\n]*)*/;

export function installAll(c: InstallContext): Outcome[] {
  const out: Outcome[] = [];
  // Claude Code — through its own CLI
  if (c.claude) {
    try {
      try {
        c.claude(["mcp", "remove", "--scope", "user", "jevx"]);
      } catch {
        /* not there yet */
      }
      const env = Object.entries(c.cli.env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
      c.claude(["mcp", "add", "--scope", "user", ...env, "jevx", "--", c.cli.command, ...c.cli.args]);
      out.push({ app: "Claude Code", status: "added" });
    } catch {
      out.push({ app: "Claude Code", status: "not-found" });
    }
  }
  for (const t of jsonTargets(c)) {
    const l = t.launch === "gui" ? c.gui : c.cli;
    out.push(
      editJson(t, (s) => {
        const next = entry(l, t.shape);
        if (JSON.stringify(s.jevx) === JSON.stringify(next)) return false;
        s.jevx = next;
        return true;
      })
    );
  }
  // Codex CLI — TOML
  const cf = codexFile(c);
  if (existsSync(path.dirname(cf))) {
    const cur = existsSync(cf) ? readFileSync(cf, "utf8") : "";
    const block = codexBlock(c.cli);
    const next = (cur.replace(CODEX_BLOCK, "").replace(/\s+$/, "") + (cur.trim() ? "\n\n" : "") + block + "\n").replace(/^\n+/, "");
    if (next === cur) out.push({ app: "Codex CLI", status: "unchanged" });
    else {
      backupOnce(cf);
      writeFileSync(cf, next);
      out.push({ app: "Codex CLI", status: "added" });
    }
  } else out.push({ app: "Codex CLI", status: "not-found" });
  return out;
}

export function uninstallAll(c: InstallContext): Outcome[] {
  const out: Outcome[] = [];
  if (c.claude) {
    try {
      c.claude(["mcp", "remove", "--scope", "user", "jevx"]);
      out.push({ app: "Claude Code", status: "removed" });
    } catch {
      out.push({ app: "Claude Code", status: "unchanged" });
    }
  }
  for (const t of jsonTargets(c)) {
    const r = editJson(t, (s) => {
      if (!("jevx" in s)) return false;
      delete s.jevx;
      return true;
    });
    out.push(r.status === "added" ? { ...r, status: "removed" } : r);
  }
  const cf = codexFile(c);
  if (existsSync(cf) && CODEX_BLOCK.test(readFileSync(cf, "utf8"))) {
    backupOnce(cf);
    writeFileSync(cf, readFileSync(cf, "utf8").replace(CODEX_BLOCK, "").replace(/\s+$/, "") + "\n");
    out.push({ app: "Codex CLI", status: "removed" });
  }
  return out;
}

/** The launch commands for this machine: absolute node + script for GUI apps, `jevx` for terminals. */
export function launchers(script: string, jevxOnPath: boolean): { gui: Launch; cli: Launch } {
  const env = process.env.JEVX_ENV_FILE?.trim() ? { JEVX_ENV_FILE: path.resolve(process.env.JEVX_ENV_FILE.trim()) } : undefined;
  const gui: Launch = { command: process.execPath, args: [script, "mcp"], ...(env ? { env } : {}) };
  const cli: Launch = jevxOnPath ? { command: "jevx", args: ["mcp"], ...(env ? { env } : {}) } : gui;
  return { gui, cli };
}

export function realClaude(args: string[]) {
  execFileSync("claude", args, { stdio: "ignore" });
}
