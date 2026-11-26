import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

// Standard testkjøring (npm test): enhetstester, komponenttester og PGlite-databasetester.
// Tester som krever ekte PostgreSQL ligger i tests/pg og kjøres med `npm run test:pg`.
export default mergeConfig(viteConfig, defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'tests/pg/**'],
  },
}))
