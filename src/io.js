/** Native, dependency-free IO. ZIP STORE writer, bounded ZIP/DEFLATE reader, OOXML subset. */
import { uid, escapeHTML, safeURL, sanitizeHTML, newDocument, validateDocument } from './core.js';
const encoder = new TextEncoder(), decoder = new TextDecoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++)
    n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
export function crc32(bytes) { let c = 0xffffffff; for (const b of bytes)
    c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function zipStore(files) {
    const parts = [], central = [];
    let offset = 0;
    for (const [name, value] of Object.entries(files)) {
        const filename = encoder.encode(name), data = typeof value === 'string' ? encoder.encode(value) : value, crc = crc32(data);
        const local = new Uint8Array(30 + filename.length), lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, 0x800, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, data.length, true);
        lv.setUint32(22, data.length, true);
        lv.setUint16(26, filename.length, true);
        local.set(filename, 30);
        parts.push(local, data);
        const header = new Uint8Array(46 + filename.length), cv = new DataView(header.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x800, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, filename.length, true);
        cv.setUint32(42, offset, true);
        header.set(filename, 46);
        central.push(header);
        offset += local.length + data.length;
    }
    const centralSize = central.reduce((n, b) => n + b.length, 0), end = new Uint8Array(22), v = new DataView(end.buffer);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, central.length, true);
    v.setUint16(10, central.length, true);
    v.setUint32(12, centralSize, true);
    v.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
export async function readZip(buffer) {
    const bytes = new Uint8Array(buffer), v = new DataView(buffer), files = new Map();
    if (bytes.length < 22)
        throw new Error('Invalid ZIP container.');
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
        if (v.getUint32(i, true) === 0x06054b50) {
            end = i;
            break;
        }
    if (end < 0)
        throw new Error('ZIP directory was not found.');
    const count = v.getUint16(end + 10, true);
    if (count > 10000)
        throw new Error('Too many ZIP entries.');
    let at = v.getUint32(end + 16, true), total = 0;
    for (let i = 0; i < count; i++) {
        if (at + 46 > bytes.length || v.getUint32(at, true) !== 0x02014b50)
            throw new Error('Invalid ZIP directory entry.');
        const flags = v.getUint16(at + 8, true), method = v.getUint16(at + 10, true), crc = v.getUint32(at + 16, true), compressed = v.getUint32(at + 20, true), size = v.getUint32(at + 24, true), nameLen = v.getUint16(at + 28, true), extraLen = v.getUint16(at + 30, true), commentLen = v.getUint16(at + 32, true), local = v.getUint32(at + 42, true);
        total += size;
        if (flags & 1)
            throw new Error('Encrypted documents are not supported.');
        if (size > 30 * 1024 * 1024 || total > 60 * 1024 * 1024)
            throw new Error('Uncompressed document exceeds the 60 MB safety limit.');
        const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen));
        if (name.includes('..') || name.startsWith('/'))
            throw new Error('Unsafe ZIP entry path.');
        if (local + 30 > bytes.length || v.getUint32(local, true) !== 0x04034b50)
            throw new Error('Invalid ZIP local header.');
        const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
        if (start + compressed > bytes.length)
            throw new Error('Truncated ZIP entry.');
        const raw = bytes.subarray(start, start + compressed);
        let data;
        if (method === 0)
            data = raw;
        else if (method === 8) {
            if (!globalThis.DecompressionStream)
                throw new Error('This browser does not support DOCX decompression.');
            let stream;
            try {
                stream = new DecompressionStream('deflate-raw');
            }
            catch {
                throw new Error('DOCX import needs a browser with raw DEFLATE support.');
            }
            const reader = new Blob([raw]).stream().pipeThrough(stream).getReader();
            const chunks = [];
            let actual = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                actual += value.length;
                if (actual > size || actual > 30 * 1024 * 1024) {
                    await reader.cancel();
                    throw new Error('ZIP decompression safety limit exceeded.');
                }
                chunks.push(value);
            }
            data = new Uint8Array(actual);
            let off = 0;
            for (const chunk of chunks) {
                data.set(chunk, off);
                off += chunk.length;
            }
        }
        else
            throw new Error(`Unsupported ZIP compression method ${method}.`);
        if (data.length !== size || crc32(data) !== crc)
            throw new Error('ZIP integrity check failed.');
        files.set(name, data);
        at += 46 + nameLen + extraLen + commentLen;
    }
    return files;
}
export function downloadFile(data, name, type = 'application/octet-stream') { const blob = data instanceof Blob ? data : new Blob([data], { type }); const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_'); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const xml = escapeHTML;
const base64ToBytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
function bytesToBase64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); }
const rgbHex = s => { if (!s || s === 'transparent' || s === 'rgba(0, 0, 0, 0)')
    return null; const m = s.match(/\d+/g); if (s.startsWith('#'))
    return s.slice(1).padEnd(6, '0'); if (m?.length >= 3)
    return m.slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join(''); return null; };
