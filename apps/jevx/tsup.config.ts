import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", mcp: "src/mcp.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  // Workspace packages ship as TS source, so bundle them into the server.
  noExternal: [/^@jevx\//],
  banner: { js: "#!/usr/bin/env node" }
});
