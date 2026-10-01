// The version the CLI and MCP server report must match the npm package.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VERSION } from "../apps/jevx/src/server.js";

describe("version", () => {
  it("VERSION matches apps/jevx/package.json", () => {
    expect(VERSION).toBe(JSON.parse(readFileSync("apps/jevx/package.json", "utf8")).version);
  });
});
