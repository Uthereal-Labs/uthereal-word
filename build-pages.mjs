/** Produce a Pages artifact without exposing repository or test files. */
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';

await import('./build.mjs');
const site = new URL('./_site/', import.meta.url);
await rm(site, { recursive: true, force: true });
await mkdir(site, { recursive: true });
const standalone = new URL('./Quire.html', import.meta.url);
await copyFile(standalone, new URL('index.html', site));
await copyFile(standalone, new URL('Quire.html', site));
await writeFile(new URL('.nojekyll', site), '');
console.log('Built _site/ — self-contained HTML; no absolute asset paths.');
