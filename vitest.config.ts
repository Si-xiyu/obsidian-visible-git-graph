import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

/**
 * Test-only config. The local test vault is a git worktree that contains a
 * copy of `tests/`; excluding it keeps `npm test` from running every suite
 * twice while that worktree exists.
 */
export default defineConfig({
  resolve: {
    alias: { obsidian: fileURLToPath(new URL('./tests/ui/obsidianStub.ts', import.meta.url)) },
  },
  plugins: [vue()],
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/.test-vault/**', '**/.worktrees/**'],
  },
});
