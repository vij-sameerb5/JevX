// `jevx mcp install` writes one "jevx" entry into every AI app it finds, keeps everything else,
// backs files up once, never overwrites broken JSON, never writes a key; uninstall removes it.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { installAll, uninstallAll, type InstallContext } from "../apps/jevx/src/install.js";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function fakeHome() {
  const h = mkdtempSync(path.join(tmpdir(), "jevx-home-"));
  dirs.push(h);
  const desktop = path.join(h, "Library", "Application Support", "Claude");
  mkdirSync(desktop, { recursive: true });
  writeFileSync(path.join(desktop, "claude_desktop_config.json"), JSON.stringify({ globalShortcut: "x", mcpServers: { other: { command: "other" } } }));
  mkdirSync(path.join(h, ".cursor"), { recursive: true }); // no mcp.json yet
  mkdirSync(path.join(h, "Library", "Application Support", "Code", "User"), { recursive: true });
  mkdirSync(path.join(h, ".codeium", "windsurf"), { recursive: true });
  writeFileSync(path.join(h, ".codeium", "windsurf", "mcp_config.json"), "{ broken json");
  mkdirSync(path.join(h, ".codex"), { recursive: true });
  writeFileSync(path.join(h, ".codex", "config.toml"), 'model = "o4"\n\n[mcp_servers.other]\ncommand = "other"\nargs = ["a"]\n');
  return h;
}

const ctx = (home: string, calls: string[][] = []): InstallContext => ({
  home,
  platform: "darwin",
  gui: { command: "/usr/local/bin/node", args: ["/opt/jevx/dist/index.js", "mcp"], env: { JEVX_ENV_FILE: "/Users/me/jevX/.env" } },
  cli: { command: "jevx", args: ["mcp"], env: { JEVX_ENV_FILE: "/Users/me/jevX/.env" } },
  claude: (a) => void calls.push(a)
});

describe("jevx mcp install", () => {
  it("adds JevX to every app found, keeps other servers and settings, backs up once", () => {
    const h = fakeHome();
    const calls: string[][] = [];
    const r = installAll(ctx(h, calls));
    const by = Object.fromEntries(r.map((x) => [x.app, x.status]));
    expect(by).toMatchObject({ "Claude Code": "added", "Claude Desktop": "added", Cursor: "added", "VS Code (Copilot)": "added", "Codex CLI": "added", Windsurf: "skipped", "Gemini CLI": "not-found" });

    expect(calls.at(-1)).toEqual(["mcp", "add", "--scope", "user", "-e", "JEVX_ENV_FILE=/Users/me/jevX/.env", "jevx", "--", "jevx", "mcp"]);
    const desk = JSON.parse(readFileSync(path.join(h, "Library/Application Support/Claude/claude_desktop_config.json"), "utf8"));
    expect(desk.globalShortcut).toBe("x");
    expect(desk.mcpServers.other).toEqual({ command: "other" });
    expect(desk.mcpServers.jevx).toEqual({ command: "/usr/local/bin/node", args: ["/opt/jevx/dist/index.js", "mcp"], env: { JEVX_ENV_FILE: "/Users/me/jevX/.env" } });
    expect(existsSync(path.join(h, "Library/Application Support/Claude/claude_desktop_config.json.jevx-backup"))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(h, ".cursor/mcp.json"), "utf8")).mcpServers.jevx.command).toBe("/usr/local/bin/node");
    expect(JSON.parse(readFileSync(path.join(h, "Library/Application Support/Code/User/mcp.json"), "utf8")).servers.jevx).toMatchObject({ type: "stdio", command: "/usr/local/bin/node" });
    expect(readFileSync(path.join(h, ".codeium/windsurf/mcp_config.json"), "utf8")).toBe("{ broken json"); // never overwritten
    const toml = readFileSync(path.join(h, ".codex/config.toml"), "utf8");
    expect(toml).toMatch(/\[mcp_servers\.other\]\ncommand = "other"\nargs = \["a"\]/);
    expect(toml).toMatch(/\[mcp_servers\.jevx\]\ncommand = "jevx"\nargs = \["mcp"\]\nenv = \{ JEVX_ENV_FILE = "\/Users\/me\/jevX\/\.env" \}/);

    // running it again changes nothing
    const again = installAll(ctx(h));
    expect(again.filter((x) => x.app !== "Claude Code" && x.status === "added")).toEqual([]);
    expect(readFileSync(path.join(h, ".codex/config.toml"), "utf8").match(/\[mcp_servers\.jevx\]/g)).toHaveLength(1);
  });

  it("uninstall removes only the jevx entries", () => {
    const h = fakeHome();
    installAll(ctx(h));
    const r = uninstallAll(ctx(h));
    expect(r.filter((x) => x.status === "removed").map((x) => x.app).sort()).toEqual(["Claude Code", "Claude Desktop", "Codex CLI", "Cursor", "VS Code (Copilot)"]);
    const desk = JSON.parse(readFileSync(path.join(h, "Library/Application Support/Claude/claude_desktop_config.json"), "utf8"));
    expect(desk.mcpServers).toEqual({ other: { command: "other" } });
    const toml = readFileSync(path.join(h, ".codex/config.toml"), "utf8");
    expect(toml).not.toMatch(/jevx/);
    expect(toml).toMatch(/\[mcp_servers\.other\]/);
  });

  it("never writes a key, only the key file's path", () => {
    const h = fakeHome();
    const c = ctx(h);
    c.gui.env = { JEVX_ENV_FILE: "/k/.env" };
    installAll(c);
    for (const f of ["Library/Application Support/Claude/claude_desktop_config.json", ".cursor/mcp.json", ".codex/config.toml"]) expect(readFileSync(path.join(h, f), "utf8")).not.toMatch(/API_KEY/);
  });
});
