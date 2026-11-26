import { defineConfig } from 'vitest/config'

// Tester mot ekte PostgreSQL (samtidige transaksjoner, låser, deadlocks).
// Kjøres via `npm run test:pg`, som starter en midlertidig, isolert klynge.
export default defineConfig({
  test: {
    include: ['tests/pg/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
})
