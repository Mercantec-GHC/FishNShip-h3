import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const output = new URL('../wwwroot/vendor/arduino-editor.js', import.meta.url);
const { metafile } = await build({
  absWorkingDir: fileURLToPath(new URL('./', import.meta.url)),
  entryPoints: ['editor.mjs'],
  outfile: fileURLToPath(output),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  metafile: true,
  banner: { js: '/*! Generated from web/editor/editor.mjs. Licenses: arduino-editor.LICENSES.txt */' },
});

const packages = new Set();
for (const input of Object.keys(metafile.inputs)) {
  const match = /^node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input);
  if (match) packages.add(match[1]);
}

const notices = [];
for (const name of [...packages].sort()) {
  const folder = new URL(`./node_modules/${name}/`, import.meta.url);
  const license = (await readdir(folder)).find(file => /^(license|licence)(\..+)?$/i.test(file));
  if (!license) throw new Error(`License file missing for ${name}`);
  const text = await readFile(new URL(license, folder), 'utf8');
  notices.push(`${name}\n${text.trim()}`);
}
await writeFile(new URL('arduino-editor.LICENSES.txt', output), `${notices.join('\n\n-----\n\n')}\n`);
