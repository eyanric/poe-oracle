import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Keep deps external; bundles only our src into a runnable ESM build.
  skipNodeModulesBundle: true,
})
