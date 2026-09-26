import { icon } from './icons.js';
import { uid, escapeHTML, debounce, newDocument, DocumentStore, DocumentRepository, Paginator, EditorEngine, DocumentSearch, StatisticsWorker, bookmarkSelection, restoreBookmark, caretAt, safeURL, sanitizeHTML } from './core.js';
import { GPUPageRenderer } from './renderer.js';
import { templates, clarityReport } from './templates.js';
import { downloadFile, exportDocx, exportHTML, exportMarkdown, importFile } from './io.js';
const $ = (s, root = document) => root.querySelector(s), $$ = (s, root = document) => [...root.querySelectorAll(s)];
const root = $('#page-stack'), viewport = $('#viewport'), ribbon = $('#ribbon'), modal = $('#modal'), popover = $('#popover');
const repository = new DocumentRepository();
let initial;
try {
    initial = await repository.current();
}
catch (error) {
    console.warn('Local storage unavailable:', error.message);
}
const store = new DocumentStore(initial || clarityReport());
const paginator = new Paginator(root, store);
const editor = new EditorEngine(root, store, paginator);
const renderer = new GPUPageRenderer($('#gpu-canvas'), viewport, root);
const search = new DocumentSearch(root);
const statistics = new StatisticsWorker();
let referenceStack = null;
const hostedWorkspace = new URLSearchParams(location.search).has('utherealParentOrigin');
function nativeExportBlocked() { if (!hostedWorkspace) return false; toast('Export from the workspace to include current references.', true); return true; }
function setReferencePresentation(presentation) {
    if (presentation === null) { referenceStack?.remove(); referenceStack = null; renderer.invalidate(); return { page_count: 0 }; }
    referenceStack?.remove(); referenceStack = null;
    if (!presentation || !Array.isArray(presentation.entries) || !presentation.entries.every(entry =>
        Number.isInteger(entry.number) && entry.number > 0 && typeof entry.text === 'string' && entry.text.trim()))
        throw new Error('Invalid reference presentation');
    const next = document.createElement('div');
    next.className = 'page-stack reference-stack';
    next.dataset.revision = String(presentation.id_revision ?? '');
    next.setAttribute('aria-label', 'Read-only references');
    root.after(next);
    let page = null, content = null;
    const addPage = () => {
        const slot = document.createElement('div'), paper = document.createElement('article');
        slot.className = 'paper-slot'; paper.className = 'paper';
        paper.setAttribute('aria-label', 'References page');
        content = document.createElement('div');
        content.className = 'page-content reference-content';
        content.contentEditable = 'false';
        content.setAttribute('aria-readonly', 'true');
        const heading = document.createElement('h1');
        heading.textContent = page ? 'References (continued)' : 'References';
        content.append(heading); paper.append(content); slot.append(paper); next.append(slot); page = slot;
    };
    try {
        if (presentation.entries.length) addPage();
        for (const entry of presentation.entries) {
            const marker = `[${entry.number}]`;
            const words = (`${marker} ${entry.text.trim()}`).split(/\s+/);
            let line = document.createElement('p'); content.append(line);
            for (const word of words) {
                const previous = line.textContent;
                line.textContent = previous ? `${previous} ${word}` : word;
                if (paginator.used(content) <= content.clientHeight - 2) continue;
                line.textContent = previous;
                const moveMarker = previous === marker && content.children.length > 2;
                if (moveMarker || previous !== marker) {
                    if (moveMarker || !previous) line.remove();
                    addPage(); line = document.createElement('p');
                    if (moveMarker) line.textContent = marker;
                    content.append(line);
                }
                let remaining = (line.textContent ? ' ' : '') + word;
                while (remaining) {
                    const start = line.textContent;
                    line.textContent = start + remaining;
                    if (paginator.used(content) <= content.clientHeight - 2) break;
                    const characters = Array.from(remaining);
                    let low = 1, high = characters.length, best = 0;
                    while (low <= high) {
                        const middle = (low + high) >> 1;
                        line.textContent = start + characters.slice(0, middle).join('');
                        if (paginator.used(content) <= content.clientHeight - 2) { best = middle; low = middle + 1; }
                        else high = middle - 1;
                    }
                    if (!best) throw new Error(`Reference [${entry.number}] cannot fit on a page`);
                    line.textContent = start + characters.slice(0, best).join('');
                    remaining = characters.slice(best).join('').trimStart();
                    if (remaining) { addPage(); line = document.createElement('p'); content.append(line); }
                }
            }
        }
        referenceStack?.remove(); referenceStack = next;
        renderer.invalidate();
        return { page_count: next.children.length };
    } catch (error) { next.remove(); renderer.invalidate(); throw error; }
}
let activeTab = 'Home', navTab = 'headings', activePanel = null, zoom = store.document.view.zoom || 85, reading = false, stats = { words: 0, characters: 0, noSpaces: 0, readingMinutes: 1, paragraphs: 0, sentences: 0 }, searchTerm = '', currentPage = 1, isSaving = false, formatPainter = null, inkMode = null, inkColor = '#245c88', inkWidth = 3, activeStroke = null, modalBookmark = null, selectedImage = null;
const actions = {};
const colors = ['#263f52', '#306b9b', '#28766e', '#4b8d72', '#82984d', '#d3a24e', '#bd7652', '#af5e69', '#111827', '#556575', '#8d9aa5', '#c9d1d8', '#e8edf2', '#ffffff', '#fff0a8', '#f1c6d0', '#daf0eb', '#dce9f8', '#e3def3', '#f9e6d5', '#88bdcf', '#91b7aa', '#bed092', '#f1d17a'];
function hydrateIcons(container = document) { $$('[data-icon]', container).forEach(el => { el.innerHTML = icon(el.dataset.icon); el.removeAttribute('data-icon'); }); }
function toast(message, error = false) { const el = document.createElement('div'); el.className = 'toast' + (error ? ' error' : ''); el.innerHTML = icon(error ? 'info' : 'checkcircle') + `<span>${escapeHTML(message)}</span>`; $('#toasts').append(el); setTimeout(() => el.remove(), 4200); }
editor.on('notice', message => toast(message));
const smallButton = (action, name, title, extra = '') => `<button data-action="${action}" title="${title}" aria-label="${title}" ${extra}>${icon(name)}</button>`;
const tallButton = (action, name, label, extra = '') => `<button class="ribbon-tall" data-action="${action}" title="${label}" ${extra}>${icon(name, 27)}<span>${label}</span></button>`;
const stackButton = (action, name, label) => `<button data-action="${action}" title="${label}">${icon(name, 14)}${label}</button>`;
const group = (label, content, extra = '') => `<div class="ribbon-group ${extra}"><div class="ribbon-group-content">${content}</div><div class="group-label">${label}</div></div>`;
const row = html => `<div class="ribbon-row">${html}</div>`;
const stack = html => `<div class="ribbon-stack">${html}</div>`;
function renderRibbon(tab = activeTab) {
    activeTab = tab;
    $$('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('.more-tabs-button').classList.toggle('active', !['Home', 'Insert'].includes(tab) && $('.more-tabs-button').getAttribute('aria-expanded') === 'false');
    ribbon.setAttribute('aria-label', tab + ' ribbon');
    let html = '';
    if (tab === 'Home') {
        html += group('Clipboard', tallButton('paste', 'paste', 'Paste') + stack(stackButton('cut', 'cut', 'Cut') + stackButton('copy', 'copy', 'Copy') + stackButton('format-painter', 'brush', 'Format painter')));
        html += group('Font', `<div class="font-controls">${row(`<select id="font-family" aria-label="Font family">${['Segoe UI', 'Arial', 'Calibri', 'Georgia', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Courier New'].map(f => `<option>${f}</option>`).join('')}</select><select id="font-size" aria-label="Font size">${[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72].map(n => `<option${n === 11 ? ' selected' : ''}>${n}</option>`).join('')}</select><button data-action="font-grow" title="Increase font size"><span class="letter-icon">A</span><sup>+</sup></button><button data-action="font-shrink" title="Decrease font size"><span class="letter-icon" style="font-size:14px">A</span><sup>−</sup></button><button data-action="case" title="Change case"><span class="text-tiny">Aa</span>${icon('chevron', 10)}</button>`)}${row(smallButton('bold', 'bold', 'Bold (Ctrl+B)', 'data-format="bold"') + smallButton('italic', 'italic', 'Italic (Ctrl+I)', 'data-format="italic"') + smallButton('underline', 'underline', 'Underline (Ctrl+U)', 'data-format="underline"') + smallButton('strikeThrough', 'strike', 'Strikethrough', 'data-format="strikeThrough"') + `<button data-action="subscript" title="Subscript" data-format="subscript"><span class="text-tiny">x₂</span></button><button data-action="superscript" title="Superscript" data-format="superscript"><span class="text-tiny">x²</span></button><span class="mini-separator"></span>` + smallButton('highlight', 'highlight', 'Text highlight color', 'class="color-tool"') + smallButton('font-color', 'fontcolor', 'Font color', 'class="color-tool" style="--color:#b56568"') + smallButton('clear-format', 'clear', 'Clear formatting'))}</div>`);
        html += group('Paragraph', `<div class="font-controls">${row(smallButton('bullets', 'bullets', 'Bulleted list') + smallButton('numbering', 'numbering', 'Numbered list') + `<span class="mini-separator"></span>` + smallButton('outdent', 'outdent', 'Decrease indent') + smallButton('indent', 'indent', 'Increase indent') + `<button data-action="marks" title="Show paragraph marks"><span style="font-family:Georgia;font-size:18px">¶</span></button>`)}${row(['left', 'center', 'right', 'justify'].map(a => smallButton('align-' + a, a, 'Align ' + a, `data-align="${a}"`)).join('') + smallButton('line-spacing', 'lines', 'Line and paragraph spacing') + smallButton('paragraph-color', 'palette', 'Paragraph shading'))}</div>`);
        html += group('Styles', `<div class="ribbon-row styles-gallery">${[['p', 'Normal', 'AaBb'], ['title', 'Title', 'Aa'], ['h1', 'Heading 1', 'AaBb'], ['h2', 'Heading 2', 'AaBb'], ['blockquote', 'Quote', 'AaBb']].map(([style, label, preview]) => `<button class="style-card ${style === 'p' ? 'active' : ''}" data-style="${style}" title="Apply ${label}"><span class="style-preview">${preview}</span><span class="style-label">${label}</span></button>`).join('')}</div>`);
        html += group('Editing', stack(stackButton('find', 'search', 'Find') + stackButton('replace', 'replace', 'Replace') + stackButton('select-all', 'target', 'Select all')));
    }
    else if (tab === 'Insert') {
        html += group('Pages', tallButton('file', 'file', 'Cover page') + tallButton('insert-page', 'page', 'Blank page') + tallButton('page-break', 'break', 'Page break'));
        html += group('Tables', tallButton('insert-table', 'table', 'Table') + stack(stackButton('table-add-row', 'plus', 'Add row') + stackButton('table-add-column', 'columns', 'Add column') + stackButton('table-delete', 'trash', 'Delete table')));
        html += group('Illustrations', tallButton('image', 'image', 'Picture') + tallButton('chart', 'layout', 'Chart'));
        html += group('Links', tallButton('link', 'link', 'Link'));
        html += group('Header & footer', tallButton('header', 'layout', 'Header') + tallButton('footer', 'page', 'Page numbers'));
        html += group('Text & symbols', tallButton('date', 'history', 'Date & time') + tallButton('symbol', 'spark', 'Symbol') + tallButton('equation', 'pen', 'Equation') + tallButton('horizontal-rule', 'minus', 'Divider'));
    }
    else if (tab === 'Draw') {
        html += group('Tools', tallButton('draw-select', 'target', 'Select') + tallButton('draw-pen', 'pen', 'Pen') + tallButton('draw-highlight', 'highlight', 'Highlighter') + tallButton('draw-eraser', 'eraser', 'Eraser'));
        html += group('Ink appearance', `<div class="font-controls">${row(colors.slice(0, 8).map(c => `<button class="color-swatch" data-ink-color="${c}" style="background:${c}" title="Ink ${c}"></button>`).join(''))}${row(`<span style="font-size:11px">Thickness</span><select id="ink-width" aria-label="Ink thickness">${[1, 2, 3, 5, 8, 12, 18].map(n => `<option${n === inkWidth ? ' selected' : ''} value="${n}">${n} px</option>`).join('')}</select>`)} </div>`);
        html += group('Manage', tallButton('clear-ink', 'trash', 'Clear page ink'));
        html += group('About ink', `<div style="font-size:11px;line-height:1.8;color:#80909d;padding:0 10px">Draw directly on the page.<br>Ink is included in .document files and printed output.</div>`);
    }
    else if (tab === 'Design') {
        html += group('Document palette', `<div class="ribbon-row">${[['#28766e', 'Sage'], ['#306b9b', 'Ocean'], ['#715c8f', 'Iris'], ['#a75f4e', 'Terracotta'], ['#344052', 'Slate']].map(([color, name]) => `<button class="style-card" data-accent="${color}" title="${name} document accent"><span style="display:flex;gap:3px"><i style="display:block;width:17px;height:21px;background:${color}"></i><i style="display:block;width:17px;height:21px;background:${color};opacity:.45"></i><i style="display:block;width:17px;height:21px;background:${color};opacity:.18"></i></span><span class="style-label">${name}</span></button>`).join('')}</div>`);
        html += group('Typography', tallButton('font-modern', 'file', 'Modern') + tallButton('font-editorial', 'book', 'Editorial') + tallButton('font-classic', 'page', 'Classic'));
        html += group('Paragraph rhythm', tallButton('spacing-compact', 'lines', 'Compact') + tallButton('spacing-relaxed', 'lines', 'Relaxed'));
        html += group('Workspace', tallButton('theme', 'moon', 'Light / dark'));
    }
    else if (tab === 'Layout') {
        html += group('Page setup', tallButton('margins', 'layout', 'Margins') + tallButton('orientation', 'page', 'Orientation') + tallButton('paper-size', 'file', 'Size') + tallButton('page-break', 'break', 'Breaks'));
        html += group('Paragraph', `<div class="font-controls">${row(`<span style="width:54px;font-size:11px">Before</span><select id="space-before" aria-label="Paragraph spacing before">${[0, 6, 12, 18, 24].map(n => `<option value="${n}">${n} pt</option>`).join('')}</select>`)}${row(`<span style="width:54px;font-size:11px">After</span><select id="space-after" aria-label="Paragraph spacing after">${[0, 6, 12, 18, 24].map(n => `<option value="${n}">${n} pt</option>`).join('')}</select>`)}</div>` + stack(stackButton('indent', 'indent', 'Increase indent') + stackButton('outdent', 'outdent', 'Decrease indent') + stackButton('line-spacing', 'lines', 'Line spacing')));
        html += group('Settings', tallButton('page-setup', 'ruler', 'Custom setup') + tallButton('fit-page', 'target', 'Fit page'));
    }
    else if (tab === 'References') {
        html += group('Contents', tallButton('insert-toc', 'toc', 'Table of contents') + tallButton('update-toc', 'history', 'Update contents'));
        html += group('Notes & citations', tallButton('endnote', 'file', 'Endnote') + tallButton('citation', 'book', 'Citation'));
        html += group('Captions', tallButton('caption', 'image', 'Insert caption'));
        html += group('Navigate', tallButton('toggle-navigation', 'layout', 'Navigation'));
    }
    else if (tab === 'Review') {
        html += group('Proofing', tallButton('spelling', 'checkcircle', 'Spelling') + tallButton('insights', 'file', 'Word count') + tallButton('read-aloud', 'mic', 'Read aloud'));
    }
    else if (tab === 'View') {
        html += group('Document views', tallButton('edit-mode', 'page', 'Print layout') + tallButton('read-mode', 'book', 'Reading mode'));
        html += group('Show', stack(stackButton('toggle-navigation', 'layout', 'Navigation pane') + stackButton('ruler', 'ruler', 'Ruler') + stackButton('marks', 'file', 'Paragraph marks')));
        html += group('Zoom', tallButton('zoom-dialog', 'search', 'Zoom') + tallButton('zoom-100', 'page', '100%') + tallButton('fit-page', 'target', 'One page') + tallButton('fit-width', 'columns', 'Page width'));
        html += group('Workspace', tallButton('focus', 'target', 'Focus') + tallButton('theme', 'moon', 'Light / dark'));
        html += group('Engine', tallButton('about', 'gpu', 'Renderer'));
    }
    ribbon.innerHTML = html;
    updateFormatUI();
}
function updateFormatUI() { const format = editor.getFormat(); $$('[data-format]').forEach(b => { b.classList.toggle('active', !!format[b.dataset.format]); b.setAttribute('aria-pressed', String(!!format[b.dataset.format])); }); $$('[data-align]').forEach(b => b.classList.toggle('active', b.dataset.align === (format.align === 'start' ? 'left' : format.align))); $$('[data-style]').forEach(b => b.classList.toggle('active', b.dataset.style === (format.block || 'p'))); if (format.fontFamily && $('#font-family') && document.activeElement !== $('#font-family')) {
    const select = $('#font-family');
    const option = [...select.options].find(o => o.value === format.fontFamily);
    if (option)
        select.value = option.value;
} if (format.fontSize && $('#font-size') && document.activeElement !== $('#font-size')) {
    const select = $('#font-size');
    if (![...select.options].some(o => Number(o.value) === format.fontSize))
        select.add(new Option(format.fontSize, format.fontSize));
    select.value = String(format.fontSize);
} }
editor.on('selection', updateFormatUI);
function applyLayout() {
    const l = store.document.layout, s = document.documentElement.style;
    for (const [key, value] of Object.entries({ 'paper-width': l.width + 'px', 'paper-height': l.height + 'px', 'margin-top': l.top + 'px', 'margin-bottom': l.bottom + 'px', 'margin-left': l.left + 'px', 'margin-right': l.right + 'px', 'doc-accent': l.accent, 'doc-font': `"${l.font}", Arial, sans-serif`, 'doc-body-size': l.fontSize + 'px', 'doc-line-height': l.lineHeight }))
        s.setProperty('--' + key, value);
    $('#document-title').value = store.document.title;
    $('#document-title').style.width = Math.min(280, Math.max(100, store.document.title.length * 6.6 + 5)) + 'px';
    document.title = `${store.document.title} — Document`;
    $('#workspace-name').textContent = store.document.title.toUpperCase();
    $('.paper-label').innerHTML = `${escapeHTML(l.size)} <span>·</span> ${l.orientation === 'landscape' ? 'Landscape' : 'Portrait'} ${icon('chevron', 12)}`;
    $('#ruler .ruler-ticks').innerHTML = Array.from({ length: 15 }, (_, i) => `<span>${i === 0 ? '' : i}</span>`).join('');
    let ps = $('#dynamic-print');
    if (!ps) {
        ps = document.createElement('style');
        ps.id = 'dynamic-print';
        document.head.append(ps);
    }
    ps.textContent = `@media print{@page{size:${l.width}px ${l.height}px;margin:0}}`;
}
function setZoom(value, save = true) { zoom = Math.min(180, Math.max(40, Math.round(value))); document.documentElement.style.setProperty('--zoom', zoom / 100); $('#zoom').value = zoom; $('#zoom-label').textContent = zoom + '%'; if (save)
    store.document.view.zoom = zoom; renderer.schedule(); }
function docText() { return $$('.page-content', root).map(p => p.innerText.replaceAll('\u200b', '')).join('\n'); }
function referenceText() { return referenceStack ? $$('.reference-content', referenceStack).map(page => page.innerText).join('\n\n') : ''; }
function referenceMarkdown() { return referenceStack ? '\n\n' + $$('.reference-content', referenceStack).map(page => [...page.children].map(el => el.tagName === 'H1' ? `# ${el.textContent}` : el.textContent).join('\n\n')).join('\n\n') + '\n' : ''; }
function scheduleStats() { statistics.update(docText()); }
statistics.on('stats', value => { stats = value; $('#word-count').textContent = value.words.toLocaleString() + ' words'; if (activePanel === 'insights')
    renderPanel(); });
function headings() { return $$('h1,h2,h3', root).filter(h => !h.classList.contains('cover-title') && !h.classList.contains('chapter-title')).map((el, i) => { el.id = 'heading-' + i; return { el, text: el.textContent, level: el.tagName === 'H3' ? 2 : 1, index: i }; }); }
function renderNavigation() {
    const content = $('#nav-content');
    if (navTab === 'headings') {
        const items = headings();
        content.innerHTML = `<div class="outline-kicker">In this document</div>` + items.map((h, i) => `<button class="outline-button level-${h.level} ${i === 0 ? 'active' : ''}" data-heading="${h.index}">${escapeHTML(h.text)}</button>`).join('') + (!items.length ? '<div class="empty-panel">Apply a heading style to create your document outline.</div>' : '');
    }
    else if (navTab === 'pages') {
        content.innerHTML = '';
        $$('.paper-slot', root).forEach((slot, i) => { const wrap = document.createElement('div'); wrap.className = 'thumb-wrap'; const thumb = document.createElement('button'); thumb.className = 'thumb' + (i === currentPage - 1 ? ' active' : ''); thumb.dataset.gotoPage = i + 1; thumb.title = 'Go to page ' + (i + 1); thumb.setAttribute('aria-label', thumb.title); const paper = slot.querySelector('.paper').cloneNode(true); paper.classList.remove('gpu-rasterized'); paper.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable')); paper.querySelectorAll('[id]').forEach(n => n.removeAttribute('id')); paper.style.transform = `scale(${128 / store.document.layout.width})`; thumb.style.height = (128 * store.document.layout.height / store.document.layout.width) + 'px'; thumb.append(paper); wrap.append(thumb); const label = document.createElement('span'); label.className = 'thumb-number'; label.textContent = i + 1; wrap.append(label); content.append(wrap); });
    }
    else {
        content.innerHTML = search.matches.map((m, i) => { const text = escapeHTML(m.context), term = escapeHTML(searchTerm), at = text.toLowerCase().indexOf(term.toLowerCase()); return `<button class="search-result" data-search-result="${i}"><small>Page ${m.page}</small>${at >= 0 ? text.slice(0, at) + '<strong>' + text.slice(at, at + term.length) + '</strong>' + text.slice(at + term.length) : text}</button>`; }).join('') || `<div class="empty-panel">${searchTerm ? 'No matching text found.' : 'Type in the search field to find text.'}</div>`;
    }
}
const navUpdate = debounce(renderNavigation, 250);
function updatePageStatus() { const view = viewport.getBoundingClientRect(), slots = $$('.paper-slot', root); let best = 0, index = 0; slots.forEach((slot, i) => { const r = slot.getBoundingClientRect(), overlap = Math.max(0, Math.min(r.bottom, view.bottom) - Math.max(r.top, view.top)); if (overlap > best) {
    best = overlap;
    index = i;
} }); currentPage = index + 1; $('#page-status').textContent = `Page ${currentPage} of ${slots.length}`; if (navTab === 'headings') {
    let active = null;
    for (const h of headings())
        if (h.el.getBoundingClientRect().top < view.top + view.height * .55)
            active = h.index;
    $$('[data-heading]').forEach(b => b.classList.toggle('active', Number(b.dataset.heading) === (active ?? 0)));
} }
viewport.addEventListener('scroll', debounce(updatePageStatus, 65), { passive: true });
function renderInk() { for (const slot of root.children) {
    const layer = slot.querySelector('.ink-layer');
    layer.setAttribute('viewBox', `0 0 ${store.document.layout.width} ${store.document.layout.height}`);
    layer.innerHTML = (slot.ink || []).map(s => `<path data-stroke="${s.id}" d="${inkPath(s.points)}" fill="none" stroke="${s.color}" stroke-width="${s.width}" stroke-opacity="${s.opacity}" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:stroke"/>`).join('');
} }
function inkPath(points) { if (!points.length)
    return ''; if (points.length === 1)
    return `M ${points[0][0]} ${points[0][1]} l .1 .1`; return 'M ' + points.map(p => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' L '); }
async function saveNow(showMessage = false) { editor.commit('typing', true); isSaving = true; const revision = store.revision; $('#save-indicator').innerHTML = icon('cloud', 17) + '<span>Saving…</span>'; try {
    const result = await repository.save(store.document);
    if (revision === store.revision) {
        if (result.persisted) {
            store.cleanRevision = revision;
            $('#save-indicator').innerHTML = icon('cloud', 17) + '<span>Saved on this device</span>';
        }
        else {
            $('#save-indicator').innerHTML = icon('info', 17) + '<span>Session only · export a copy</span>';
        }
    }
    if (showMessage)
        toast(result.persisted ? 'Saved on this device.' : 'Browser storage is unavailable. Export a .document copy before closing.', !result.persisted);
    return true;
}
catch (error) {
    $('#save-indicator').innerHTML = icon('info', 17) + '<span>Not saved — export a copy</span>';
    if (showMessage)
        toast('Local saving failed. Export a .document copy to keep your work.', true);
    console.warn('Save failed:', error.message);
    return false;
}
finally {
    isSaving = false;
} }
const autosave = debounce(() => saveNow(), 700);
store.on('change', ({ kind }) => { setReferencePresentation(null); if (!['typing'].includes(kind))
    applyLayout(); $('#save-indicator').innerHTML = icon('cloud', 17) + '<span>Saving…</span>'; $$('[data-action="undo"]').forEach(b => b.disabled = !store.history.length); $$('[data-action="redo"]').forEach(b => b.disabled = !store.future.length); scheduleStats(); navUpdate(); updatePageStatus(); renderer.invalidate(); renderInk(); if (activePanel)
    renderPanel(); autosave(); });
store.on('replace', ({ kind }) => { setReferencePresentation(null); const bookmark = kind === 'open' ? null : bookmarkSelection(root); editor.savedRange = null; if (kind === 'open') {
    getSelection().removeAllRanges();
    searchTerm = '';
    search.find('');
    $('#nav-search').value = '';
    $('#search-status').hidden = true;
    $('#navigation').classList.remove('mobile-open');
    navTab = 'headings';
    $$('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === navTab));
} applyLayout(); paginator.render(); paginator.reflow(); store.document.pages = paginator.getPages(); renderInk(); restoreBookmark(root, bookmark); setReading(reading); setZoom(store.document.view.zoom || zoom, false); renderRibbon(); });
editor.on('layout', () => { paginator.updateFurniture(); renderInk(); renderer.invalidate(); });
const scheduleInputStats = debounce(scheduleStats, 150);
editor.on('input', () => { setReferencePresentation(null); scheduleInputStats(); });
function changeLayout(values) { if (reading)
    setReading(false); editor.commit('typing', true); store.transact('page layout', d => { Object.assign(d.layout, values); applyLayout(); paginator.reflow(); d.pages = paginator.getPages(); }); }
function setReading(value) { reading = !!value; editor.readOnly = reading; document.body.classList.toggle('reading', reading); if (reading)
    setInkMode(null); $$('.page-content', root).forEach(el => el.contentEditable = String(!reading)); $('#editing-mode').innerHTML = icon(reading ? 'book' : 'pen', 15) + `<span>${reading ? 'Reading' : 'Editing'}</span>` + icon('chevron', 12); $('#print-view').classList.toggle('active', !reading); $('#read-view').classList.toggle('active', reading); renderer.setReading(reading); }
function showPopover(html, anchor) { popover.innerHTML = html; popover.hidden = false; const rect = anchor?.getBoundingClientRect?.() || { left: innerWidth / 2, top: 180, bottom: 190 }; let left = Math.min(rect.left, innerWidth - popover.offsetWidth - 12), top = rect.bottom + 7; if (top + popover.offsetHeight > innerHeight - 35)
    top = Math.max(8, rect.top - popover.offsetHeight - 7); popover.style.left = Math.max(8, left) + 'px'; popover.style.top = top + 'px'; }
function hidePopover() { popover.hidden = true; }
function menuItem(action, name, label, hint = '') { return `<button class="menu-item" data-action="${action}">${icon(name)}${label}${hint ? `<small>${hint}</small>` : ''}</button>`; }
function showModal(title, body, { wide = false, onSubmit = null } = {}) { hidePopover(); if (modal.open)
    modal.close(); modalBookmark = bookmarkSelection(root); modal.classList.toggle('file-modal', wide); $('#modal-content').innerHTML = `<div class="modal-head"><h2>${escapeHTML(title)}</h2><button data-action="close-modal" title="Close">${icon('close')}</button></div><div class="modal-body">${body}</div>`; const form = $('form', modal); if (form)
    form.addEventListener('submit', e => { e.preventDefault(); onSubmit?.(new FormData(form), form); }); modal.showModal(); setTimeout(() => { const input = $('input:not([type=hidden]),textarea', modal); if (input) {
    input.focus();
    if (input.tagName === 'INPUT')
        input.select();
} }, 20); }
function closeModal(restore = true) { modal.close(); if (restore && modalBookmark) {
    restoreBookmark(root, modalBookmark);
    editor.onSelection();
} }
const modalActions = (submit = 'Insert') => `<div class="modal-actions"><button type="button" class="secondary" data-action="close-modal">Cancel</button><button type="submit" class="primary">${submit}</button></div>`;
function formModal(title, fields, callback, submit = 'Insert') { showModal(title, `<form>${fields}${modalActions(submit)}</form>`, { onSubmit: (data, form) => { const value = Object.fromEntries(data); closeModal(); callback(value, form); } }); }
function palette(kind, anchor) { showPopover(`<div class="popover-label">${kind === 'font' ? 'Font color' : kind === 'paragraph' ? 'Paragraph shading' : 'Highlight color'}</div><div class="color-grid">${colors.map(c => `<button class="color-swatch" data-color="${c}" data-color-kind="${kind}" style="background:${c}" title="${c}" aria-label="Color ${c}"></button>`).join('')}</div><button class="menu-item" data-color="transparent" data-color-kind="${kind}">${icon('clear')}No color</button>`, anchor); }
function ensureEditing() { if (reading) {
    setReading(false);
    toast('Switched to Editing.');
} }
function getSelectedTable() { const range = editor.range(), node = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement; return node.closest('table'); }
function getSelectedCell() { const range = editor.range(), node = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement; return node.closest('td,th'); }
function setInkMode(mode) { inkMode = mode; document.body.classList.toggle('drawing', !!mode); if (mode) {
    setReading(false);
    inkMode = mode;
    document.body.classList.add('drawing');
} $$('[data-action^="draw-"]', ribbon).forEach(b => b.classList.toggle('active', b.dataset.action === `draw-${mode || 'select'}`)); }
async function openTemplate(name) { if (!await saveNow())
    return; const d = templates[name](); closeModal(false); store.replace(d); viewport.scrollTop = 0; toast('A fresh document is ready.'); }
function renderPanel() {
    const panel = $('#review-panel');
    panel.hidden = !activePanel;
    if (!activePanel)
        return;
    const titles = { comments: 'Comments', insights: 'Document insights', changes: 'Tracked changes' };
    panel.innerHTML = `<div class="panel-heading"><h2>${titles[activePanel]}</h2><button data-action="close-panel" title="Close panel">${icon('close', 15)}</button></div><div class="review-body"></div>`;
    const body = $('.review-body', panel);
    if (activePanel === 'comments') {
        const comments = store.document.comments;
        body.innerHTML = `<p class="panel-subtitle">A place for thoughtful feedback.<br>Comments are saved with this document.</p><button class="secondary" data-action="add-comment" style="width:100%;font-size:11px">${icon('plus', 15)}New comment</button>` + comments.map(c => `<article class="comment-card ${c.resolved ? 'resolved' : ''}"><div class="comment-head"><span class="comment-avatar">${escapeHTML((c.author || 'Y').slice(0, 1))}</span><div><strong>${escapeHTML(c.author || 'You')}</strong><time>${new Date(c.time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${new Date(c.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</time></div></div>${c.quote ? `<div class="comment-quote">${escapeHTML(c.quote)}</div>` : ''}<div>${escapeHTML(c.text).replaceAll('\n', '<br>')}</div><div class="comment-actions"><button data-resolve-comment="${c.id}">${icon(c.resolved ? 'undo' : 'check', 12)}${c.resolved ? 'Reopen' : 'Resolve'}</button><button data-delete-comment="${c.id}" title="Delete comment">${icon('trash', 12)}</button></div></article>`).join('') + (!comments.length ? `<div class="empty-panel">${icon('comment', 35)}<strong>Good work is a conversation.</strong>Select a passage and add your first comment.</div>` : '');
    }
    else if (activePanel === 'insights') {
        body.innerHTML = `<p class="panel-subtitle">A closer look at your words.</p><div class="insight-score"><div class="score-circle">${stats.readingMinutes}</div><div><strong style="font-size:13px;font-weight:500;color:#658477">Minutes to read</strong><div style="font-size:10px;color:#9aaba7;margin-top:5px">Estimated at 220 words/min</div></div></div><div class="insight-grid"><div><strong>${stats.words.toLocaleString()}</strong><span>Words</span></div><div><strong>${root.children.length}</strong><span>Pages</span></div><div><strong>${stats.characters.toLocaleString()}</strong><span>Characters</span></div><div><strong>${stats.paragraphs}</strong><span>Text paragraphs</span></div></div><div class="tip-box"><strong>Room to think</strong>${stats.words === 0 ? 'Your next idea starts here.' : `Your document has ${stats.sentences} sentence endings and ${stats.noSpaces.toLocaleString()} characters excluding spaces.`}</div><div class="tip-box"><strong>Private by default</strong>Text statistics are calculated in a local worker. Your document is not sent to an AI service.</div>`;
    }
    else {
        const changes = $$('ins[data-change],del[data-change]', root);
        body.innerHTML = `<p class="panel-subtitle">${store.document.trackChanges ? 'New typed text and text deletions are being marked.' : 'Turn on Track changes to mark new text edits.'} Formatting and structural edits are not tracked.</p><button class="secondary" data-action="track-changes" style="width:100%">${icon('history', 15)}${store.document.trackChanges ? 'Turn tracking off' : 'Turn tracking on'}</button>` + changes.map((c, i) => `<div class="comment-card"><div style="color:${c.tagName === 'INS' ? '#4e8966' : '#a86165'};font-size:10px;margin-bottom:5px">${c.tagName === 'INS' ? 'INSERTED' : 'DELETED'} TEXT</div><div>${escapeHTML(c.textContent)}</div><div class="comment-actions"><button data-change-index="${i}" data-accept="true">Accept</button><button data-change-index="${i}" data-accept="false">Reject</button></div></div>`).join('') + (!changes.length ? `<div class="empty-panel">${icon('checkcircle', 35)}<strong>All clear.</strong>No pending text revisions.</div>` : '');
    }
    renderer.schedule();
}
function togglePanel(name) { activePanel = activePanel === name ? null : name; renderPanel(); }
Object.assign(actions, {
    'close-modal': () => closeModal(), 'close-panel': () => { activePanel = null; renderPanel(); },
    undo: () => { editor.commit('typing', true); store.undo(); }, redo: () => store.redo(), save: () => saveNow(true),
    bold: () => editor.toggleMark('bold'), italic: () => editor.toggleMark('italic'), underline: () => editor.toggleMark('underline'), strikeThrough: () => editor.toggleMark('strikeThrough'), subscript: () => editor.toggleMark('subscript'), superscript: () => editor.toggleMark('superscript'),
    'clear-format': () => editor.clearFormat(), bullets: () => editor.list(false), numbering: () => editor.list(true), indent: () => editor.indent(24), outdent: () => editor.indent(-24),
    'align-left': () => editor.setBlockStyle({ textAlign: 'left' }), 'align-center': () => editor.setBlockStyle({ textAlign: 'center' }), 'align-right': () => editor.setBlockStyle({ textAlign: 'right' }), 'align-justify': () => editor.setBlockStyle({ textAlign: 'justify' }),
    'font-grow': () => editor.applyInline({ style: { fontSize: Math.min(96, (editor.getFormat().fontSize || 11) + 2) + 'pt' } }), 'font-shrink': () => editor.applyInline({ style: { fontSize: Math.max(6, (editor.getFormat().fontSize || 11) - 2) + 'pt' } }),
    'highlight': anchor => palette('highlight', anchor), 'font-color': anchor => palette('font', anchor), 'paragraph-color': anchor => palette('paragraph', anchor),
    'line-spacing': anchor => showPopover('<div class="popover-label">Line spacing</div>' + [1, 1.15, 1.5, 1.65, 2, 2.5, 3].map(n => `<button class="menu-item" data-line-spacing="${n}">${n.toFixed(2)}<small>${n === 1.65 ? 'Default' : ''}</small></button>`).join(''), anchor),
    'case': anchor => showPopover(['Sentence case', 'lowercase', 'UPPERCASE', 'Capitalize Each Word'].map((t, i) => `<button class="menu-item" data-text-case="${i}">${t}</button>`).join(''), anchor),
    'marks': () => { document.body.classList.toggle('show-marks'); renderer.invalidate(); toast(document.body.classList.contains('show-marks') ? 'Paragraph marks are visible.' : 'Paragraph marks are hidden.'); },
    'copy': async () => { const text = editor.selectedText(); if (!text) {
        toast('Select text to copy.');
        return;
    } try {
        await navigator.clipboard.writeText(text);
        toast('Copied to clipboard.');
    }
    catch {
        toast('Use Ctrl+C or ⌘C to copy the selected text.');
    } },
    'cut': async () => { const text = editor.selectedText(); if (!text) {
        toast('Select text to cut.');
        return;
    } try {
        await navigator.clipboard.writeText(text);
        editor.transaction('cut', () => { editor.deleteSelection(editor.range()); });
        toast('Cut to clipboard.');
    }
    catch {
        toast('Use Ctrl+X or ⌘X to cut the selected text.');
    } },
    'paste': async () => { try {
        const text = await navigator.clipboard.readText();
        if (text)
            editor.insertText(text);
        else
            toast('Your clipboard is empty.');
    }
    catch {
        toast('Click in the document and press Ctrl+V or ⌘V to paste.');
    } },
    'format-painter': () => { const format = editor.getFormat(); formatPainter = { fontWeight: format.bold ? '700' : '400', fontStyle: format.italic ? 'italic' : 'normal', textDecoration: format.underline ? 'underline' : 'none', fontFamily: format.fontFamily || 'Segoe UI', fontSize: (format.fontSize || 11) + 'pt' }; toast('Select another passage to apply this formatting.'); },
    'select-all': () => { editor.focusRange(); const r = document.createRange(); r.setStart(root.firstElementChild.querySelector('.page-content'), 0); const last = root.lastElementChild.querySelector('.page-content'); r.setEnd(last, last.childNodes.length); getSelection().removeAllRanges(); getSelection().addRange(r); editor.onSelection(); },
    find: () => { document.body.classList.remove('no-navigation'); $('#navigation').classList.add('mobile-open'); $('#nav-search').focus(); $('#nav-search').select(); },
    replace: () => { actions.find(); $('#replace-controls').hidden = false; },
    'replace-one': () => { if (!search.matches.length)
        return; ensureEditing(); search.go(Math.max(0, search.index)); editor.onSelection(); editor.insertText($('#replace-input').value); runSearch(searchTerm); },
    'replace-all': () => { if (!search.matches.length)
        return; ensureEditing(); const ranges = search.matches.map(m => m.range.cloneRange()), replacement = $('#replace-input').value; editor.transaction('replace all', () => { for (const r of ranges.reverse()) {
        r.deleteContents();
        r.insertNode(document.createTextNode(replacement));
    } }); runSearch(searchTerm); toast(`Replaced ${ranges.length} occurrence${ranges.length === 1 ? '' : 's'}.`); },
    'toggle-navigation': () => { if (innerWidth <= 800)
        $('#navigation').classList.toggle('mobile-open');
    else
        document.body.classList.toggle('no-navigation'); renderer.schedule(); },
    'comments': () => togglePanel('comments'), 'insights': () => togglePanel('insights'), 'review-changes': () => togglePanel('changes'),
    'add-comment': () => { ensureEditing(); const quote = editor.selectedText().slice(0, 500), range = editor.range().cloneRange(); formModal('A thoughtful note', `${quote ? `<div class="comment-quote">${escapeHTML(quote)}</div>` : ''}<label for="comment-text">Your comment</label><textarea id="comment-text" name="text" required maxlength="20000" placeholder="Share a thought, ask a question…"></textarea>`, ({ text }) => { const id = uid(); if (quote) {
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        editor.applyInline({ tag: 'mark', attrs: { 'data-comment': id } }, false, false);
    } store.transact('comment', d => { d.comments.push({ id, text, quote, author: 'You', time: new Date().toISOString(), resolved: false }); d.pages = paginator.getPages(); }); activePanel = 'comments'; renderPanel(); }, 'Post comment'); },
    'insert-page': () => { ensureEditing(); editor.insertHTML('<div class="page-break"><br></div><p><br></p>', { block: true, kind: 'insert page' }); },
    'page-break': () => { ensureEditing(); editor.insertHTML('<div class="page-break"><br></div>', { block: true, kind: 'page break' }); },
    'insert-table': anchor => { showPopover(`<div class="table-size-label">Insert a table · <span id="table-dimensions">3 × 3</span></div><div class="table-grid">${Array.from({ length: 48 }, (_, i) => `<button data-table-rows="${Math.floor(i / 8) + 1}" data-table-cols="${i % 8 + 1}" title="${i % 8 + 1} columns × ${Math.floor(i / 8) + 1} rows" aria-label="${i % 8 + 1} columns and ${Math.floor(i / 8) + 1} rows"></button>`).join('')}</div>`, anchor); },
    'table-add-row': () => { const cell = getSelectedCell(), table = getSelectedTable(); if (!table) {
        toast('Place the caret in a table first.');
        return;
    } editor.transaction('table row', () => { const row = table.insertRow(cell ? cell.parentElement.rowIndex + 1 : -1); for (let i = 0; i < table.rows[0].cells.length; i++)
        row.insertCell().innerHTML = '<br>'; caretAt(row.cells[0], false); }); },
    'table-add-column': () => { const cell = getSelectedCell(), table = getSelectedTable(); if (!table) {
        toast('Place the caret in a table first.');
        return;
    } editor.transaction('table column', () => { const index = cell ? cell.cellIndex + 1 : table.rows[0].cells.length; for (const row of table.rows)
        row.insertCell(Math.min(index, row.cells.length)).innerHTML = '<br>'; }); },
    'table-delete': () => { const table = getSelectedTable(); if (!table) {
        toast('Place the caret in a table first.');
        return;
    } editor.transaction('delete table', () => { const p = document.createElement('p'); p.innerHTML = '<br>'; table.replaceWith(p); caretAt(p, false); }); },
    image: () => { ensureEditing(); $('#image-input').click(); },
    link: () => { const quote = editor.selectedText(); formModal('Insert a link', `<label for="link-text">Text to display</label><input id="link-text" name="text" value="${escapeHTML(quote)}" placeholder="A useful resource" required><label for="link-url">Link</label><input id="link-url" name="url" type="url" placeholder="https://example.com" required>`, ({ text, url }) => { if (!safeURL(url)) {
        toast('Enter a valid http or https link.', true);
        return;
    } editor.insertHTML(`<a href="${escapeHTML(url)}" rel="noopener noreferrer">${escapeHTML(text)}</a>`); }); },
    'horizontal-rule': () => editor.insertHTML('<hr>', { block: true }),
    date: anchor => showPopover(`<div class="popover-label">Insert current date</div>` + [new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), new Date().toLocaleDateString('en-GB'), new Date().toISOString().slice(0, 10), new Date().toLocaleString('en-US')].map(v => `<button class="menu-item" data-insert-text="${escapeHTML(v)}">${escapeHTML(v)}</button>`).join(''), anchor),
    symbol: anchor => showPopover(`<div class="popover-label">Symbols</div><div style="display:grid;grid-template-columns:repeat(6,38px);gap:3px;padding:8px">${['©', '®', '™', '°', '±', '×', '÷', '≤', '≥', '≠', '∞', '√', 'α', 'β', 'γ', 'δ', 'π', 'Σ', 'Ω', '→', '←', '✓', '•', '§', '€', '£', '¥', '½', '¼', '—'].map(s => `<button data-insert-text="${s}" style="height:33px;font-size:20px" title="Insert ${s}">${s}</button>`).join('')}</div>`, anchor),
    equation: () => formModal('Insert an equation', '<p>Enter a Unicode equation. The expression remains editable text, not a symbolic math object.</p><label for="equation">Expression</label><input id="equation" name="expression" value="E = mc²" required>', ({ expression }) => editor.insertHTML(`<p style="font-family:Georgia;font-size:20px;text-align:center">${escapeHTML(expression)}</p>`, { block: true })),
    chart: () => formModal('Insert a chart', '<label for="chart-title">Chart title</label><input name="title" id="chart-title" value="Quarterly progress" required><label for="chart-data">One label and value per line</label><textarea name="data" id="chart-data">Q1, 24\nQ2, 42\nQ3, 68\nQ4, 85</textarea><p>The inserted chart is an embedded image. Reinsert it to change the data.</p>', ({ title, data }) => { const rows = data.split('\n').map(line => { const [label, v] = line.split(','); return { label: label?.trim(), value: Number(v) }; }).filter(r => r.label && Number.isFinite(r.value) && r.value >= 0).slice(0, 12); if (!rows.length) {
        toast('Enter at least one valid label and numeric value.', true);
        return;
    } const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 520; const c = canvas.getContext('2d'); c.fillStyle = '#f5f8fa'; c.fillRect(0, 0, 1000, 520); c.fillStyle = '#32546c'; c.font = '600 28px Arial'; c.fillText(title, 45, 53); const max = Math.max(1, ...rows.map(r => r.value)), barWidth = Math.min(130, 790 / rows.length - 20); c.font = '18px Arial'; rows.forEach((r, i) => { const x = 85 + i * (830 / rows.length), h = 300 * r.value / max; c.fillStyle = store.document.layout.accent; c.fillRect(x, 410 - h, barWidth, h); c.fillStyle = '#658395'; c.fillText(r.label.slice(0, 12), x, 447); c.fillText(String(r.value), x, 397 - h); }); editor.insertHTML(`<p><img src="${canvas.toDataURL()}" alt="${escapeHTML(title)}" style="width:590px;max-width:100%"></p>`, { block: true }); }),
    header: () => formModal('Document header', `<label for="header-text">Header on every page</label><input id="header-text" name="text" maxlength="300" value="${escapeHTML(store.document.layout.header)}" placeholder="Team name · Project name">`, ({ text }) => changeLayout({ header: text }), 'Apply'),
    footer: () => { changeLayout({ footer: !store.document.layout.footer }); toast(store.document.layout.footer ? 'Page numbers are visible.' : 'Page numbers are hidden.'); },
    margins: anchor => showPopover([['Normal', 70, 65, 74, 74], ['Narrow', 38, 38, 38, 38], ['Wide', 80, 80, 110, 110]].map(([label, top, bottom, left, right]) => `<button class="menu-item" data-margins="${top},${bottom},${left},${right}">${icon('layout')}${label}</button>`).join('') + '<hr>' + menuItem('page-setup', 'ruler', 'Custom margins…'), anchor),
    orientation: anchor => showPopover(`<button class="menu-item" data-orientation="portrait">${icon('page')}Portrait</button><button class="menu-item" data-orientation="landscape">${icon('layout')}Landscape</button>`, anchor),
    'paper-size': anchor => showPopover([['A4', 794, 1123, '210 × 297 mm'], ['Letter', 816, 1056, '8.5 × 11 in'], ['Legal', 816, 1344, '8.5 × 14 in']].map(([name, w, h, label]) => `<button class="menu-item" data-paper-size="${name},${w},${h}">${icon('file')}${name}<small>${label}</small></button>`).join(''), anchor),
    'page-setup': () => { const l = store.document.layout; formModal('Page setup', `<div class="field-row"><div><label>Paper size</label><select name="size">${['A4', 'Letter', 'Legal'].map(v => `<option${v === l.size ? ' selected' : ''}>${v}</option>`).join('')}</select></div><div><label>Orientation</label><select name="orientation"><option value="portrait"${l.orientation === 'portrait' ? ' selected' : ''}>Portrait</option><option value="landscape"${l.orientation === 'landscape' ? ' selected' : ''}>Landscape</option></select></div></div><label>Margins in pixels (96 px = 1 inch)</label><div class="field-row">${['top', 'bottom', 'left', 'right'].map(k => `<div><label>${k[0].toUpperCase() + k.slice(1)}</label><input name="${k}" type="number" min="15" max="220" value="${l[k]}" required></div>`).join('')}</div>`, data => { const [w, h] = ({ A4: [794, 1123], Letter: [816, 1056], Legal: [816, 1344] })[data.size]; changeLayout({ ...data, width: data.orientation === 'portrait' ? w : h, height: data.orientation === 'portrait' ? h : w, top: Number(data.top), bottom: Number(data.bottom), left: Number(data.left), right: Number(data.right) }); }, 'Apply'); },
    'font-modern': () => changeLayout({ font: 'Segoe UI' }), 'font-editorial': () => changeLayout({ font: 'Georgia' }), 'font-classic': () => changeLayout({ font: 'Times New Roman' }), 'spacing-compact': () => changeLayout({ lineHeight: 1.35 }), 'spacing-relaxed': () => changeLayout({ lineHeight: 1.8 }),
    'insert-toc': () => { const items = headings(); if (!items.length) {
        toast('Add heading styles before inserting a table of contents.');
        return;
    } editor.insertHTML(`<div data-kind="toc"><h2>Contents</h2>${items.map(h => `<p style="margin-left:${h.level === 2 ? 18 : 0}px"><a href="#heading-${h.index}">${escapeHTML(h.text)}</a></p>`).join('')}</div>`, { block: true, kind: 'table of contents' }); },
    'update-toc': () => { const toc = $('[data-kind="toc"]', root); if (!toc) {
        actions['insert-toc']();
        return;
    } editor.transaction('update table of contents', () => { const items = headings().filter(h => !toc.contains(h.el)); toc.innerHTML = '<h2>Contents</h2>' + items.map(h => `<p style="margin-left:${h.level === 2 ? 18 : 0}px"><a href="#heading-${h.index}">${escapeHTML(h.text)}</a></p>`).join(''); }); toast('Table of contents updated.'); },
    endnote: () => formModal('Insert an endnote', '<label for="endnote-text">Note</label><textarea id="endnote-text" name="text" required placeholder="Add a reference or a little more context…"></textarea>', ({ text }) => { const n = $$('[data-kind="endnote"]', root).length + 1; editor.insertHTML(`<sup><a href="#endnote-${n}">${n}</a></sup>`); editor.transaction('endnote', () => { const p = document.createElement('p'); p.dataset.kind = 'endnote'; p.id = 'endnote-' + n; p.className = 'caption'; p.innerHTML = `<strong>${n}.</strong> ${escapeHTML(text)}`; root.lastElementChild.querySelector('.page-content').append(p); }); }),
    citation: () => formModal('Insert a citation', '<label>Author</label><input name="author" required placeholder="Author or organization"><label>Title</label><input name="title" required placeholder="Publication title"><label>Year</label><input name="year" type="number" min="1000" max="2200" value="2026"><label>URL (optional)</label><input name="url" type="url" placeholder="https://">', ({ author, title, year, url }) => editor.insertHTML(`<p class="caption">${escapeHTML(author)} (${escapeHTML(year)}). <em>${escapeHTML(title)}</em>. ${safeURL(url) ? `<a href="${escapeHTML(url)}">${escapeHTML(url)}</a>` : ''}</p>`, { block: true })),
    caption: () => formModal('Insert a caption', '<label>Caption</label><input name="text" required placeholder="Figure 1. A useful description">', ({ text }) => editor.insertHTML(`<p class="caption">${escapeHTML(text)}</p>`, { block: true })),
    spelling: () => { $$('.page-content', root).forEach(p => p.spellcheck = !p.spellcheck); toast(root.querySelector('.page-content').spellcheck ? 'Browser spellcheck is enabled.' : 'Browser spellcheck is disabled.'); },
    'read-aloud': () => { if (!window.speechSynthesis) {
        toast('Read aloud is not supported by this browser.', true);
        return;
    } if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
        toast('Reading stopped.');
        return;
    } const text = editor.selectedText() || docText(), utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'en-US'; const voices = speechSynthesis.getVoices(), local = voices.find(v => v.localService && v.lang.startsWith('en')); if (local)
        utterance.voice = local; speechSynthesis.speak(utterance); toast('Reading aloud. Click Read aloud again to stop.'); },
    'track-changes': () => { ensureEditing(); store.transact('tracking', d => d.trackChanges = !d.trackChanges); renderRibbon(); activePanel = 'changes'; renderPanel(); toast(store.document.trackChanges ? 'Tracking typed text and text deletions.' : 'Text tracking is off.'); },
    'accept-changes': () => editor.resolveChanges(true), 'reject-changes': () => editor.resolveChanges(false),
    'edit-mode': () => setReading(false), 'read-mode': () => { editor.commit('typing', true); setReading(true); }, 'toggle-reading': () => { editor.commit('typing', true); setReading(!reading); },
    ruler: () => { $('#ruler-wrap').hidden = !$('#ruler-wrap').hidden; renderer.schedule(); },
    theme: () => { document.body.classList.toggle('dark'); try {
        localStorage.setItem('quire.dark', String(document.body.classList.contains('dark')));
    }
    catch { } renderer.schedule(); },
    focus: () => { document.body.classList.toggle('focus-mode'); renderer.schedule(); },
    'zoom-in': () => setZoom(zoom + 10), 'zoom-out': () => setZoom(zoom - 10), 'zoom-100': () => setZoom(100),
    'fit-width': () => setZoom((viewport.clientWidth - 90) / store.document.layout.width * 100), 'fit-page': () => setZoom(Math.min((viewport.clientWidth - 70) / store.document.layout.width, (viewport.clientHeight - 45) / store.document.layout.height) * 100),
    'zoom-dialog': () => formModal('Zoom', `<label>Zoom percentage</label><input name="zoom" type="number" min="40" max="180" value="${zoom}" required>`, ({ zoom }) => setZoom(Number(zoom)), 'Apply'),
    'goto-page': () => formModal('Go to page', `<label>Page number</label><input name="page" type="number" min="1" max="${root.children.length}" value="${currentPage}" required>`, ({ page }) => root.children[Number(page) - 1]?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 'Go'),
    'draw-select': () => setInkMode(null), 'draw-pen': () => setInkMode('pen'), 'draw-highlight': () => setInkMode('highlight'), 'draw-eraser': () => setInkMode('eraser'),
    'clear-ink': () => { const slot = root.children[currentPage - 1]; if (!slot?.ink?.length) {
        toast('There is no ink on this page.');
        return;
    } formModal('Clear this page’s ink', `<p>This removes all pen strokes from page ${currentPage}. You can undo the change.</p>`, () => { slot.ink = []; editor.commit('clear ink'); renderInk(); }, 'Clear ink'); },
    'export': anchor => { if (nativeExportBlocked()) return; showPopover(menuItem('export-docx', 'file', 'Word document', '.docx') + menuItem('export-quire', 'save', 'Document file', '.document') + menuItem('export-html', 'file', 'Web page', '.html') + menuItem('export-md', 'file', 'Markdown', '.md') + menuItem('export-txt', 'file', 'Plain text', '.txt') + '<hr>' + menuItem('print', 'print', 'Print / Save as PDF', 'Ctrl P'), anchor); },
    'more-tabs': anchor => { const expanded = anchor.getAttribute('aria-expanded') === 'true'; anchor.setAttribute('aria-expanded', String(!expanded)); anchor.setAttribute('aria-label', expanded ? 'Show more tabs' : 'Hide extra tabs'); $$('.ribbon-tabs [data-tab][hidden], .ribbon-tabs [data-tab].extra-tab').forEach(button => { button.hidden = expanded; button.classList.add('extra-tab'); }); anchor.classList.toggle('active', expanded && !['Home', 'Insert'].includes(activeTab)); },
    'export-quire': () => { if (nativeExportBlocked()) return; editor.commit('typing', true); downloadFile(JSON.stringify(store.document, null, 2), store.document.title + '.document', 'application/json'); toast('Document exported.'); },
    'export-docx': () => { if (nativeExportBlocked()) return; editor.commit('typing', true); downloadFile(exportDocx(store.document, root, referenceStack), store.document.title + '.docx'); toast('Word document exported. Advanced layout may differ.'); },
    'export-html': () => { if (nativeExportBlocked()) return; editor.commit('typing', true); downloadFile(exportHTML(store.document, root, referenceStack), store.document.title + '.html', 'text/html'); toast('Self-contained HTML document exported.'); },
    'export-md': () => { if (nativeExportBlocked()) return; downloadFile(exportMarkdown(root) + referenceMarkdown(), store.document.title + '.md', 'text/markdown'); toast('Markdown exported.'); },
    'export-txt': () => { if (nativeExportBlocked()) return; downloadFile(docText() + (referenceStack ? '\n\n' + referenceText() : ''), store.document.title + '.txt', 'text/plain'); toast('Plain text exported.'); },
    print: () => { if (nativeExportBlocked()) return; editor.commit('typing', true); paginator.reflow(); setTimeout(() => window.print(), 80); },
    open: () => $('#file-input').click(),
    file: async () => { let recent = []; try {
        recent = (await repository.list()).filter(d => d.id !== store.document.id).slice(0, 4);
    }
    catch { } showModal('Your workspace', `<p class="file-intro">A fresh page. A clearer idea.</p><p class="file-caption">Start with a little structure, or make space for something entirely new.</p><div class="template-grid">${[['blank', 'Blank document', 'Start with possibility'], ['report', 'The clarity report', 'An editorial report'], ['brief', 'Project brief', 'Give your team a direction'], ['notes', 'Meeting notes', 'Keep the good ideas']].map(([id, title, description]) => `<button class="template-card" data-template="${id}"><div class="template-preview"><div class="mini-paper">${id === 'blank' ? '<span style="display:block;text-align:center;margin-top:24px;color:#bcc9d4;font-size:22px">+</span>' : `<b>${id === 'report' ? 'A little<br>clarity.' : id === 'brief' ? 'A clear<br>beginning.' : 'Notes worth<br>keeping.'}</b><i></i><i style="width:80%"></i>${id === 'report' ? '<div class="mini-accent"></div>' : ''}<i></i><i></i><i style="width:65%"></i>`}</div></div><div class="template-description">${title}<span>${description}</span></div></button>`).join('')}</div>${recent.length ? '<div class="popover-label" style="padding-left:0">Recent documents on this device</div>' + recent.map(d => `<button class="menu-item" style="display:flex;justify-content:flex-start;padding:7px 0;width:100%;font-size:12px" data-open-document="${d.id}">${icon('file', 16)}${escapeHTML(d.title)}<small style="margin-left:auto;color:#93a1ae">${new Date(d.modifiedAt).toLocaleDateString()}</small></button>`).join('') : ''}<div class="file-bottom"><button class="secondary" data-action="open">${icon('folder', 16)}Open a document</button><button class="secondary" data-action="export-quire">${icon('download', 16)}Save a portable copy</button></div><p style="font-size:10px;margin:13px 0 0">Open .docx, .document, .html, .md, or .txt. Your work stays in this browser unless you export it.</p>`, { wide: true }); },
    about: () => { const s = renderer.stats; showModal('Document renderer', `<div class="insight-grid"><div><strong style="font-size:20px">${s.backend}</strong><span>Active compositor</span></div><div><strong>${s.drawCalls}</strong><span>Last frame draw calls</span></div><div><strong>${(s.textureBytes / 1048576).toFixed(1)} MB</strong><span>Reading texture cache</span></div><div><strong>${s.visiblePages}</strong><span>Visible pages</span></div></div>${s.lastError ? `<div class="tip-box"><strong>Renderer diagnostic</strong>${escapeHTML(s.lastError)}</div>` : ''}`); },
});
for (const action of ['comments', 'add-comment', 'review-changes', 'track-changes', 'accept-changes', 'reject-changes']) delete actions[action];
function runSearch(term) { searchTerm = term; search.find(term); $('#search-status').hidden = !term; $('#search-status').textContent = search.matches.length ? `${search.matches.length} result${search.matches.length === 1 ? '' : 's'} · Enter for next` : 'No results'; if (term) {
    navTab = 'results';
    $$('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === navTab));
} renderNavigation(); if (search.matches.length)
    search.go(0); }
$('#nav-search').addEventListener('input', debounce(e => runSearch(e.target.value), 140));
$('#nav-search').addEventListener('keydown', e => { if (e.key === 'Enter') {
    e.preventDefault();
    search.go(search.index + (e.shiftKey ? -1 : 1));
} if (e.key === 'Escape') {
    e.target.value = '';
    runSearch('');
} });
// Prevent toolbar presses from collapsing the user's text selection.
document.addEventListener('pointerdown', e => { const button = e.target.closest('button'); if (button && (button.closest('.ribbon') || button.closest('.popover') || button.closest('.menu-row') || button.closest('.titlebar')) && getSelection()?.rangeCount) {
    editor.onSelection();
    e.preventDefault();
} if (!e.target.closest('#popover') && !e.target.closest('[data-action]'))
    hidePopover(); });
document.addEventListener('click', async (e) => {
    const el = e.target.closest('button');
    if (!el)
        return;
    try {
        if (el.dataset.tab) {
            hidePopover();
            renderRibbon(el.dataset.tab);
            return;
        }
        if (el.dataset.action) {
            const wasPopover = !!el.closest('#popover');
            if (wasPopover)
                hidePopover();
            await actions[el.dataset.action]?.(el);
            return;
        }
        if (el.dataset.style) {
            editor.setBlock(el.dataset.style);
            return;
        }
        if (el.dataset.nav) {
            navTab = el.dataset.nav;
            $$('[data-nav]').forEach(b => b.classList.toggle('active', b === el));
            renderNavigation();
            return;
        }
        if (el.dataset.heading !== undefined) {
            const h = headings().find(h => h.index === Number(el.dataset.heading));
            h?.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            $$('[data-heading]').forEach(b => b.classList.toggle('active', b === el));
            return;
        }
        if (el.dataset.gotoPage) {
            root.children[Number(el.dataset.gotoPage) - 1]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
            return;
        }
        if (el.dataset.searchResult !== undefined) {
            search.go(Number(el.dataset.searchResult));
            return;
        }
        if (el.dataset.color) {
            const color = el.dataset.color, kind = el.dataset.colorKind;
            hidePopover();
            if (kind === 'font')
                editor.applyInline({ style: { color: color === 'transparent' ? '#3d4d5c' : color } });
            else if (kind === 'paragraph')
                editor.setBlockStyle({ backgroundColor: color });
            else
                editor.applyInline({ style: { backgroundColor: color } });
            return;
        }
        if (el.dataset.lineSpacing) {
            hidePopover();
            editor.setBlockStyle({ lineHeight: el.dataset.lineSpacing });
            return;
        }
        if (el.dataset.textCase) {
            hidePopover();
            const original = editor.selectedText();
            if (!original) {
                toast('Select the text to change first.');
                return;
            }
            const type = Number(el.dataset.textCase);
            const text = type === 0 ? original[0].toUpperCase() + original.slice(1).toLowerCase() : type === 1 ? original.toLowerCase() : type === 2 ? original.toUpperCase() : original.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase());
            editor.insertText(text);
            return;
        }
        if (el.dataset.tableRows) {
            hidePopover();
            const rows = Number(el.dataset.tableRows), cols = Number(el.dataset.tableCols);
            editor.insertHTML('<table><tbody>' + Array.from({ length: rows }, (_, r) => '<tr>' + Array.from({ length: cols }, (_, c) => r === 0 ? `<th>Column ${c + 1}</th>` : '<td><br></td>').join('') + '</tr>').join('') + '</tbody></table>', { block: true, kind: 'insert table' });
            return;
        }
        if (el.dataset.insertText !== undefined) {
            hidePopover();
            editor.insertText(el.dataset.insertText);
            return;
        }
        if (el.dataset.margins) {
            hidePopover();
            const [top, bottom, left, right] = el.dataset.margins.split(',').map(Number);
            changeLayout({ top, bottom, left, right });
            return;
        }
        if (el.dataset.orientation) {
            hidePopover();
            const l = store.document.layout, landscape = el.dataset.orientation === 'landscape';
            changeLayout({ orientation: el.dataset.orientation, width: landscape ? Math.max(l.width, l.height) : Math.min(l.width, l.height), height: landscape ? Math.min(l.width, l.height) : Math.max(l.width, l.height) });
            return;
        }
        if (el.dataset.paperSize) {
            hidePopover();
            const [size, w, h] = el.dataset.paperSize.split(',');
            const landscape = store.document.layout.orientation === 'landscape';
            changeLayout({ size, width: Number(landscape ? h : w), height: Number(landscape ? w : h) });
            return;
        }
        if (el.dataset.accent) {
            changeLayout({ accent: el.dataset.accent });
            return;
        }
        if (el.dataset.inkColor) {
            inkColor = el.dataset.inkColor;
            toast('Ink color updated.');
            return;
        }
        if (el.dataset.template) {
            await openTemplate(el.dataset.template);
            return;
        }
        if (el.dataset.openDocument) {
            if (!await saveNow())
                return;
            const doc = await repository.get(el.dataset.openDocument);
            if (doc) {
                closeModal(false);
                store.replace(doc);
                viewport.scrollTop = 0;
            }
            return;
        }
        if (el.dataset.resolveComment) {
            store.transact('resolve comment', d => { const c = d.comments.find(c => c.id === el.dataset.resolveComment); if (c)
                c.resolved = !c.resolved; });
            return;
        }
        if (el.dataset.deleteComment) {
            const id = el.dataset.deleteComment;
            store.transact('delete comment', d => { d.comments = d.comments.filter(c => c.id !== id); $$(`[data-comment="${CSS.escape(id)}"]`, root).forEach(n => n.replaceWith(...n.childNodes)); d.pages = paginator.getPages(); });
            return;
        }
        if (el.dataset.changeIndex !== undefined) {
            const n = $$('ins[data-change],del[data-change]', root)[Number(el.dataset.changeIndex)];
            if (n)
                editor.transaction('resolve revision', () => { if ((n.tagName === 'INS') === (el.dataset.accept === 'true'))
                    n.replaceWith(...n.childNodes);
                else
                    n.remove(); });
            return;
        }
    }
    catch (error) {
        console.error(error);
        toast(error.message || 'The action could not be completed.', true);
    }
});
popover.addEventListener('pointerover', e => { const cell = e.target.closest('[data-table-rows]'); if (!cell)
    return; const rows = Number(cell.dataset.tableRows), cols = Number(cell.dataset.tableCols); $('#table-dimensions').textContent = `${cols} × ${rows}`; $$('[data-table-rows]', popover).forEach(b => b.classList.toggle('selected', Number(b.dataset.tableRows) <= rows && Number(b.dataset.tableCols) <= cols)); });
ribbon.addEventListener('change', e => { try {
    if (e.target.id === 'font-family')
        editor.applyInline({ style: { fontFamily: e.target.value } });
    if (e.target.id === 'font-size')
        editor.applyInline({ style: { fontSize: e.target.value + 'pt' } });
    if (e.target.id === 'ink-width')
        inkWidth = Number(e.target.value);
    if (e.target.id === 'space-before')
        editor.setBlockStyle({ marginTop: e.target.value + 'pt' });
    if (e.target.id === 'space-after')
        editor.setBlockStyle({ marginBottom: e.target.value + 'pt' });
}
catch (error) {
    toast(error.message, true);
} });
$('#zoom').addEventListener('input', e => setZoom(Number(e.target.value)));
$('#document-title').addEventListener('change', e => { store.transact('rename', d => d.title = e.target.value.trim() || 'Untitled document'); paginator.updateFurniture(); });
$('#document-title').addEventListener('keydown', e => { if (e.key === 'Enter')
    e.target.blur(); });
$('#file-input').addEventListener('change', async (e) => { const file = e.target.files[0]; e.target.value = ''; if (!file)
    return; try {
    const doc = await importFile(file);
    if (!await saveNow())
        return;
    if (modal.open)
        closeModal(false);
    setReading(false);
    store.replace(doc);
    viewport.scrollTop = 0;
    toast(file.name.endsWith('.docx') ? 'Word document imported. Advanced layout may differ.' : 'Document opened.');
}
catch (error) {
    toast(error.message, true);
} });
async function insertImageFile(file) { if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type))
    throw new Error('Choose a PNG, JPEG, WebP, or GIF image.'); if (file.size > 12 * 1024 * 1024)
    throw new Error('Please choose an image smaller than 12 MB.'); const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }); editor.insertHTML(`<p><img src="${data}" alt="${escapeHTML(file.name)}" style="max-width:100%"></p>`, { block: true, kind: 'insert image' }); toast('Picture inserted. Double-click it to set its size.'); }
$('#image-input').addEventListener('change', async (e) => { const file = e.target.files[0]; e.target.value = ''; try {
    await insertImageFile(file);
}
catch (error) {
    toast(error.message, true);
} });
editor.on('drop', async (e) => { const file = e.dataTransfer.files[0]; if (!file)
    return; try {
    if (file.type.startsWith('image/'))
        await insertImageFile(file);
    else {
        const doc = await importFile(file);
        if (await saveNow())
            store.replace(doc);
    }
}
catch (error) {
    toast(error.message, true);
} });
root.addEventListener('dblclick', e => { const image = e.target.closest('.page-content img'); if (!image)
    return; selectedImage = image; formModal('Picture size & description', `<label>Width in pixels</label><input name="width" type="number" min="20" max="1200" value="${Math.round(image.getBoundingClientRect().width / (zoom / 100))}" required><label>Alternative text</label><input name="alt" value="${escapeHTML(image.alt)}">`, ({ width, alt }) => editor.transaction('resize image', () => { image.style.width = width + 'px'; image.style.height = 'auto'; image.alt = alt; }), 'Apply'); });
root.addEventListener('click', e => { const link = e.target.closest('a'); if (link) {
    e.preventDefault();
    if (link.hash) {
        const target = root.querySelector('#' + CSS.escape(link.hash.slice(1)));
        target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    else if ((e.ctrlKey || e.metaKey) && safeURL(link.href))
        window.open(link.href, '_blank', 'noopener,noreferrer');
} });
root.addEventListener('pointerup', () => { if (formatPainter && getSelection()?.toString()) {
    const style = formatPainter;
    formatPainter = null;
    editor.applyInline({ style });
    toast('Formatting applied.');
} });
root.addEventListener('pointerdown', e => {
    if (!inkMode)
        return;
    const layer = e.target.closest('.ink-layer');
    if (!layer)
        return;
    e.preventDefault();
    const slot = layer.closest('.paper-slot');
    if (inkMode === 'eraser') {
        const stroke = e.target.closest('[data-stroke]');
        if (stroke) {
            slot.ink = slot.ink.filter(s => s.id !== stroke.dataset.stroke);
            editor.commit('erase ink');
            renderInk();
        }
        return;
    }
    const r = layer.getBoundingClientRect(), point = [(e.clientX - r.left) / (zoom / 100), (e.clientY - r.top) / (zoom / 100)];
    activeStroke = { id: uid(), color: inkMode === 'highlight' ? '#e5c452' : inkColor, width: inkMode === 'highlight' ? Math.max(15, inkWidth * 4) : inkWidth, opacity: inkMode === 'highlight' ? .35 : 1, points: [point] };
    slot.ink ??= [];
    slot.ink.push(activeStroke);
    layer.setPointerCapture(e.pointerId);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.dataset.stroke = activeStroke.id;
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', activeStroke.color);
    path.setAttribute('stroke-width', activeStroke.width);
    path.setAttribute('stroke-opacity', activeStroke.opacity);
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('d', inkPath(activeStroke.points));
    layer.append(path);
});
root.addEventListener('pointermove', e => { if (!activeStroke)
    return; const layer = e.target.closest('.ink-layer'); if (!layer)
    return; const r = layer.getBoundingClientRect(); const events = e.getCoalescedEvents?.() || [e]; for (const event of events) {
    const p = [(event.clientX - r.left) / (zoom / 100), (event.clientY - r.top) / (zoom / 100)], last = activeStroke.points.at(-1);
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) > .6)
        activeStroke.points.push(p);
} layer.querySelector(`[data-stroke="${activeStroke.id}"]`)?.setAttribute('d', inkPath(activeStroke.points)); });
function endStroke() { if (activeStroke) {
    activeStroke = null;
    editor.commit('draw ink');
    renderInk();
} }
root.addEventListener('pointerup', endStroke);
root.addEventListener('pointercancel', endStroke);
document.addEventListener('keydown', e => { const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase(), inInput = !!e.target.closest('input,textarea,select'), inModal = modal.open; if (e.key === 'Escape') {
    hidePopover();
    if (inModal) {
        closeModal();
        return;
    }
    if (inkMode) {
        setInkMode(null);
        return;
    }
    document.body.classList.remove('focus-mode');
    $('#navigation').classList.remove('mobile-open');
    if (activePanel) {
        activePanel = null;
        renderPanel();
    }
    renderer.schedule();
    return;
} if (!mod || inModal)
    return; const hotkeys = { s: 'save', p: 'print', f: 'find', h: 'replace' }; if (key === 'k' && e.shiftKey) hotkeys.k = 'link'; if (hotkeys[key]) {
    e.preventDefault();
    actions[hotkeys[key]]?.();
    return;
} if (inInput)
    return; if (key === 'z') {
    e.preventDefault();
    actions[e.shiftKey ? 'redo' : 'undo']();
}
else if (key === 'y') {
    e.preventDefault();
    actions.redo();
}
else if (['b', 'i', 'u'].includes(key)) {
    e.preventDefault();
    actions[{ b: 'bold', i: 'italic', u: 'underline' }[key]]();
}
else if (e.key === 'Enter') {
    e.preventDefault();
    actions['page-break']();
}
else if (key === 'a' && e.target.closest('.page-content')) {
    e.preventDefault();
    actions['select-all']();
} });
modal.addEventListener('cancel', e => { e.preventDefault(); closeModal(); });
modal.addEventListener('click', e => { if (e.target === modal) {
    const rect = modal.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)
        closeModal();
} });
window.addEventListener('beforeunload', e => { editor.commit('typing', true); if (store.revision !== store.cleanRevision) {
    e.preventDefault();
    e.returnValue = '';
} });
document.addEventListener('visibilitychange', () => { if (document.hidden) {
    editor.commit('typing', true);
    saveNow();
} });
renderer.on('ready', () => { $('#engine-status').classList.add('ready'); $('#engine-status').innerHTML = '<span class="engine-dot"></span><span>WebGPU accelerated</span>'; });
renderer.on('fallback', reason => { $('#engine-status').classList.remove('ready'); $('#engine-status').innerHTML = '<span class="engine-dot"></span><span>DOM renderer</span>'; $('#engine-status').title = reason; });
let snapshotErrorShown = false;
renderer.on('snapshot-error', message => { if (!snapshotErrorShown) {
    snapshotErrorShown = true;
    toast('GPU snapshot unavailable; the document remains visible with DOM rendering.');
    console.warn('Snapshot:', message);
} });
try {
    if (localStorage.getItem('quire.dark') === 'true')
        document.body.classList.add('dark');
}
catch { }
hydrateIcons();
applyLayout();
setZoom(zoom, false);
paginator.render();
await document.fonts.ready;
paginator.reflow();
store.document.pages = paginator.getPages();
renderInk();
renderRibbon();
renderNavigation();
scheduleStats();
updatePageStatus();
$$('[data-action="undo"],[data-action="redo"]').forEach(b => b.disabled = true);
if (innerWidth < 1000)
    setZoom(Math.min(85, (viewport.clientWidth - 50) / store.document.layout.width * 100), false);
await renderer.initialize();
await saveNow();
window.quire = { store, editor, paginator, renderer, search, repository, actions, statistics, createDocument: newDocument, importFile, sanitizeHTML, ready: true, get stats() { return stats; }, get reading() { return reading; }, get referenceRevision() { return referenceStack?.dataset.revision || null; }, setZoom, setReading, runSearch, setReferencePresentation, exportDocx: () => exportDocx(store.document, root, referenceStack), exportHTML: () => exportHTML(store.document, root, referenceStack), exportMarkdown: () => exportMarkdown(root) + referenceMarkdown() };
