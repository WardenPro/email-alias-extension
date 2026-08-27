import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { buildManifest, resolveTarget } from './manifest.config';

const target = resolveTarget(process.env.EXT_TARGET);

export default defineConfig({
  publicDir: 'public',
  plugins: [
    {
      name: 'emit-extension-manifest',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'manifest.json',
          source: `${JSON.stringify(buildManifest(target), null, 2)}\n`
        });
      }
    }
  ],
  build: {
    outDir: `dist/${target}`,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        popup: resolve(__dirname, 'popup.html'),
        options: resolve(__dirname, 'options.html')
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]'
      }
    }
  }
});
