import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, type Plugin } from 'vite';

export function interactiveViewerPlugin(): Plugin {
  const id = 'virtual:interactive-viewer', resolved = '\0' + id;
  let root = '';
  return {
    name: 'iboview-interactive-viewer',
    configResolved(config) { root = config.root; },
    resolveId(source) { if (source === id) return resolved; },
    async load(source) {
      if (source !== resolved) return;
      const result = await build({
        configFile: false, root, publicDir: false, logLevel: 'error',
        build: { write: false, target: 'es2022', minify: true,
          lib: { entry: resolve(root, 'src/standalone/viewer.ts'), name: 'IboViewStandalone', formats: ['iife'] } },
      });
      if ('on' in result) throw new Error('Unexpected viewer watch build.');
      const outputs = Array.isArray(result) ? result : [result];
      const chunks = outputs.flatMap(output => output.output);
      if (chunks.length !== 1 || chunks[0].type !== 'chunk') throw new Error('The interactive viewer must be a single script.');
      const font = await readFile(resolve(root, 'public/fonts/figtree-latin.woff2'));
      const license = await readFile(resolve(root, 'public/fonts/OFL-Figtree.txt'), 'utf8');
      for (const module of Object.keys(chunks[0].modules)) if (!module.startsWith('\0')) this.addWatchFile(module.split('?')[0]);
      return `export const runtime = ${JSON.stringify(chunks[0].code)};\nexport const fontDataURL = ${JSON.stringify('data:font/woff2;base64,' + font.toString('base64'))};\nexport const fontLicense = ${JSON.stringify(license)};`;
    },
    handleHotUpdate(context) {
      if (/\/src\/(standalone|render)\/|\/shader\/|\/lib\/(camera-state|interactive-scene)\.ts$/.test(context.file)) {
        const module = context.server.moduleGraph.getModuleById(resolved);
        if (module) { context.server.moduleGraph.invalidateModule(module); return [module]; }
      }
    },
  };
}
