import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "build/**", "regression/**", "tests/fixtures/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // plain-JS build scripts run in Node
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } }
  },
  {
    // the website's one script runs in the browser
    files: ["site/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { document: "readonly", window: "readonly", navigator: "readonly", getSelection: "readonly", matchMedia: "readonly", setTimeout: "readonly", clearTimeout: "readonly" }
    }
  }
);
