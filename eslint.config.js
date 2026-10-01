import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "build/**", "regression/**", "tests/fixtures/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // plain-JS build scripts run in Node
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly", setTimeout: "readonly", Buffer: "readonly" } }
  },
  {
    // the Chrome extension (MV3, ES modules, no build step)
    files: ["apps/jevx-extension/**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: { chrome: "readonly", document: "readonly", window: "readonly", navigator: "readonly", location: "readonly", fetch: "readonly", URL: "readonly", URLSearchParams: "readonly", setTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly" }
    }
  },
  {
    // the website's one script runs in the browser
    files: ["site/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { document: "readonly", window: "readonly", navigator: "readonly", getSelection: "readonly", matchMedia: "readonly", setTimeout: "readonly", clearTimeout: "readonly", history: "readonly", location: "readonly", getComputedStyle: "readonly", IntersectionObserver: "readonly" }
    }
  }
);
