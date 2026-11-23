import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const output = new URL('../wwwroot/three/', import.meta.url);
await build({
  absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
  entryPoints: ['viewer.js'],
  outfile: fileURLToPath(new URL('viewer.js', output)),
  bundle: true,
  external: ['/signal-monitor.js'],
  format: 'esm',
  target: 'es2022',
  minify: true,
  banner: { js: '/*! Three.js · MIT License · see three.LICENSE.txt */' },
});
await copyFile(new URL('node_modules/three/LICENSE', import.meta.url), new URL('three.LICENSE.txt', output));
