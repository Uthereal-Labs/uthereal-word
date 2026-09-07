/** Quire core. Native input + explicit Range transactions, without execCommand. */
export const uid = () => globalThis.crypto?.randomUUID?.() || `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export const escapeHTML = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const debounce = (fn, wait) => { let timer; const f = (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; f.cancel = () => clearTimeout(timer); return f; };
export const textNodes = root => { const out = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); while (w.nextNode())
    out.push(w.currentNode); return out; };
export function safeURL(value, image = false) { const s = String(value || '').trim(); if (image)
    return /^data:image\/(png|jpeg|gif|webp);base64,[a-z\d+/=\s]+$/i.test(s) ? s : ''; if (/^(https?:\/\/|mailto:|tel:|#)/i.test(s))
    return s; return ''; }
const allowedTags = new Set('P DIV SPAN H1 H2 H3 H4 H5 H6 B STRONG I EM U S STRIKE SUB SUP BR HR UL OL LI BLOCKQUOTE TABLE THEAD TBODY TFOOT TR TD TH IMG A MARK INS DEL FIGURE FIGCAPTION'.split(' '));
const allowedStyles = new Set('font-family font-size font-weight font-style text-decoration text-decoration-line text-align text-indent line-height letter-spacing color background-color vertical-align margin-left margin-right margin-top margin-bottom padding border border-top border-bottom border-left border-right border-color border-width border-style width height max-width border-collapse list-style-type white-space'.split(' '));
const allowedClasses = new Set('cover-title lead eyebrow byline metric-grid metric metric-value metric-label metric-note doc-header section-kicker callout caption chapter-title page-break'.split(' '));
export function sanitizeHTML(html) {
    const source = new DOMParser().parseFromString(String(html), 'text/html');
    const target = document.createElement('div');
    function copy(node, parent) {
        if (node.nodeType === Node.TEXT_NODE) {
            parent.append(document.createTextNode(node.textContent));
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE)
            return;
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'SVG', 'MATH', 'FORM', 'INPUT', 'TEXTAREA', 'BUTTON', 'TEMPLATE'].includes(node.tagName))
            return;
        if (!allowedTags.has(node.tagName)) {
            for (const child of node.childNodes)
                copy(child, parent);
            return;
        }
        const el = document.createElement(node.tagName.toLowerCase());
        for (const prop of node.style) {
            const value = node.style.getPropertyValue(prop);
            if (allowedStyles.has(prop) && !/(url\s*\(|expression\s*\(|javascript:|var\s*\()/i.test(value))
                el.style.setProperty(prop, value);
        }
        for (const c of node.classList)
            if (allowedClasses.has(c))
                el.classList.add(c);
        if (/^endnote-\d+$/.test(node.id))
            el.id = node.id;
        for (const key of ['data-flow', 'data-comment', 'data-change', 'data-kind'])
            if (node.hasAttribute(key))
                el.setAttribute(key, node.getAttribute(key).slice(0, 100));
        if (node.tagName === 'A') {
            const href = safeURL(node.getAttribute('href'));
            if (href) {
                el.href = href;
                el.rel = 'noopener noreferrer';
            }
        }
        if (node.tagName === 'IMG') {
            const src = safeURL(node.getAttribute('src'), true);
            if (!src)
                return;
            el.src = src;
            el.alt = node.getAttribute('alt') || 'Image';
        }
        for (const key of ['colspan', 'rowspan'])
            if (['TD', 'TH'].includes(node.tagName) && node.hasAttribute(key))
                el.setAttribute(key, String(Math.min(50, Math.max(1, Number(node.getAttribute(key)) || 1))));
        if (node.tagName === 'OL' && node.hasAttribute('start'))
            el.start = Math.max(1, Number(node.getAttribute('start')) || 1);
        if (node.tagName === 'DEL')
            el.contentEditable = 'false';
        for (const child of node.childNodes)
            copy(child, el);
        parent.append(el);
    }
    for (const child of source.body.childNodes)
        copy(child, target);
    for (const child of [...target.childNodes])
        if (child.nodeType === Node.TEXT_NODE) {
            if (child.textContent.trim()) {
                const p = document.createElement('p');
                child.replaceWith(p);
                p.append(child);
            }
            else
                child.remove();
        }
    return target.innerHTML;
}
export class Emitter {
    constructor() { this.handlers = new Map(); }
    on(name, fn) { if (!this.handlers.has(name))
        this.handlers.set(name, new Set()); this.handlers.get(name).add(fn); return () => this.handlers.get(name)?.delete(fn); }
    emit(name, value) { this.handlers.get(name)?.forEach(fn => fn(value)); }
}
const cloneDocument = doc => ({ ...doc, layout: { ...doc.layout }, pages: doc.pages.map(p => ({ ...p, ink: (p.ink || []).map(s => ({ ...s, points: s.points.map(p => [...p]) })) })), comments: doc.comments.map(c => ({ ...c })), view: { ...doc.view } });
export function newDocument(title = 'Untitled document', html = '<p><br></p>') { return { schema: 'quire', version: 1, id: uid(), title, createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString(), layout: { size: 'A4', orientation: 'portrait', width: 794, height: 1123, top: 70, bottom: 65, left: 74, right: 74, header: '', footer: true, accent: '#28766e', font: 'Segoe UI', fontSize: 14, lineHeight: 1.65 }, pages: [{ id: uid(), html, ink: [] }], comments: [], view: { zoom: 85 }, trackChanges: false }; }
const safeDate = value => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString(); };
const safeIdentifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : uid();
export function validateDocument(value) {
    if (!value || value.schema !== 'quire' || value.version !== 1 || !Array.isArray(value.pages) || value.pages.length > 1000)
        throw new Error('This is not a supported Quire document.');
    const base = newDocument();
    const d = { ...base, ...value, id: safeIdentifier(value.id), title: String(value.title || 'Untitled document').slice(0, 120), layout: { ...base.layout, ...value.layout }, comments: Array.isArray(value.comments) ? value.comments.slice(0, 5000).map(c => ({ id: safeIdentifier(c.id), text: String(c.text || '').slice(0, 20000), quote: String(c.quote || '').slice(0, 1000), author: String(c.author || 'You').slice(0, 100), time: safeDate(c.time), resolved: !!c.resolved })) : [], view: { ...base.view, ...value.view } };
    for (const k of ['width', 'height'])
        d.layout[k] = Math.max(300, Math.min(2200, Number(d.layout[k]) || base.layout[k]));
    for (const k of ['top', 'bottom', 'left', 'right'])
        d.layout[k] = Math.max(15, Math.min(220, Number(d.layout[k]) || base.layout[k]));
    if (d.layout.left + d.layout.right > d.layout.width - 100) {
        d.layout.left = 45;
        d.layout.right = 45;
    }
    if (d.layout.top + d.layout.bottom > d.layout.height - 150) {
        d.layout.top = 45;
        d.layout.bottom = 45;
    }
    d.createdAt = safeDate(d.createdAt);
    d.modifiedAt = safeDate(d.modifiedAt);
    d.layout.size = ['A4', 'Letter', 'Legal'].includes(d.layout.size) ? d.layout.size : 'A4';
    d.layout.orientation = d.layout.width > d.layout.height ? 'landscape' : 'portrait';
    d.layout.footer = !!d.layout.footer;
    d.trackChanges = !!d.trackChanges;
    d.view.zoom = Math.max(30, Math.min(200, Number(d.view.zoom) || 85));
    d.layout.font = String(d.layout.font).replace(/[{};<>\r\n]/g, '').slice(0, 100);
    d.layout.fontSize = Math.max(8, Math.min(64, Number(d.layout.fontSize) || 14));
    d.layout.lineHeight = Math.max(1, Math.min(3, Number(d.layout.lineHeight) || 1.65));
    d.layout.header = String(d.layout.header).slice(0, 300);
    d.layout.accent = /^#[0-9a-f]{6}$/i.test(d.layout.accent) ? d.layout.accent : '#28766e';
    d.pages = value.pages.map(p => ({ id: uid(), html: sanitizeHTML(p.html || '<p><br></p>'), ink: Array.isArray(p.ink) ? p.ink.slice(0, 5000).filter(s => Array.isArray(s.points)).map(s => ({ id: uid(), color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#245c88', width: Math.min(30, Math.max(1, Number(s.width) || 3)), opacity: Math.max(.05, Math.min(1, Number(s.opacity) || 1)), points: s.points.slice(0, 20000).filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map(p => [p[0], p[1]]) })) : [] }));
    if (!d.pages.length)
        d.pages = [{ id: uid(), html: '<p><br></p>', ink: [] }];
    return d;
}
export class DocumentStore extends Emitter {
    constructor(doc) { super(); this.document = doc; this.history = []; this.future = []; this.lastCommitTime = 0; this.lastKind = ''; this.revision = 0; this.cleanRevision = 0; }
    transact(kind, fn, { coalesce = false } = {}) { const now = performance.now(); if (!coalesce || kind !== this.lastKind || now - this.lastCommitTime > 900) {
        this.history.push({ doc: cloneDocument(this.document), kind });
        if (this.history.length > 75)
            this.history.shift();
    } fn(this.document); this.document.modifiedAt = new Date().toISOString(); this.lastCommitTime = now; this.lastKind = kind; this.future = []; this.revision++; this.emit('change', { kind, revision: this.revision }); }
    undo() { if (!this.history.length)
        return false; this.future.push({ doc: cloneDocument(this.document), kind: this.lastKind }); const prev = this.history.pop(); this.document = prev.doc; this.lastKind = ''; this.revision++; this.emit('replace', { kind: 'undo' }); this.emit('change', { kind: 'undo', revision: this.revision }); return true; }
    redo() { if (!this.future.length)
        return false; this.history.push({ doc: cloneDocument(this.document), kind: 'redo' }); this.document = this.future.pop().doc; this.lastKind = ''; this.revision++; this.emit('replace', { kind: 'redo' }); this.emit('change', { kind: 'redo', revision: this.revision }); return true; }
    replace(doc) { this.document = doc; this.history = []; this.future = []; this.lastKind = ''; this.revision++; this.emit('replace', { kind: 'open' }); this.emit('change', { kind: 'open', revision: this.revision }); }
}
export class DocumentRepository {
    constructor() { this.db = null; this.queue = Promise.resolve(); this.memory = new Map(); this.currentId = null; this.unavailable = false; }
    async open() { if (this.db)
        return this.db; if (this.unavailable)
        throw new Error('Persistent browser storage is unavailable.'); try {
        this.db = await new Promise((resolve, reject) => { const req = indexedDB.open('quire-workspace', 1); req.onupgradeneeded = () => { req.result.createObjectStore('documents', { keyPath: 'id' }); req.result.createObjectStore('settings'); }; req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
        return this.db;
    }
    catch (error) {
        this.unavailable = true;
        throw error;
    } }
    async save(doc) { const snapshot = cloneDocument(doc); this.memory.set(snapshot.id, snapshot); this.currentId = snapshot.id; const job = async () => { try {
        const db = await this.open();
        await new Promise((resolve, reject) => { const tx = db.transaction(['documents', 'settings'], 'readwrite'); tx.objectStore('documents').put(snapshot); tx.objectStore('settings').put(snapshot.id, 'current'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Save aborted')); });
        return { persisted: true };
    }
    catch (error) {
        return { persisted: false, error: error.message };
    } }; this.queue = this.queue.catch(() => { }).then(job); return this.queue; }
    async current() { try {
        const db = await this.open();
        const id = await new Promise((res, rej) => { const r = db.transaction('settings').objectStore('settings').get('current'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
        return id ? this.get(id) : null;
    }
    catch {
        return this.currentId ? this.memory.get(this.currentId) : null;
    } }
    async get(id) { if (this.memory.has(id))
        return cloneDocument(this.memory.get(id)); try {
        const db = await this.open();
        return await new Promise((res, rej) => { const r = db.transaction('documents').objectStore('documents').get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    }
    catch {
        return null;
    } }
    async list() { let saved = []; try {
        const db = await this.open();
        saved = await new Promise((res, rej) => { const r = db.transaction('documents').objectStore('documents').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    }
    catch { } const all = new Map(saved.map(d => [d.id, d])); for (const [id, d] of this.memory)
        all.set(id, d); return [...all.values()].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)); }
}
export function bookmarkSelection(root) {
    const sel = getSelection();
    if (!sel?.rangeCount || !root.contains(sel.anchorNode) || !root.contains(sel.focusNode))
        return null;
    const nodes = textNodes(root).filter(n => n.parentElement.closest('.page-content'));
    let offset = 0, start = null, end = null;
    for (const n of nodes) {
        if (n === sel.anchorNode)
            start = offset + sel.anchorOffset;
        if (n === sel.focusNode)
            end = offset + sel.focusOffset;
        offset += n.length;
    }
    // Element-boundary selections are converted using a DOM range rather than guessed.
    const abs = (node, off) => { let count = 0; const r = document.createRange(); r.setStart(root, 0); try {
        r.setEnd(node, off);
    }
    catch {
        return 0;
    } for (const n of nodes) {
        if (r.intersectsNode(n)) {
            if (n === node)
                count += off;
            else if (r.comparePoint(n, 0) <= 0)
                count += n.length;
        }
    } return count; };
    return { anchor: start ?? abs(sel.anchorNode, sel.anchorOffset), focus: end ?? abs(sel.focusNode, sel.focusOffset) };
}
export function restoreBookmark(root, mark) { if (!mark)
    return; const nodes = textNodes(root).filter(n => n.parentElement.closest('.page-content')); if (!nodes.length)
    return; const locate = (offset, nextBias = false) => { for (const n of nodes) {
    if (offset < n.length || (!nextBias && offset === n.length))
        return [n, Math.max(0, offset)];
    offset -= n.length;
} return [nodes.at(-1), nodes.at(-1).length]; }; const [a, ao] = locate(mark.anchor, mark.anchor < mark.focus), [f, fo] = locate(mark.focus, mark.focus < mark.anchor); try {
    getSelection().setBaseAndExtent(a, ao, f, fo);
}
catch { } }
export function caretAt(node, end = true) { const r = document.createRange(); r.selectNodeContents(node); r.collapse(!end); const s = getSelection(); s.removeAllRanges(); s.addRange(r); node.parentElement?.closest('[contenteditable=true]')?.focus({ preventScroll: true }); }
function positionAt(root, offset) { for (const n of textNodes(root)) {
    if (offset <= n.length)
        return [n, offset];
    offset -= n.length;
} const last = textNodes(root).at(-1); return last ? [last, last.length] : [root, root.childNodes.length]; }
export class Paginator {
    constructor(root, store) { this.root = root; this.store = store; this.busy = false; this.stats = { pages: 0, blocks: 0, lastMs: 0 }; }
    createPage(page) { const slot = document.createElement('div'); slot.className = 'paper-slot'; slot.dataset.pageId = page.id; const paper = document.createElement('article'); paper.className = 'paper'; paper.setAttribute('aria-label', 'Document page'); const header = document.createElement('div'); header.className = 'running-header'; const content = document.createElement('div'); content.className = 'page-content'; content.contentEditable = 'true'; content.spellcheck = true; content.setAttribute('role', 'textbox'); content.setAttribute('aria-multiline', 'true'); content.setAttribute('aria-label', 'Page content'); content.innerHTML = page.html || '<p><br></p>'; const footer = document.createElement('div'); footer.className = 'running-footer'; const ink = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); ink.classList.add('ink-layer'); ink.setAttribute('viewBox', `0 0 ${this.store.document.layout.width} ${this.store.document.layout.height}`); paper.append(header, content, footer, ink); slot.append(paper); this.root.append(slot); slot.ink = (page.ink || []).map(s => ({ ...s, points: s.points.map(p => [...p]) })); return slot; }
    render() { this.root.replaceChildren(); for (const page of this.store.document.pages)
        this.createPage(page); this.updateFurniture(); }
    updateFurniture() { const d = this.store.document; [...this.root.children].forEach((slot, i) => { slot.querySelector('.paper').setAttribute('aria-label', `Page ${i + 1}`); slot.querySelector('.page-content').setAttribute('aria-label', `Page ${i + 1} content`); slot.querySelector('.running-header').textContent = d.layout.header; const f = slot.querySelector('.running-footer'); f.innerHTML = `<span>${escapeHTML(d.title)} &nbsp; / &nbsp; ${new Date(d.modifiedAt).getFullYear()}</span><span>${String(i + 1).padStart(2, '0')}</span>`; f.hidden = !d.layout.footer; }); }
    getPages() { return [...this.root.children].map(slot => ({ id: slot.dataset.pageId, html: slot.querySelector('.page-content').innerHTML.replace(/ id="heading-\d+"/g, ''), ink: (slot.ink || []).map(s => ({ ...s, points: s.points.map(p => [...p]) })) })); }
    used(content) { if (!content.lastElementChild)
        return 0; const zoom = this.root.getBoundingClientRect().width ? this.root.querySelector('.paper').getBoundingClientRect().width / this.store.document.layout.width : 1; const rect = content.getBoundingClientRect(); return Math.max(...[...content.children].map(c => (c.getBoundingClientRect().bottom - rect.top) / zoom + (parseFloat(getComputedStyle(c).marginBottom) || 0))); }
    /** Split only at legal block boundaries: whole table rows or whole list items. */
    splitStructured(block, content) {
        const table = block.tagName === 'TABLE', original = block.cloneNode(true), items = table ? [...original.rows] : [...original.children];
        if (items.length < 2)
            return null;
        const part = (from, to) => { const copy = original.cloneNode(true), children = table ? [...copy.rows] : [...copy.children]; children.forEach((child, i) => { if (i < from || i >= to)
            child.remove(); }); if (table && from)
            copy.querySelector('caption')?.remove(); if (copy.tagName === 'OL')
            copy.start = (original.start || 1) + from; return copy; };
        let low = 1, high = items.length - 1, best = 0;
        while (low <= high) {
            const mid = (low + high) >> 1, candidate = part(0, mid);
            block.replaceChildren(...candidate.childNodes);
            if (this.used(content) <= content.clientHeight - 2) {
                best = mid;
                low = mid + 1;
            }
            else
                high = mid - 1;
        }
        block.replaceChildren(...[...original.childNodes].map(n => n.cloneNode(true)));
        if (!best)
            return null;
        const head = part(0, best), tail = part(best, items.length);
        block.replaceChildren(...head.childNodes);
        const flow = block.dataset.flow || uid();
        block.dataset.flow = flow;
        tail.dataset.flow = flow;
        return tail;
    }
    split(block, content) {
        if (['TABLE', 'UL', 'OL'].includes(block.tagName))
            return this.splitStructured(block, content);
        if (!/^(P|H[1-6]|BLOCKQUOTE|DIV)$/.test(block.tagName) || block.querySelector('table,img,ul,ol,div') || block.textContent.length < 25)
            return null;
        const original = block.cloneNode(true);
        const text = original.textContent;
        const candidates = [...text.matchAll(/\s+/g)].map(m => m.index + m[0].length).filter(n => n > 0 && n < text.length);
        if (!candidates.length)
            return null;
        let low = 0, high = candidates.length - 1, best = -1;
        const capacity = content.clientHeight - 2;
        const prefix = count => { const r = document.createRange(); r.selectNodeContents(original); const [n, off] = positionAt(original, count); r.setEnd(n, off); return r.cloneContents(); };
        while (low <= high) {
            const mid = (low + high) >> 1;
            block.replaceChildren(prefix(candidates[mid]));
            if (this.used(content) <= capacity) {
                best = mid;
                low = mid + 1;
            }
            else
                high = mid - 1;
        }
        block.replaceChildren(...[...original.childNodes].map(n => n.cloneNode(true)));
        if (best < 0 || candidates[best] < 8)
            return null;
        const cut = candidates[best], r = document.createRange();
        r.selectNodeContents(block);
        const [n, off] = positionAt(block, cut);
        r.setStart(n, off);
        const tail = block.cloneNode(false);
        tail.append(r.extractContents());
        const flow = block.dataset.flow || uid();
        block.dataset.flow = flow;
        tail.dataset.flow = flow;
        return tail;
    }
    reflow() {
        if (this.busy)
            return;
        this.busy = true;
        const t = performance.now();
        const mark = bookmarkSelection(this.root);
        const oldSlots = [...this.root.children];
        if (!oldSlots.length) {
            this.busy = false;
            return;
        }
        const blocks = [];
        for (const slot of oldSlots) {
            const content = slot.querySelector('.page-content');
            for (const n of [...content.childNodes]) {
                if (n.nodeType === Node.TEXT_NODE) {
                    if (!n.textContent.trim()) {
                        n.remove();
                        continue;
                    }
                    const p = document.createElement('p');
                    n.replaceWith(p);
                    p.append(n);
                    blocks.push(p);
                }
                else if (n.nodeType === Node.ELEMENT_NODE)
                    blocks.push(n);
            }
        }
        // Rejoin fragments from the last layout pass before measuring the new layout.
        for (let i = 1; i < blocks.length; i++) {
            const a = blocks[i - 1], b = blocks[i];
            if (a.dataset.flow && a.dataset.flow === b.dataset.flow && a.tagName === b.tagName) {
                if (a.tagName === 'TABLE') {
                    for (const row of [...b.rows]) {
                        const tag = row.parentElement.tagName.toLowerCase();
                        let section = [...a.children].find(n => n.tagName.toLowerCase() === tag);
                        if (!section) {
                            section = document.createElement(tag);
                            a.append(section);
                        }
                        section.append(row);
                    }
                }
                else
                    a.append(...b.childNodes);
                b.remove();
                blocks.splice(i, 1);
                i--;
            }
        }
        if (!blocks.length) {
            const p = document.createElement('p');
            p.innerHTML = '<br>';
            blocks.push(p);
        }
        for (const slot of oldSlots)
            slot.querySelector('.page-content').replaceChildren();
        let pageIndex = 0, content = oldSlots[0].querySelector('.page-content');
        const nextPage = () => { pageIndex++; let slot = this.root.children[pageIndex]; if (!slot)
            slot = this.createPage({ id: uid(), html: '', ink: [] }); content = slot.querySelector('.page-content'); content.replaceChildren(); };
        let iterations = 0;
        for (let i = 0; i < blocks.length && iterations++ < 20000; i++) {
            let block = blocks[i];
            if (block.classList.contains('page-break')) {
                content.append(block);
                if (i < blocks.length - 1)
                    nextPage();
                continue;
            }
            content.append(block);
            const overflowing = this.used(content) > content.clientHeight + 1;
            if (overflowing) {
                const tail = this.split(block, content);
                if (tail) {
                    blocks.splice(i + 1, 0, tail);
                    nextPage();
                }
                else if (content.children.length > 1) {
                    block.remove();
                    nextPage();
                    content.append(block);
                    if (this.used(content) > content.clientHeight + 1) {
                        const tail2 = this.split(block, content);
                        if (tail2) {
                            blocks.splice(i + 1, 0, tail2);
                            nextPage();
                        }
                    }
                }
                else {
                    block.dataset.overflow = 'true';
                } // An indivisible table/image is never silently deleted.
            }
            else if (/^H[1-6]$/.test(block.tagName) && content.clientHeight - this.used(content) < 55 && content.children.length > 1 && i < blocks.length - 1) {
                block.remove();
                nextPage();
                content.append(block);
            }
        }
        while (this.root.children.length > pageIndex + 1) {
            const last = this.root.lastElementChild;
            if (last.ink?.length)
                break;
            last.remove();
        }
        for (const slot of this.root.children) {
            const c = slot.querySelector('.page-content');
            if (!c.childNodes.length)
                c.innerHTML = '<p><br></p>';
        }
        this.updateFurniture();
        restoreBookmark(this.root, mark);
        this.stats = { pages: this.root.children.length, blocks: blocks.length, lastMs: performance.now() - t };
        this.busy = false;
    }
}
export class EditorEngine extends Emitter {
    constructor(root, store, paginator) {
        super();
        this.root = root;
        this.store = store;
        this.paginator = paginator;
        this.savedRange = null;
        this.composing = false;
        this.readOnly = false;
        this.pendingCommit = debounce(() => this.commit('typing', true), 300);
        this.onSelection = () => { const s = getSelection(); if (s?.rangeCount && root.contains(s.anchorNode) && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement)?.closest('.page-content')) {
            this.savedRange = s.getRangeAt(0).cloneRange();
            this.emit('selection', this.getFormat());
        } };
        document.addEventListener('selectionchange', this.onSelection);
        root.addEventListener('compositionstart', () => { this.composing = true; this.pendingCommit.cancel(); this.compositionStart = bookmarkSelection(root); });
        root.addEventListener('compositionend', () => { this.composing = false; if (this.store.document.trackChanges && this.compositionStart) {
            const end = bookmarkSelection(root);
            if (end && end.focus > this.compositionStart.anchor) {
                restoreBookmark(root, { anchor: this.compositionStart.anchor, focus: end.focus });
                this.applyInline({ tag: 'ins', attrs: { 'data-change': uid() } }, false, false);
                const s = getSelection();
                s.collapseToEnd();
            }
        } this.commit('typing', true); });
        root.addEventListener('beforeinput', e => this.beforeInput(e));
        root.addEventListener('input', () => { if (!this.composing)
            this.pendingCommit(); this.emit('input'); });
        root.addEventListener('paste', e => this.paste(e));
        root.addEventListener('drop', e => { e.preventDefault(); this.emit('drop', e); });
    }
    range() { const s = getSelection(); if (s?.rangeCount && this.root.contains(s.anchorNode) && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement)?.closest('.page-content'))
        return s.getRangeAt(0); if (this.savedRange && this.root.contains(this.savedRange.startContainer))
        return this.savedRange.cloneRange(); const c = this.root.querySelector('.page-content'); c.focus({ preventScroll: true }); const r = document.createRange(); r.selectNodeContents(c); r.collapse(false); return r; }
    focusRange() { const r = this.range(), s = getSelection(); (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement)?.closest('.page-content')?.focus({ preventScroll: true }); s.removeAllRanges(); s.addRange(r); return r; }
    commit(kind = 'edit', coalesce = false) { if (this.composing)
        return; this.pendingCommit.cancel(); const before = this.paginator.getPages(); const changed = JSON.stringify(before) !== JSON.stringify(this.store.document.pages); if (!changed && kind === 'typing')
        return; this.paginator.reflow(); const pages = this.paginator.getPages(); this.store.transact(kind, d => { d.pages = pages; }, { coalesce }); this.emit('layout'); }
    transaction(kind, fn) { if (this.readOnly) {
        this.emit('notice', 'Switch to Editing to change your document.');
        return;
    } this.pendingCommit.cancel(); this.focusRange(); fn(); this.commit(kind, kind === 'tracked insertion' || kind === 'tracked deletion'); }
    deleteSelection(range) { const getContent = n => (n.nodeType === 1 ? n : n.parentElement)?.closest('.page-content'), start = getContent(range.startContainer), end = getContent(range.endContainer); if (!start || !end || start === end) {
        range.deleteContents();
        range.collapse(true);
        return range;
    } const contents = [...this.root.querySelectorAll('.page-content')], a = contents.indexOf(start), b = contents.indexOf(end), pieces = []; const caret = range.cloneRange(); caret.collapse(true); for (let i = a; i <= b; i++) {
        const piece = document.createRange();
        piece.selectNodeContents(contents[i]);
        if (i === a)
            piece.setStart(range.startContainer, range.startOffset);
        if (i === b)
            piece.setEnd(range.endContainer, range.endOffset);
        pieces.push(piece);
    } for (const piece of pieces.reverse())
        piece.deleteContents(); range.setStart(caret.startContainer, caret.startOffset); range.collapse(true); return range; }
    selectedText() { const r = this.range(); if (r.collapsed)
        return ''; let text = '', host = null; for (const n of this.nodesInRange(r)) {
        const current = n.parentElement.closest('.page-content');
        if (host && host !== current)
            text += '\n';
        host = current;
        text += n.textContent.slice(n === r.startContainer ? r.startOffset : 0, n === r.endContainer ? r.endOffset : n.length);
    } return text; }
    nodesInRange(r) { return textNodes(this.root).filter(n => n.parentElement.closest('.page-content') && r.intersectsNode(n) && n.length && !(n === r.endContainer && r.endOffset === 0) && !(n === r.startContainer && r.startOffset === n.length)); }
    applyInline({ tag = 'span', style = {}, attrs = {} }, toggle = false, commit = true) {
        const apply = () => {
            const r = this.range();
            if (r.collapsed) {
                const wrap = document.createElement(tag);
                Object.assign(wrap.style, style);
                for (const [k, v] of Object.entries(attrs))
                    wrap.setAttribute(k, v);
                wrap.append('\u200b');
                r.insertNode(wrap);
                caretAt(wrap);
                this.savedRange = getSelection().getRangeAt(0).cloneRange();
                return;
            }
            const nodes = this.nodesInRange(r);
            let first = null, last = null;
            for (const n of nodes) {
                let start = n === r.startContainer ? r.startOffset : 0, end = n === r.endContainer ? r.endOffset : n.length;
                if (end <= start)
                    continue;
                let selected = n;
                if (end < n.length)
                    n.splitText(end);
                if (start > 0)
                    selected = n.splitText(start);
                const wrap = document.createElement(tag);
                Object.assign(wrap.style, style);
                for (const [k, v] of Object.entries(attrs))
                    wrap.setAttribute(k, v);
                selected.replaceWith(wrap);
                wrap.append(selected);
                first ??= selected;
                last = selected;
            }
            if (first && last) {
                const out = document.createRange();
                out.setStart(first, 0);
                out.setEnd(last, last.length);
                getSelection().removeAllRanges();
                getSelection().addRange(out);
                this.savedRange = out.cloneRange();
            }
        };
        if (commit)
            this.transaction('format', apply);
        else
            apply();
    }
    /** CSS decorations propagate across descendants; a nested `none` cannot cancel them. */
    removeDecoration(kind) {
        this.transaction('format', () => {
            const range = this.range();
            if (range.collapsed) {
                const marker = document.createTextNode('\u200b');
                range.insertNode(marker);
                range.selectNode(marker);
            }
            const selected = [];
            for (const n of this.nodesInRange(range)) {
                const start = n === range.startContainer ? range.startOffset : 0, end = n === range.endContainer ? range.endOffset : n.length;
                if (end <= start)
                    continue;
                if (end < n.length)
                    n.splitText(end);
                const text = start ? n.splitText(start) : n;
                selected.push(text);
                let child = text, parent = text.parentElement;
                while (parent && !parent.classList.contains('page-content') && !/^(P|DIV|H[1-6]|LI|TD|TH|BLOCKQUOTE)$/.test(parent.tagName)) {
                    const siblings = [...parent.childNodes], at = siblings.indexOf(child), before = parent.cloneNode(false), after = parent.cloneNode(false);
                    before.append(...siblings.slice(0, at));
                    after.append(...siblings.slice(at + 1));
                    const semantic = (kind === 'underline' && parent.tagName === 'U') || (kind === 'line-through' && ['S', 'STRIKE'].includes(parent.tagName));
                    let middle = parent.cloneNode(false);
                    if (semantic) {
                        middle = document.createElement('span');
                        for (const a of parent.attributes)
                            middle.setAttribute(a.name, a.value);
                    }
                    const decoration = getComputedStyle(parent).textDecorationLine;
                    if (semantic || decoration.split(' ').includes(kind))
                        middle.style.textDecorationLine = decoration.split(' ').filter(v => v !== kind && v !== 'none').join(' ') || 'none';
                    middle.append(child);
                    parent.replaceWith(...(before.childNodes.length ? [before] : []), middle, ...(after.childNodes.length ? [after] : []));
                    child = middle;
                    parent = middle.parentElement;
                }
            }
            if (selected.length) {
                const output = document.createRange();
                output.setStart(selected[0], 0);
                output.setEnd(selected.at(-1), selected.at(-1).length);
                getSelection().removeAllRanges();
                getSelection().addRange(output);
                this.savedRange = output.cloneRange();
            }
        });
    }
    toggleMark(name) { const map = { bold: ['strong', 'fontWeight', '700', '400'], italic: ['em', 'fontStyle', 'italic', 'normal'], underline: ['u', 'textDecoration', 'underline', 'none'], strikeThrough: ['s', 'textDecoration', 'line-through', 'none'], subscript: ['sub', 'verticalAlign', 'sub', 'baseline'], superscript: ['sup', 'verticalAlign', 'super', 'baseline'] }; const [tag, prop, on, off] = map[name]; const fmt = this.getFormat(); const active = !!fmt[name]; if (active && ['underline', 'strikeThrough'].includes(name)) {
        this.removeDecoration(name === 'underline' ? 'underline' : 'line-through');
        return;
    } this.applyInline(active ? { style: { [prop]: off } } : { tag }); }
    getFormat() { const selection = getSelection(); let n = selection?.anchorNode; if (!n || !this.root.contains(n))
        return {}; if (selection.rangeCount && !selection.isCollapsed)
        n = this.nodesInRange(selection.getRangeAt(0))[0] || n; if (n.nodeType !== Node.ELEMENT_NODE)
        n = n.parentElement; const s = getComputedStyle(n); const deco = (() => { let e = n, t = ''; while (e && !e.classList.contains('page-content')) {
        t += ' ' + getComputedStyle(e).textDecorationLine;
        e = e.parentElement;
    } return t; })(); return { bold: Number(s.fontWeight) >= 600, italic: s.fontStyle === 'italic', underline: deco.includes('underline'), strikeThrough: deco.includes('line-through'), subscript: s.verticalAlign === 'sub', superscript: s.verticalAlign === 'super', fontFamily: s.fontFamily.split(',')[0].replaceAll('"', ''), fontSize: Math.round(parseFloat(s.fontSize) * .75), align: s.textAlign, block: n.closest('h1,h2,h3,p,blockquote,li')?.tagName.toLowerCase() || 'p' }; }
    blocks() { const r = this.range(); const all = [...this.root.querySelectorAll('.page-content p,.page-content h1,.page-content h2,.page-content h3,.page-content blockquote,.page-content li,.page-content td,.page-content th')]; let selected = all.filter(el => r.intersectsNode(el)); if (r.collapsed) {
        const node = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
        const block = node.closest('p,h1,h2,h3,blockquote,li,td,th');
        selected = block ? [block] : [];
    } return selected.filter(el => !selected.some(other => other !== el && el.contains(other))); }
    setBlockStyle(style) { this.transaction('paragraph', () => { for (const b of this.blocks())
        Object.assign(b.style, style); }); }
    setBlock(tag) { this.transaction('style', () => { const mark = bookmarkSelection(this.root); for (const b of this.blocks()) {
        if (['TD', 'TH'].includes(b.tagName))
            continue;
        const n = document.createElement(tag === 'title' ? 'h1' : tag);
        n.append(...b.childNodes);
        if (tag === 'title')
            n.className = 'cover-title';
        if (b.dataset.flow)
            n.dataset.flow = b.dataset.flow;
        b.replaceWith(n);
    } restoreBookmark(this.root, mark); }); }
    list(ordered = false) { this.transaction('list', () => { const blocks = this.blocks(); if (!blocks.length)
        return; const mark = bookmarkSelection(this.root); if (blocks.every(b => b.tagName === 'LI')) {
        for (const b of blocks) {
            const list = b.parentElement;
            const p = document.createElement('p');
            p.append(...b.childNodes);
            list.parentElement.insertBefore(p, list);
            b.remove();
            if (!list.children.length)
                list.remove();
        }
    }
    else {
        let list = null, parent = null;
        for (const b of blocks) {
            if (['TD', 'TH'].includes(b.tagName))
                continue;
            if (b.parentElement !== parent) {
                parent = b.parentElement;
                list = document.createElement(ordered ? 'ol' : 'ul');
                b.before(list);
            }
            const li = document.createElement('li');
            li.append(...b.childNodes);
            list.append(li);
            b.remove();
        }
    } restoreBookmark(this.root, mark); }); }
    indent(delta) { this.transaction('indent', () => { for (const b of this.blocks())
        b.style.marginLeft = `${Math.max(0, Math.min(300, (parseFloat(b.style.marginLeft) || 0) + delta))}px`; }); }
    insertHTML(html, { block = false, kind = 'insert' } = {}) {
        this.transaction(kind, () => {
            const r = this.range();
            this.deleteSelection(r);
            const box = document.createElement('div');
            box.innerHTML = html;
            const last = box.lastChild;
            if (!last)
                return;
            const fragment = document.createDocumentFragment();
            fragment.append(...box.childNodes);
            if (block) {
                const node = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
                let parent = node.closest('.page-content > *');
                if (parent) {
                    const after = document.createElement('p');
                    after.innerHTML = '<br>';
                    const tailRange = document.createRange();
                    tailRange.selectNodeContents(parent);
                    try {
                        tailRange.setStart(r.startContainer, r.startOffset);
                        const tail = tailRange.extractContents();
                        if (tail.textContent || tail.querySelector('img'))
                            after.replaceChildren(tail);
                    }
                    catch { }
                    parent.after(fragment, after);
                    caretAt(after, false);
                }
                else {
                    r.insertNode(fragment);
                    caretAt(last);
                }
            }
            else {
                r.insertNode(fragment);
                caretAt(last);
            }
        });
    }
    insertText(text) { this.insertHTML(escapeHTML(text).replaceAll('\n', '<br>')); }
    clearFormat() { this.transaction('clear formatting', () => { const r = this.range(); if (r.collapsed)
        return; const text = this.selectedText(); this.deleteSelection(r); const n = document.createTextNode(text); r.insertNode(n); const out = document.createRange(); out.selectNodeContents(n); getSelection().removeAllRanges(); getSelection().addRange(out); this.applyInline({ style: { fontWeight: '400', fontStyle: 'normal', textDecoration: 'none', fontSize: '14px', color: '#3d4d5c', backgroundColor: 'transparent', fontFamily: 'Segoe UI, Arial, sans-serif' } }, false, false); }); }
    beforeInput(e) {
        if (this.readOnly) {
            e.preventDefault();
            return;
        }
        if (e.inputType === 'historyUndo') {
            e.preventDefault();
            this.pendingCommit.cancel();
            this.commit('typing', true);
            this.store.undo();
            return;
        }
        if (e.inputType === 'historyRedo') {
            e.preventDefault();
            this.store.redo();
            return;
        }
        const formats = { formatBold: 'bold', formatItalic: 'italic', formatUnderline: 'underline' };
        if (formats[e.inputType]) {
            e.preventDefault();
            this.toggleMark(formats[e.inputType]);
            return;
        }
        if (!this.composing && e.cancelable) {
            const range = this.range();
            const host = n => (n.nodeType === 1 ? n : n.parentElement)?.closest('.page-content');
            if (!range.collapsed && host(range.startContainer) !== host(range.endContainer)) {
                if (e.inputType.startsWith('insert') || e.inputType.startsWith('delete')) {
                    e.preventDefault();
                    this.transaction('replace selection', () => { this.deleteSelection(range); if (e.inputType === 'insertText' && e.data) {
                        const n = document.createTextNode(e.data);
                        range.insertNode(n);
                        caretAt(n);
                    }
                    else if (e.inputType === 'insertParagraph') {
                        const br = document.createElement('br');
                        range.insertNode(br);
                        caretAt(br);
                    }
                    else {
                        getSelection().removeAllRanges();
                        getSelection().addRange(range);
                    } });
                    return;
                }
            }
        }
        if (this.composing || !e.cancelable || !this.store.document.trackChanges)
            return;
        if (e.inputType === 'insertText' && e.data) {
            e.preventDefault();
            this.trackInsert(e.data);
        }
        else if (['deleteContentBackward', 'deleteContentForward', 'deleteByCut'].includes(e.inputType)) {
            const r = this.range();
            if (r.collapsed) {
                const n = r.startContainer, off = r.startOffset;
                if (n.nodeType !== Node.TEXT_NODE)
                    return;
                const parts = typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(n.textContent)].map(s => s.index) : [...n.textContent].map((_, i) => i);
                parts.push(n.length);
                if (e.inputType === 'deleteContentBackward' && off > 0)
                    r.setStart(n, parts.filter(p => p < off).at(-1) ?? off - 1);
                else if (e.inputType === 'deleteContentForward' && off < n.length)
                    r.setEnd(n, parts.find(p => p > off) ?? off + 1);
                else
                    return;
                getSelection().removeAllRanges();
                getSelection().addRange(r);
            }
            if (!r.collapsed) {
                e.preventDefault();
                this.transaction('tracked deletion', () => { const del = document.createElement('del'); del.dataset.change = uid(); del.contentEditable = 'false'; del.append(r.extractContents()); r.insertNode(del); const caret = document.createRange(); caret.setStartAfter(del); caret.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(caret); });
            }
        }
    }
    trackInsert(text) { this.transaction('tracked insertion', () => { const r = this.range(); if (!r.collapsed) {
        const del = document.createElement('del');
        del.dataset.change = uid();
        del.contentEditable = 'false';
        del.append(r.extractContents());
        r.insertNode(del);
        r.setStartAfter(del);
        r.collapse(true);
    } const node = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement; const current = node.closest('ins[data-change]'); if (current) {
        const t = document.createTextNode(text);
        r.insertNode(t);
        caretAt(t);
    }
    else {
        const ins = document.createElement('ins');
        ins.dataset.change = uid();
        ins.append(text);
        r.insertNode(ins);
        caretAt(ins);
    } }); }
    resolveChanges(accept = true) { this.transaction(accept ? 'accept changes' : 'reject changes', () => { for (const n of this.root.querySelectorAll('ins[data-change],del[data-change]')) {
        if ((n.tagName === 'INS') === accept)
            n.replaceWith(...n.childNodes);
        else
            n.remove();
    } }); }
    paste(e) { e.preventDefault(); if (this.readOnly)
        return; const html = e.clipboardData?.getData('text/html'); const text = e.clipboardData?.getData('text/plain') || ''; const safe = html ? sanitizeHTML(html) : escapeHTML(text).split(/\r?\n/).map(t => `<p>${t || '<br>'}</p>`).join(''); if (!safe)
        return; const block = /<(p|h[1-6]|div|table|ul|ol)[\s>]/i.test(safe); this.insertHTML(safe, { block, kind: 'paste' }); }
    destroy() { this.pendingCommit.cancel(); document.removeEventListener('selectionchange', this.onSelection); }
}
export class DocumentSearch {
    constructor(root) { this.root = root; this.matches = []; this.index = -1; this.term = ''; }
    find(term) {
        this.term = term;
        this.matches = [];
        this.index = -1;
        globalThis.CSS?.highlights?.delete('quire-search');
        globalThis.CSS?.highlights?.delete('quire-current');
        if (!term)
            return [];
        // Search each block as one string, so matches can cross inline formatting nodes.
        const blocks = [...this.root.querySelectorAll('.page-content')];
        for (const block of blocks) {
            const text = block.textContent;
            let from = 0;
            const hay = text.toLocaleLowerCase(), needle = term.toLocaleLowerCase();
            while (from <= text.length) {
                const at = hay.indexOf(needle, from);
                if (at < 0)
                    break;
                const [a, ao] = positionAt(block, at), [b, bo] = positionAt(block, at + needle.length);
                const r = document.createRange();
                r.setStart(a, ao);
                r.setEnd(b, bo);
                this.matches.push({ range: r, context: text.slice(Math.max(0, at - 32), Math.min(text.length, at + needle.length + 64)), page: [...this.root.children].indexOf(block.closest('.paper-slot')) + 1 });
                from = at + Math.max(1, needle.length);
                if (this.matches.length >= 5000)
                    break;
            }
            if (this.matches.length >= 5000)
                break;
        }
        if (globalThis.Highlight && CSS.highlights)
            CSS.highlights.set('quire-search', new Highlight(...this.matches.map(m => m.range)));
        return this.matches;
    }
    go(index) { if (!this.matches.length)
        return; this.index = (index + this.matches.length) % this.matches.length; const r = this.matches[this.index].range; if (globalThis.Highlight && CSS.highlights)
        CSS.highlights.set('quire-current', new Highlight(r)); const element = r.startContainer.parentElement; element.scrollIntoView({ block: 'center', behavior: 'smooth' }); const s = getSelection(); s.removeAllRanges(); s.addRange(r.cloneRange()); return this.matches[this.index]; }
}
export class StatisticsWorker extends Emitter {
    constructor() { super(); this.sequence = 0; const source = `let segmenter;try{segmenter=new Intl.Segmenter(undefined,{granularity:'word'})}catch{};onmessage=({data})=>{const text=data.text.replace(/\\u200b/g,'');const words=segmenter?[...segmenter.segment(text)].filter(s=>s.isWordLike).length:(text.match(/\\S+/g)||[]).length;postMessage({id:data.id,words,characters:text.length,noSpaces:text.replace(/\\s/g,'').length,readingMinutes:Math.max(1,Math.ceil(words/220)),sentences:(text.match(/[.!?]+(?:\\s|$)/g)||[]).length,paragraphs:text.split(/\\n+/).filter(s=>s.trim()).length});}`; try {
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        this.worker = new Worker(url);
        URL.revokeObjectURL(url);
        this.worker.onmessage = ({ data }) => { if (data.id === this.sequence)
            this.emit('stats', data); };
    }
    catch {
        this.worker = null;
    } }
    update(text) { const id = ++this.sequence; if (this.worker)
        this.worker.postMessage({ id, text });
    else
        this.emit('stats', { id, words: (text.match(/\S+/g) || []).length, characters: text.length, noSpaces: text.replace(/\s/g, '').length, readingMinutes: Math.max(1, Math.ceil((text.match(/\S+/g) || []).length / 220)), sentences: (text.match(/[.!?]+/g) || []).length, paragraphs: text.split(/\n+/).filter(Boolean).length }); }
}
