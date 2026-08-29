// eslint-config-next v16 ships native flat configs; the legacy FlatCompat
// bridge crashes under ESLint 9 (circular plugin structure), so import the
// flat presets directly.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // scripts/ holds one-off node generators (CommonJS), not app code.
    ignores: [".next/**", "node_modules/**", "public/**", "scripts/**"],
  },
];

export default eslintConfig;
