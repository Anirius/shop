// Builds one self-contained HTML file from shop/box.html (Unboxing page): CSS, JS bundle, the 3D knife,
// studio lighting and the marble photo are embedded, so the file opens by double-click.
// Usage: npm run build:box && node tools/standalone-box.mjs [out-file]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (p) => readFile(join(root, p));
const dataUri = async (p, type) => `data:${type};base64,${(await read(p)).toString('base64')}`;

const html = (await read('shop/box.html')).toString();
const css = (await read('shop/box.css')).toString();
const js = (await read('shop/box.js')).toString().replace(/<\/script/gi, '<\\/script');
const glb = await dataUri('assets/anirius-knife.glb', 'model/gltf-binary');
const hdr = await dataUri('assets/anirius-studio.hdr', 'application/octet-stream');
const marble = await dataUri('shop/img/box-marble.jpg', 'image/jpeg');

const out = html
  .replace('<link rel="stylesheet" href="box.css">', () => `<style>\n${css}\n</style>`)
  .replace('<script src="box.js"></script>', () => `<script>\n${js}\n</script>`)
  .replaceAll('data-model="../assets/anirius-knife.glb"', () => `data-model="${glb}"`)
  .replaceAll('data-hdr="../assets/anirius-studio.hdr"', () => `data-hdr="${hdr}"`)
  // The 2k lighting would add ~8 MB; the standard one is used everywhere instead.
  .replaceAll(/\s*data-hdr-hd="[^"]*"/g, '')
  .replace('data-marble="img/box-marble.jpg"', () => `data-marble="${marble}"`);

if (/\.\.\/assets\/|img\/box-marble|href="box\.css"|src="box\.js"/.test(out)) throw new Error('unresolved asset path');
const file = process.argv[2] || join(root, 'standalone', 'anirius-unboxing.html');
await mkdir(dirname(file), { recursive: true });
await writeFile(file, out);
console.log(file, (out.length / 1e6).toFixed(1) + ' MB');
