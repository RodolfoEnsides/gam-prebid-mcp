import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['dist/**', 'node_modules/**'],
    coverage: { reporter: ['text', 'html'] },
    restoreMocks: true,
  },
});
