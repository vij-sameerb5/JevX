import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.tsx", config: "src/config.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  // Workspace packages ship as TS source, so bundle them into the CLI.
  noExternal: [/^@jevx\//],
  banner: ({ format }) => (format === "esm" ? { js: "" } : {})
});
