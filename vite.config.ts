import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type Plugin } from 'vite';

const rootDir = dirname(fileURLToPath(import.meta.url));

const nodeBuiltins = builtinModules.flatMap((id) => [id, `node:${id}`]);
const external = ['obsidian', 'electron', ...nodeBuiltins, /^node:/];

function stylesBundlePlugin(): Plugin {
  return {
    name: 'dsh-git-graph:styles',
    generateBundle() {
      const stylesDir = resolve(rootDir, 'styles');
      if (!existsSync(stylesDir)) {
        return;
      }
      const source = readdirSync(stylesDir)
        .filter((name) => name.endsWith('.css'))
        .sort()
        .map((name) => readFileSync(join(stylesDir, name), 'utf8'))
        .join('\n');
      this.emitFile({ type: 'asset', fileName: 'styles.css', source });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [vue(), stylesBundlePlugin()],
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
  },
  build: {
    lib: {
      entry: resolve(rootDir, 'src/main.ts'),
      formats: ['cjs'],
      fileName: () => 'main.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: {
      external,
    },
  },
}));
