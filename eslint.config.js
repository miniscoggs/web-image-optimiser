import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import prettierConfig from "eslint-config-prettier/flat";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["dist/", "wasm/pkg/", "coverage/"] },
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        project: "./tsconfig.test.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["ui/**/*.{ts,tsx}", "tests/ui/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { project: "./ui/tsconfig.json" },
    },
    rules: {
      // the ui's tsconfig has node's types only for the server api's types
      "no-restricted-globals": ["error", "Buffer", "process", "require"],
    },
  },
  {
    files: ["ui/vite.config.ts"],
    rules: { "no-restricted-globals": "off" },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettierConfig
);
