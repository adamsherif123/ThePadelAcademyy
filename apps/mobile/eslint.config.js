// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

/**
 * Guardrails enforced from commit #1. All are warnings for now — they exist to
 * shape S1+ work, not to block S0.
 *
 * 1. No inline hex color literals   -> colors must come from @tpa/theme (S2).
 * 2. No physical layout props       -> use start/end so a later Arabic/RTL pass is free.
 * 3. No raw <Text> from react-native -> a shared <Text> lands in S2.
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
        'warn',
        {
          selector:
            'Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]',
          message:
            'No inline hex colors. Colors come from @tpa/theme design tokens (S2).',
        },
        {
          selector: `Property[key.name=/^(${PHYSICAL_LAYOUT_PROPS.join('|')})$/]`,
          message:
            'No physical layout props (marginLeft/Right, paddingLeft/Right, left, right). Use the logical start/end equivalents (marginStart, paddingEnd, start, end) so RTL/Arabic works for free.',
        },
      ],
      'no-restricted-imports': [
        'warn',
        {
          paths: [
            {
              name: 'react-native',
              importNames: ['Text'],
              message:
                'Do not import raw <Text> from react-native. Use the shared <Text> component (arriving in S2).',
            },
          ],
        },
      ],
    },
  },
]);
