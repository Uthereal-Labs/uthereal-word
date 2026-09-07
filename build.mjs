/** Build a zero-dependency, double-clickable HTML file from the ES module source. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const base = new URL('.', import.meta.url);
let html = await readFile(new URL('index.html', base), 'utf8');
const css = await readFile(new URL('src/styles.css', base), 'utf8');
const modules = ['icons', 'core', 'renderer', 'templates', 'io', 'app'];
// Isolated module scopes avoid collisions while preserving named exports.
const exports = { icons: ['icons', 'icon'], core: ['uid', 'escapeHTML', 'debounce', 'textNodes', 'safeURL', 'sanitizeHTML', 'Emitter', 'newDocument', 'validateDocument', 'DocumentStore', 'DocumentRepository', 'bookmarkSelection', 'restoreBookmark', 'caretAt', 'Paginator', 'EditorEngine', 'DocumentSearch', 'StatisticsWorker'], renderer: ['PageRasterizer', 'GPUPageRenderer'], templates: ['clarityReport', 'projectBrief', 'meetingNotes', 'templates'], io: ['crc32', 'zipStore', 'readZip', 'downloadFile', 'exportDocx', 'importDocx', 'exportHTML', 'exportMarkdown', 'importMarkdown', 'importFile'], app: [] };
let js = '(async()=>{\nconst modules={};\n';
for (const name of modules) {
    let source = await readFile(new URL(`src/${name}.js`, base), 'utf8');
    source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/([^'"]+)\.js['"];?/g, (_, names, dependency) => `const {${names}}=modules.${dependency};`);
    source = source.replace(/\bexport\s+(?=(async\s+)?(const|let|var|function|class)\b)/g, '');
    js += `modules.${name}=await(async()=>{\n${source}\nreturn {${exports[name].join(',')}};\n})();\n`;
}
js += '})();';
html = html.replace('<link rel="stylesheet" href="./src/styles.css">', `<style>${css}</style>`).replace('<script type="module" src="./src/app.js"></script>', () => `<script>${js.replace(/<\/script/gi, '<\\/script')}</script>`);
await writeFile(new URL('Quire.html', base), html);
console.log(`Built Quire.html · ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB`);
