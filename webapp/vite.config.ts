import { defineConfig } from 'vite';
import { interactiveViewerPlugin } from './build/interactive-viewer-plugin.ts';

export default defineConfig({
  base: './',
  plugins: [interactiveViewerPlugin()],
  server: { strictPort: true },
});
