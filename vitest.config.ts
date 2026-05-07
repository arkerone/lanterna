import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/core', 'packages/detectors', 'packages/cli'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        '**/dist/**',
        '**/test/**',
        '**/*.test.ts',
        '**/*.d.ts',
        '**/index.ts',
        'packages/core/src/report/version.generated.ts',
      ],
      all: true,
    },
  },
});
