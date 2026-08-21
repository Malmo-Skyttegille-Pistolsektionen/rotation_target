import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactX from '@eslint-react/eslint-plugin';
import tseslint from 'typescript-eslint';
import reactCompiler from 'eslint-plugin-react-compiler';
import eslintConfigPrettier from 'eslint-config-prettier';

// The complement of @eslint-react's own `disable-conflict-eslint-plugin-react-hooks`
// preset: it lists the overlapping pairs, so derive the off-switches from it rather
// than hand-maintaining a copy that drifts on the next plugin bump.
const hooksRulesOwnedByReactHooks = Object.fromEntries(
  Object.keys(reactX.configs['disable-conflict-eslint-plugin-react-hooks'].rules).map((name) => [
    name.replace('react-hooks/', '@eslint-react/'),
    'off',
  ]),
);

export default tseslint.config(
  { ignores: ['dist', 'src/api/generated.d.ts', 'playwright-report', 'test-results'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      ...reactX.configs.recommended.plugins,
      'react-compiler': reactCompiler,
    },
    settings: reactX.configs.recommended.settings,
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...reactX.configs.recommended.rules,
      // @eslint-react re-implements a dozen rules that eslint-plugin-react-hooks
      // already ships; the React team's own plugin stays the authority for them.
      ...hooksRulesOwnedByReactHooks,
      // Not in @eslint-react's recommended preset, but eslint-plugin-react's was
      // enforcing the equivalents before the ESLint 10 swap - keep the coverage.
      '@eslint-react/dom-no-unsafe-target-blank': 'error',
      '@eslint-react/dom-no-unknown-property': 'error',
      '@eslint-react/no-missing-component-display-name': 'error',
      // Series and events are addressed by index everywhere else in the app and
      // in the run state, so the index is their identity, not an accident of order.
      '@eslint-react/no-array-index-key': 'off',
      'react-compiler/react-compiler': 'error',
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },
  {
    // The E2E suite runs in Node against a real device, not in the browser,
    // and its `console.log` of the observed SSE samples is deliberate output.
    files: ['e2e/**/*.ts', 'playwright.config.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  eslintConfigPrettier,
);
