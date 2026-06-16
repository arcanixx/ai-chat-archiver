import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.json';

export default defineConfig({
  plugins: [
    crx({ manifest }),
  ],
  publicDir: 'public',
  build: {
    outDir: 'ai-chat-archiver-extension',
    emptyOutDir: true,
  },
});
