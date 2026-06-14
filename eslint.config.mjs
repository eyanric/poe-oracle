import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Layered architecture — dependencies point DOWNWARD only: tools → services → data.
  // The service layer must not reach up into tools.
  {
    files: ['src/services/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ group: ['**/tools', '**/tools/*'], message: 'services/ must not import from tools/ (deps point downward: tools → services → data).' }],
      }],
    },
  },
  // The data layer is the bottom — it must not reach up into services or tools.
  {
    files: ['src/data/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ group: ['**/services', '**/services/*', '**/tools', '**/tools/*'], message: 'data/ must not import from services/ or tools/ (data is the bottom layer).' }],
      }],
    },
  },
)