export function exportDocx(doc, root) {
    const files = {}, relationships = [{ id: 'rStyles', type: 'styles', target: 'styles.xml' }, { id: 'rNumbering', type: 'numbering', target: 'numbering.xml' }];
    let imageId = 0, changeId = 0;
    const imageTypes = new Set();
    const commentIds = new Map(doc.comments.map((c, i) => [c.id, i]));
    function styleOf(el, inherited = {}) { const s = el.nodeType === 1 ? getComputedStyle(el) : null; return s ? { bold: Number(s.fontWeight) >= 600, italic: s.fontStyle === 'italic', underline: s.textDecorationLine.includes('underline') || inherited.underline, strike: s.textDecorationLine.includes('line-through') || inherited.strike, color: rgbHex(s.color) || inherited.color, size: Math.round(parseFloat(s.fontSize) * 1.5) || 22, font: s.fontFamily.split(',')[0].replaceAll('"', ''), bg: rgbHex(s.backgroundColor) || inherited.bg, vertical: ['sub', 'super'].includes(s.verticalAlign) ? s.verticalAlign : inherited.vertical } : inherited; }
    function rPr(s) { return `<w:rPr>${s.font ? `<w:rFonts w:ascii="${xml(s.font)}" w:hAnsi="${xml(s.font)}" w:eastAsia="${xml(s.font)}"/>` : ''}${s.bold ? '<w:b/>' : ''}${s.italic ? '<w:i/>' : ''}${s.underline ? '<w:u w:val="single"/>' : ''}${s.strike ? '<w:strike/>' : ''}${s.color ? `<w:color w:val="${s.color}"/>` : ''}${s.size ? `<w:sz w:val="${s.size}"/><w:szCs w:val="${s.size}"/>` : ''}${s.bg ? `<w:shd w:val="clear" w:fill="${s.bg}"/>` : ''}${s.vertical ? `<w:vertAlign w:val="${s.vertical === 'sub' ? 'subscript' : 'superscript'}"/>` : ''}</w:rPr>`; }
    function image(el) { const match = el.src.match(/^data:image\/(png|jpeg|gif|webp);base64,(.*)$/s); if (!match)
        return ''; const id = ++imageId, ext = match[1] === 'jpeg' ? 'jpg' : match[1], name = `image${id}.${ext}`; imageTypes.add(ext); files[`word/media/${name}`] = base64ToBytes(match[2]); relationships.push({ id: `rImage${id}`, type: 'image', target: `media/${name}` }); const w = Math.round((el.width || el.naturalWidth || 300) * 9525), h = Math.round((el.height || el.naturalHeight || 200) * 9525); return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${w}" cy="${h}"/><wp:docPr id="${id}" name="${xml(el.alt || name)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rImage${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`; }
    function runs(node, inherited = {}, deleted = false) {
        if (node.nodeType === 3) {
            const text = node.textContent.replaceAll('\u200b', '');
            return text ? `<w:r>${rPr(inherited)}<w:${deleted ? 'delText' : 't'} xml:space="preserve">${xml(text)}</w:${deleted ? 'delText' : 't'}></w:r>` : '';
        }
        if (node.nodeType !== 1)
            return '';
        const s = styleOf(node, inherited), tag = node.tagName;
        if (tag === 'BR')
            return '<w:r><w:br/></w:r>';
        if (tag === 'IMG')
            return image(node);
        let inner = [...node.childNodes].map(n => runs(n, s, deleted || tag === 'DEL')).join('');
        if (tag === 'A' && safeURL(node.getAttribute('href'))) {
            const id = `rLink${relationships.length}`;
            relationships.push({ id, type: 'hyperlink', target: node.getAttribute('href'), external: true });
            inner = `<w:hyperlink r:id="${id}">${inner}</w:hyperlink>`;
        }
        if ((tag === 'INS' || tag === 'DEL') && node.dataset.change)
            inner = `<w:${tag.toLowerCase()} w:id="${changeId++}" w:author="You" w:date="${new Date().toISOString()}">${inner}</w:${tag.toLowerCase()}>`;
        if (node.dataset.comment && commentIds.has(node.dataset.comment)) {
            const id = commentIds.get(node.dataset.comment);
            inner = `<w:commentRangeStart w:id="${id}"/>${inner}<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`;
        }
        return inner;
    }
    function paragraph(el, { numId = null, level = 0 } = {}) { const s = getComputedStyle(el), tag = el.tagName; let style = tag === 'H1' ? (el.classList.contains('cover-title') ? 'Title' : 'Heading1') : tag === 'H2' ? 'Heading2' : tag === 'H3' ? 'Heading3' : tag === 'BLOCKQUOTE' ? 'Quote' : 'Normal'; const align = { left: 'left', start: 'left', center: 'center', right: 'right', end: 'right', justify: 'both' }[s.textAlign] || 'left'; const before = Math.max(0, Math.round((parseFloat(s.marginTop) || 0) * 15)), after = Math.max(0, Math.round((parseFloat(s.marginBottom) || 0) * 15)), line = Math.round((parseFloat(s.lineHeight) || 22) / (parseFloat(s.fontSize) || 14) * 240); return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${numId ? `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>` : ''}<w:spacing w:before="${before}" w:after="${after}" w:line="${line}" w:lineRule="auto"/><w:jc w:val="${align}"/>${parseFloat(s.marginLeft) ? `<w:ind w:left="${Math.round(parseFloat(s.marginLeft) * 15)}"/>` : ''}</w:pPr>${[...el.childNodes].map(n => runs(n, styleOf(el))).join('')}</w:p>`; }
    function table(el) { const rows = [...el.rows], cols = Math.max(1, ...rows.map(r => r.cells.length)), total = Math.round((doc.layout.width - doc.layout.left - doc.layout.right) * 15), cw = Math.floor(total / cols); return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(x => `<w:${x} w:val="single" w:sz="4" w:color="D6E1E6"/>`).join('')}</w:tblBorders><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${Array(cols).fill(`<w:gridCol w:w="${cw}"/>`).join('')}</w:tblGrid>${rows.map(row => `<w:tr>${row.cells[0]?.tagName === 'TH' ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${[...row.cells].map(cell => `<w:tc><w:tcPr><w:tcW w:w="${cw}" w:type="dxa"/>${cell.colSpan > 1 ? `<w:gridSpan w:val="${cell.colSpan}"/>` : ''}${cell.tagName === 'TH' ? '<w:shd w:fill="EFF4F5"/>' : ''}</w:tcPr>${cell.querySelector(':scope > p,:scope > div,:scope > table') ? [...cell.children].map(n => block(n)).join('') : paragraph(cell)}<w:p/></w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`; }
    function block(el, level = 0) { if (el.nodeType === 3)
        return el.textContent.trim() ? `<w:p><w:r><w:t xml:space="preserve">${xml(el.textContent)}</w:t></w:r></w:p>` : ''; if (el.nodeType !== 1)
        return ''; if (el.classList.contains('page-break'))
        return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'; if (el.tagName === 'TABLE')
        return table(el); if (['UL', 'OL'].includes(el.tagName))
        return [...el.children].map(li => { const clone = li.cloneNode(true); clone.querySelectorAll('ul,ol').forEach(n => n.remove()); return paragraph(li, { numId: el.tagName === 'OL' ? 2 : 1, level: Math.min(level, 8) }); }).join(''); if (el.tagName === 'HR')
        return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:color="CEDCE0"/></w:pBdr></w:pPr></w:p>'; if (el.tagName === 'DIV' && el.querySelector(':scope > div,:scope > p,:scope > h1,:scope > h2,:scope > h3'))
        return [...el.childNodes].map(n => block(n, level)).join(''); return paragraph(el); }
    const paragraphs = [...root.querySelectorAll('.page-content')].flatMap(p => [...p.childNodes]).map(el => block(el)).join('');
    const l = doc.layout;
    files['word/document.xml'] = XML + `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${paragraphs}<w:sectPr>${l.header ? '<w:headerReference w:type="default" r:id="rHeader"/>' : ''}${l.footer ? '<w:footerReference w:type="default" r:id="rFooter"/>' : ''}<w:pgSz w:w="${Math.round(l.width * 15)}" w:h="${Math.round(l.height * 15)}"${l.orientation === 'landscape' ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${Math.round(l.top * 15)}" w:right="${Math.round(l.right * 15)}" w:bottom="${Math.round(l.bottom * 15)}" w:left="${Math.round(l.left * 15)}" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    files['word/styles.xml'] = XML + `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>${[['Normal', 'Normal', 22, '3D4D5C'], ['Title', 'Title', 64, '263F52'], ['Heading1', 'heading 1', 40, '254964'], ['Heading2', 'heading 2', 30, '254964'], ['Heading3', 'heading 3', 26, '306B74'], ['Quote', 'Quote', 26, '45666B']].map(([id, name, size, color], i) => `<w:style w:type="paragraph" w:styleId="${id}"${i === 0 ? ' w:default="1"' : ''}><w:name w:val="${name}"/>${i ? '<w:basedOn w:val="Normal"/>' : ''}<w:pPr>${id.startsWith('Heading') ? `<w:keepNext/><w:outlineLvl w:val="${Number(id.slice(-1)) - 1}"/>` : ''}</w:pPr><w:rPr><w:color w:val="${color}"/><w:sz w:val="${size}"/>${id === 'Quote' ? '<w:i/>' : ''}</w:rPr></w:style>`).join('')}</w:styles>`;
    files['word/numbering.xml'] = XML + `<w:numbering xmlns:w="${W}">${[[0, 'bullet', '•'], [1, 'decimal', '%1.']].map(([id, fmt, text]) => `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="multilevel"/>${Array.from({ length: 9 }, (_, level) => `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${fmt === 'decimal' ? `%${level + 1}.` : text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + level * 360}" w:hanging="360"/></w:pPr></w:lvl>`).join('')}</w:abstractNum>`).join('')}<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
    const overrides = [['/word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'], ['/word/styles.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'], ['/word/numbering.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml'], ['/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml']];
    if (doc.comments.length) {
        relationships.push({ id: 'rComments', type: 'comments', target: 'comments.xml' });
        overrides.push(['/word/comments.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml']);
        files['word/comments.xml'] = XML + `<w:comments xmlns:w="${W}">${doc.comments.map((c, i) => `<w:comment w:id="${i}" w:author="${xml(c.author || 'You')}" w:date="${xml(c.time)}"><w:p><w:r><w:t xml:space="preserve">${xml(c.text)}</w:t></w:r></w:p></w:comment>`).join('')}</w:comments>`;
    }
    if (l.header) {
        relationships.push({ id: 'rHeader', type: 'header', target: 'header1.xml' });
        overrides.push(['/word/header1.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml']);
        files['word/header1.xml'] = XML + `<w:hdr xmlns:w="${W}"><w:p><w:r><w:rPr><w:color w:val="8A9BA5"/><w:sz w:val="18"/></w:rPr><w:t>${xml(l.header)}</w:t></w:r></w:p></w:hdr>`;
    }
    if (l.footer) {
        relationships.push({ id: 'rFooter', type: 'footer', target: 'footer1.xml' });
        overrides.push(['/word/footer1.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml']);
        files['word/footer1.xml'] = XML + `<w:ftr xmlns:w="${W}"><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:color w:val="9AA6AE"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${xml(doc.title)}   ·   </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`;
    }
    files['[Content_Types].xml'] = XML + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...imageTypes].map(ext => `<Default Extension="${ext}" ContentType="image/${ext === 'jpg' ? 'jpeg' : ext}"/>`).join('')}${overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join('')}</Types>`;
    files['_rels/.rels'] = XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rDocument" Type="${R}/officeDocument" Target="word/document.xml"/><Relationship Id="rCore" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
    files['word/_rels/document.xml.rels'] = XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.map(r => `<Relationship Id="${r.id}" Type="${R}/${r.type}" Target="${xml(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;
    files['docProps/core.xml'] = XML + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(doc.title)}</dc:title><dc:creator>Document</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${xml(doc.createdAt)}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified></cp:coreProperties>`;
    return new Blob([zipStore(files)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
function parseXML(bytes) { if (!bytes)
    return null; const d = new DOMParser().parseFromString(decoder.decode(bytes), 'application/xml'); if (d.querySelector('parsererror'))
    throw new Error('A document XML part is malformed.'); return d; }
const first = (el, name) => el?.getElementsByTagNameNS(W, name)[0], val = el => el?.getAttributeNS(W, 'val') ?? '', attr = (el, name) => el?.getAttributeNS(W, name) ?? '';
export async function importDocx(buffer, name) {
    const files = await readZip(buffer), documentXML = parseXML(files.get('word/document.xml'));
    if (!documentXML)
        throw new Error('No Word document part was found.');
    const rels = new Map();
    const relXML = parseXML(files.get('word/_rels/document.xml.rels'));
    for (const r of relXML?.documentElement.children || [])
        rels.set(r.getAttribute('Id'), { target: r.getAttribute('Target'), type: r.getAttribute('Type'), external: r.getAttribute('TargetMode') === 'External' });
    const styles = new Map(), stylesXML = parseXML(files.get('word/styles.xml'));
    for (const s of stylesXML?.documentElement.children || [])
        if (s.localName === 'style')
            styles.set(attr(s, 'styleId'), s);
    const numberingXML = parseXML(files.get('word/numbering.xml')), numbers = new Map(), abstract = new Map();
    for (const n of numberingXML?.documentElement.children || []) {
        if (n.localName === 'abstractNum')
            abstract.set(attr(n, 'abstractNumId'), val(first(n, 'numFmt')));
        if (n.localName === 'num')
            numbers.set(attr(n, 'numId'), val(first(n, 'abstractNumId')));
    }
    const styleCSS = (rPr) => { if (!rPr)
        return ''; const out = []; const has = name => { const n = first(rPr, name); return n && !['0', 'false', 'off', 'none'].includes(val(n)); }; if (has('b'))
        out.push('font-weight:700'); if (has('i'))
        out.push('font-style:italic'); if (has('u'))
        out.push('text-decoration:underline'); if (has('strike'))
        out.push('text-decoration:line-through'); const size = Number(val(first(rPr, 'sz'))); if (size)
        out.push(`font-size:${size / 2}pt`); const color = val(first(rPr, 'color')); if (/^[\da-f]{6}$/i.test(color))
        out.push(`color:#${color}`); const bg = attr(first(rPr, 'shd'), 'fill'); if (/^[\da-f]{6}$/i.test(bg))
        out.push(`background-color:#${bg}`); const font = attr(first(rPr, 'rFonts'), 'ascii'); if (font && !/[;"<>]/.test(font))
        out.push(`font-family:${font}`); const vert = val(first(rPr, 'vertAlign')); if (['subscript', 'superscript'].includes(vert))
        out.push(`vertical-align:${vert === 'subscript' ? 'sub' : 'super'}`); return out.join(';'); };
    const styleChain = (id, seen = new Set()) => { if (!id || seen.has(id) || !styles.has(id))
        return ''; seen.add(id); const s = styles.get(id); return styleChain(val(first(s, 'basedOn')), seen) + ';' + styleCSS(first(s, 'rPr')); };
    function run(node) {
        const local = node.localName;
        if (local === 'r') {
            const css = styleCSS(first(node, 'rPr'));
            let content = '';
            for (const c of node.children) {
                if (c.localName === 't' || c.localName === 'delText')
                    content += escapeHTML(c.textContent);
                else if (c.localName === 'br')
                    content += attr(c, 'type') === 'page' ? '<div class="page-break"><br></div>' : '<br>';
                else if (c.localName === 'tab')
                    content += '&emsp;';
                else if (c.localName === 'drawing') {
                    const blip = c.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'blip')[0], rel = rels.get(blip?.getAttributeNS(R, 'embed'));
                    if (rel && !rel.external) {
                        let path = rel.target.startsWith('/') ? rel.target.slice(1) : 'word/' + rel.target;
                        const bytes = files.get(path), ext = path.split('.').at(-1).toLowerCase();
                        if (bytes && ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
                            const extent = c.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'extent')[0], width = Number(extent?.getAttribute('cx')) / 9525;
                            content += `<img alt="Imported image" src="data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${bytesToBase64(bytes)}"${width ? ` style="width:${width}px;max-width:100%"` : ''}>`;
                        }
                    }
                }
            }
            return css ? `<span style="${escapeHTML(css)}">${content}</span>` : content;
        }
        if (local === 'hyperlink') {
            const rel = rels.get(node.getAttributeNS(R, 'id')), href = safeURL(rel?.target);
            const inner = [...node.children].map(run).join('');
            return href ? `<a href="${escapeHTML(href)}">${inner}</a>` : inner;
        }
        if (local === 'ins' || local === 'del')
            return `<${local} data-change="${uid()}"${local === 'del' ? ' contenteditable="false"' : ''}>${[...node.children].map(run).join('')}</${local}>`;
        if (['bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd', 'pPr', 'rPr', 'sectPr'].includes(local))
            return '';
        return [...node.children].map(run).join('');
    }
    function paragraph(p) {
        const props = first(p, 'pPr'), id = val(first(props, 'pStyle')), s = styles.get(id), nameStyle = val(first(s, 'name')) || id;
        let tag = /heading\s*1/i.test(nameStyle) ? 'h1' : /heading\s*2/i.test(nameStyle) ? 'h2' : /heading\s*3/i.test(nameStyle) ? 'h3' : /^title$/i.test(nameStyle) ? 'h1' : /quote/i.test(nameStyle) ? 'blockquote' : 'p';
        let css = styleChain(id);
        const align = val(first(props, 'jc'));
        if (align)
            css += `;text-align:${align === 'both' ? 'justify' : align}`;
        const numPr = first(props, 'numPr'), numId = val(first(numPr, 'numId'));
        if (numId) {
            const ordered = abstract.get(numbers.get(numId)) !== 'bullet';
            return `<${ordered ? 'ol' : 'ul'}><li style="${escapeHTML(css)}">${[...p.children].map(run).join('') || '<br>'}</li></${ordered ? 'ol' : 'ul'}>`;
        }
        let content = [...p.children].map(run).join('') || '<br>';
        if (content.includes('<div class="page-break"')) {
            const parts = content.split(/<div class="page-break"><br><\/div>/);
            return parts.map(x => `<${tag} style="${escapeHTML(css)}">${x || '<br>'}</${tag}>`).join('<div class="page-break"><br></div>');
        }
        return `<${tag} style="${escapeHTML(css)}">${content}</${tag}>`;
    }
    function block(n) { if (n.localName === 'p')
        return paragraph(n); if (n.localName === 'tbl')
        return `<table>${[...n.children].filter(c => c.localName === 'tr').map(r => `<tr>${[...r.children].filter(c => c.localName === 'tc').map(c => `<td>${[...c.children].map(block).join('')}</td>`).join('')}</tr>`).join('')}</table>`; return ''; }
    const body = first(documentXML, 'body'), d = newDocument(name.replace(/\.docx$/i, ''), sanitizeHTML([...body.children].map(block).join('')));
    const section = first(documentXML, 'sectPr');
    const pg = first(section, 'pgSz'), margin = first(section, 'pgMar');
    if (pg) {
        d.layout.width = Number(attr(pg, 'w')) / 15 || 794;
        d.layout.height = Number(attr(pg, 'h')) / 15 || 1123;
        d.layout.orientation = d.layout.width > d.layout.height ? 'landscape' : 'portrait';
    }
    if (margin)
        for (const k of ['top', 'bottom', 'left', 'right']) {
            const n = Number(attr(margin, k));
            if (n)
                d.layout[k] = n / 15;
        }
    d.layout.font = 'Segoe UI';
    d.layout.fontSize = 14;
    // Word comments are retained as document-level notes; fine-grained anchors may differ.
    const commentsXML = parseXML(files.get('word/comments.xml'));
    for (const c of commentsXML?.documentElement.children || [])
        if (c.localName === 'comment')
            d.comments.push({ id: uid(), author: attr(c, 'author') || 'Imported author', time: attr(c, 'date') || new Date().toISOString(), text: [...c.getElementsByTagNameNS(W, 't')].map(n => n.textContent).join(' '), quote: 'Imported Word comment', resolved: false });
    const box = document.createElement('div');
    box.innerHTML = d.pages[0].html;
    for (const list of [...box.querySelectorAll('ul,ol')]) {
        const prev = list.previousElementSibling;
        if (prev?.tagName === list.tagName) {
            prev.append(...list.childNodes);
            list.remove();
        }
    }
    d.pages[0].html = box.innerHTML;
    return validateDocument(d);
}
export function exportHTML(doc, root) { const styles = []; for (const sheet of document.styleSheets) {
    try {
        for (const rule of sheet.cssRules)
            if (rule.selectorText?.includes('.page-content'))
                styles.push(rule.cssText);
    }
    catch { }
} const l = doc.layout; return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHTML(doc.title)}</title><style>:root{--doc-accent:${l.accent}}*{box-sizing:border-box}body{margin:0;background:#eef1f4;color:#3d4d5c}.export-document{max-width:${l.width}px;margin:30px auto;padding:${l.top}px ${l.right}px ${l.bottom}px ${l.left}px;background:white;box-shadow:0 3px 24px #233b5712}.page-content{font-family:${escapeHTML(l.font)},Arial,sans-serif;font-size:${l.fontSize}px;line-height:${l.lineHeight}}${styles.join('\n')}.page-content{font-family:${escapeHTML(l.font)},Arial,sans-serif;font-size:${l.fontSize}px;line-height:${l.lineHeight};height:auto;cursor:auto}.page-break{break-after:page;height:0}@media print{body{background:white}.export-document{padding:0;margin:0;box-shadow:none}@page{size:${l.width}px ${l.height}px;margin:${l.top}px ${l.right}px ${l.bottom}px ${l.left}px}}</style></head><body><main class="export-document"><div class="page-content">${[...root.querySelectorAll('.page-content')].map(p => p.innerHTML).join('')}</div></main></body></html>`; }
export function exportMarkdown(root) { const render = n => { if (n.nodeType === 3)
    return n.textContent.replaceAll('\u200b', ''); if (n.nodeType !== 1)
    return ''; const t = n.tagName, inner = [...n.childNodes].map(render).join(''); if (/^H[1-6]$/.test(t))
    return `${'#'.repeat(Number(t[1]))} ${inner}\n\n`; if (t === 'P' || t === 'DIV')
    return inner + '\n\n'; if (t === 'BR')
    return '\n'; if (t === 'STRONG' || t === 'B')
    return `**${inner}**`; if (t === 'EM' || t === 'I')
    return `*${inner}*`; if (t === 'A')
    return `[${inner}](${n.getAttribute('href')})`; if (t === 'IMG')
    return `![${n.alt || 'Image'}](${n.src})`; if (t === 'BLOCKQUOTE')
    return `> ${inner.trim()}\n\n`; if (t === 'LI')
    return `${n.parentElement.tagName === 'OL' ? `${[...n.parentElement.children].indexOf(n) + 1}.` : '-'} ${inner.trim()}\n`; if (t === 'UL' || t === 'OL')
    return inner + '\n'; if (t === 'HR')
    return '\n---\n\n'; if (t === 'TABLE') {
    const rows = [...n.rows].map(row => '| ' + [...row.cells].map(c => c.textContent.replaceAll('|', '\\|').replaceAll('\n', ' ')).join(' | ') + ' |');
    if (rows.length)
        rows.splice(1, 0, '| ' + [...n.rows[0].cells].map(() => '---').join(' | ') + ' |');
    return '\n' + rows.join('\n') + '\n\n';
} return inner; }; return [...root.querySelectorAll('.page-content')].map(p => [...p.childNodes].map(render).join('')).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'; }
export function importMarkdown(text) { const safe = escapeHTML(text); const inline = t => t.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '$1').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/`([^`]+)`/g, '<span style="font-family:monospace;background-color:#f0f3f5">$1</span>'); return safe.split(/\r?\n/).map(line => { const h = line.match(/^(#{1,6})\s+(.+)$/); if (h)
    return `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; if (/^[-*]\s+/.test(line))
    return `<ul><li>${inline(line.slice(2))}</li></ul>`; if (/^\d+\.\s+/.test(line))
    return `<ol><li>${inline(line.replace(/^\d+\.\s+/, ''))}</li></ol>`; if (line.startsWith('&gt; '))
    return `<blockquote>${inline(line.slice(5))}</blockquote>`; if (/^---+$/.test(line))
    return '<hr>'; return `<p>${inline(line) || '<br>'}</p>`; }).join(''); }
export async function importFile(file) { if (file.size > 30 * 1024 * 1024)
    throw new Error('Please choose a document smaller than 30 MB.'); const ext = file.name.split('.').at(-1).toLowerCase(); if (ext === 'docx')
    return importDocx(await file.arrayBuffer(), file.name); const text = await file.text(); if (ext === 'quire' || ext === 'document' || ext === 'json')
    return validateDocument(JSON.parse(text)); const title = file.name.replace(/\.[^.]+$/, ''); if (ext === 'html' || ext === 'htm')
    return newDocument(title, sanitizeHTML(text)); if (ext === 'md')
    return newDocument(title, sanitizeHTML(importMarkdown(text))); return newDocument(title, text.split(/\r?\n/).map(line => `<p>${escapeHTML(line) || '<br>'}</p>`).join('')); }
