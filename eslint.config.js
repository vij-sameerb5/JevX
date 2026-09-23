import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "regression/**", "tests/fixtures/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // the website's one script runs in the browser
    files: ["site/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { document: "readonly", window: "readonly", navigator: "readonly", getSelection: "readonly", matchMedia: "readonly", setTimeout: "readonly", clearTimeout: "readonly" }
    }
  }
);
