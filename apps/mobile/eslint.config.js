// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

/**
 * Design-system guardrails, ERRORS as of S2 (were warnings through S1):
 *
 * 1. No inline hex/rgb color literals  -> colors come from @tpa/theme tokens.
 * 2. No physical layout props          -> logical start/end only (RTL-safety).
 * 3. No raw <Text> from react-native   -> use the shared <Text> (src/ui/Text).
 * 4. No `fontWeight`                    -> the shared <Text> resolves weight to a
 *    baked Inter family; pairing fontFamily + fontWeight clips glyphs on Android,
 *    so the prop is banned outright (structural, not a convention to remember).
 *
 * The single sanctioned exception is src/ui/Text.tsx, which carries an inline
 * disable for the one legitimate react-native Text import.
 */
const PHYSICAL_LAYOUT_PROPS = [
  'marginLeft',
  'marginRight',
  'paddingLeft',
  'paddingRight',
  'left',
  'right',
];

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'node_modules/*', '.expo/*', 'expo-env.d.ts'],
  },
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]',
          message: 'No inline hex colors. Colors come from @tpa/theme design tokens.',
        },
        {
          selector: `Property[key.name=/^(${PHYSICAL_LAYOUT_PROPS.join('|')})$/]`,
          message:
            'No physical layout props (marginLeft/Right, paddingLeft/Right, left, right). Use the logical start/end equivalents (marginStart, paddingEnd, start, end) so RTL/Arabic works for free.',
        },
        {
          selector: "Property[key.name='fontWeight']",
          message:
            'No fontWeight. The shared <Text> maps a weight to a baked Inter family (e.g. Inter_700Bold); pairing fontFamily + fontWeight clips glyphs on Android.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: ['Text'],
              message:
                'Do not import raw <Text> from react-native. Use the shared <Text> from src/ui/Text.',
            },
            {
              name: '@tpa/theme',
              importNames: ['trainingTint'],
              message:
                'trainingTint is ADMIN-ONLY. In the client app colour communicates credit EXPIRY only — a CreditPill carries type + expiry and a second hue competes (individual amber collided with expiring_soon). Show training type with a labelled pill + icon instead.',
            },
          ],
        },
      ],
    },
  },
]);
