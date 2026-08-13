import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  eslint.configs.recommended,
  ...nextVitals,
  ...nextTypeScript,
  ...tseslint.configs.recommended,
  {
    files: ["src/server/**/*.ts", "src/worker/**/*.ts", "src/contracts/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
  globalIgnores([".next/**", "dist/**", "node_modules/**", "src/contracts/dist/**"]),
);
