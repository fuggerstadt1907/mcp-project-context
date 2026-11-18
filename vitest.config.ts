import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Ticket 09: the security-relevant modules stay at 85 % or more. CI runs pnpm test:coverage.
      thresholds: {
        'src/fs/**': { statements: 85, branches: 85, functions: 85, lines: 85 },
        'src/redact.ts': { statements: 85, branches: 85, functions: 85, lines: 85 },
        'src/tools/**': { statements: 85, branches: 85, functions: 85, lines: 85 },
      },
    },
  },
});
