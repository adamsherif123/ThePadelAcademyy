import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Design-system guardrail (ERROR): no inline colour literals in TS/TSX.
      // Colours come from the generated CSS custom properties (var(--color-*),
      // var(--tint-*)) in the CSS Modules — never a hex/rgb literal in a component.
      // (The mobile's other three bans are RN-specific — fontWeight is a
      // Hermes/Android glyph issue and raw <Text> doesn't exist on web — so they're
      // intentionally not carried over. Physical vs logical CSS properties live in
      // .css, which eslint doesn't parse; we use logical properties by convention
      // rather than add stylelint for a small English-forever staff tool.)
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]',
          message: 'No inline hex colours. Use the generated CSS custom properties (var(--color-*)).',
        },
        {
          selector: 'Literal[value=/(?:rgb|rgba|hsl|hsla)\\(/]',
          message: 'No inline rgb/hsl colours. Use the generated CSS custom properties (var(--color-*)).',
        },
      ],
    },
  },
);
