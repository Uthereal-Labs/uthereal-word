/** Native-owned Word object identities and UTF-16 grounding spans.
 * Text is literal text-node concatenation: BR contributes no separator, a cell
 * owns every descendant, and a list item excludes descendant list-item text.
 * Page positions never establish object identity or evidence provenance.
 */
const id = () => globalThis.crypto?.randomUUID?.() || `uth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const clone = value => JSON.parse(JSON.stringify(value));
const opaqueId = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value);
const annotationId = value => opaqueId(value) && value.length <= 200;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const selector = 'p,h1,h2,h3,h4,h5,h6,blockquote,pre,li,td,th,div';
const privateAttrs = ['data-uth-id', 'data-uth-grounding', 'data-uth-offset'];
export function groundingElements(root) {
    const paginated = !!root.querySelector('.page-content');
    return [...root.querySelectorAll(selector)].filter(el => {
        if (paginated && !el.closest('.page-content')) return false;
        if (el.classList.contains('page-content') || el.classList.contains('page-break')) return false;
        if (el.parentElement?.closest('td,th')) return false;
        if (el.tagName === 'TD' || el.tagName === 'TH') return true;
        if (el.tagName === 'LI') return true;
        if (el.parentElement?.closest('li')) return false;
        return !el.querySelector('p,h1,h2,h3,h4,h5,h6,blockquote,pre,li,td,th,div,table,ul,ol');
    });
}
function ownedTextNodes(el) {
    const nodes = [], w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) if (el.tagName !== 'LI' || w.currentNode.parentElement.closest('li') === el) nodes.push(w.currentNode);
    return nodes;
}
function intersectsText(range, node) {
    return node.length && range.intersectsNode(node) && !(node === range.endContainer && range.endOffset === 0) && !(node === range.startContainer && range.startOffset === node.length);
}
export function objectText(el) {
    if (el.tagName !== 'LI') return el.textContent;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text = '';
    while (w.nextNode()) if (w.currentNode.parentElement.closest('li') === el) text += w.currentNode.textContent;
    return text;
}
function annotations(el) {
    try { const value = JSON.parse(el.getAttribute('data-uth-grounding') || '[]'); return Array.isArray(value) ? value : []; }
    catch { return []; }
}
function setAnnotations(el, value) {
    if (value.length) el.setAttribute('data-uth-grounding', JSON.stringify(value));
    else el.removeAttribute('data-uth-grounding');
}
export function validOrigin(origin) {
    if (!origin || typeof origin !== 'object') return false;
    if (origin.kind === 'saved') return opaqueId(origin.revision_id) && opaqueId(origin.association_id);
    return origin.kind === 'agent' && opaqueId(origin.job_id) && Number.isInteger(origin.steering_revision) && origin.steering_revision >= 0 && Number.isInteger(origin.sequence) && origin.sequence >= 0 && opaqueId(origin.declaration_id);
}
export function validateAnnotations(value, text) {
    if (!Array.isArray(value) || value.length > 1000) throw new Error('Invalid native grounding annotations.');
    const seen = new Set();
    return value.map(a => {
        if (!a || !annotationId(a.id) || seen.has(a.id) || !Number.isInteger(a.start) || !Number.isInteger(a.end) || a.start < 0 || a.end <= a.start || a.end > text.length || typeof a.quote !== 'string' || a.quote.length > 32000 || text.slice(a.start, a.end) !== a.quote || !Array.isArray(a.claim_ids) || !a.claim_ids.length || a.claim_ids.length > 12 || !a.claim_ids.every(opaqueId) || new Set(a.claim_ids).size !== a.claim_ids.length || !['supports', 'derived'].includes(a.relation) || !validOrigin(a.origin)) throw new Error('Grounding must identify a valid quoted UTF-16 span and origin.');
        seen.add(a.id);
        return { id: a.id, start: a.start, end: a.end, quote: a.quote, claim_ids: [...a.claim_ids], relation: a.relation, origin: clone(a.origin) };
    });
}
export function stripGrounding(root) {
    for (const el of root.querySelectorAll('[data-uth-id],[data-uth-grounding],[data-uth-offset]')) for (const attr of privateAttrs) el.removeAttribute(attr);
    return root;
}
export function publicHTML(html) { const box = document.createElement('div'); box.innerHTML = html; stripGrounding(box); return box.innerHTML; }
function normalizeAuthoredContainers(root) {
    const pages = [...root.querySelectorAll('.page-content')];
    if (root.classList?.contains('page-content')) pages.unshift(root);
    const hosts = pages.length ? pages : [root];
    const inline = new Set('SPAN B STRONG I EM U S STRIKE SUB SUP BR A MARK INS DEL CODE'.split(' '));
    const wrapRuns = host => {
        let run = [];
        const flush = () => {
            if (!run.length) return;
            if (run.some(node => node.nodeType === 1 || node.textContent.trim())) { const p = document.createElement('p'); run[0].before(p); p.append(...run); }
            else for (const node of run) node.remove();
            run = [];
        };
        for (const child of [...host.childNodes]) {
            if (child.nodeType === 3 || (child.nodeType === 1 && inline.has(child.tagName))) run.push(child);
            else flush();
        }
        flush();
    };
    for (const host of hosts) {
        wrapRuns(host);
        for (const container of host.querySelectorAll('div,blockquote,figure,figcaption,section')) {
            if (container.closest('td,th,li') || container.classList.contains('page-break')) continue;
            if (container.tagName === 'FIGCAPTION' || container.querySelector('p,h1,h2,h3,h4,h5,h6,blockquote,pre,div,table,ul,ol,figure,figcaption,section')) wrapRuns(container);
        }
    }
}
export function normalizeGrounding(root, { fresh = false } = {}) {
    normalizeAuthoredContainers(root);
    const elements = groundingElements(root), eligible = new Set(elements), seen = new Map();
    // Descendant paragraphs in cells/list items cannot own overlapping spans.
    for (const el of root.querySelectorAll('[data-uth-id],[data-uth-grounding],[data-uth-offset]')) if (!eligible.has(el)) for (const attr of privateAttrs) el.removeAttribute(attr);
    for (const el of elements) {
        let key = el.getAttribute('data-uth-id');
        const previous = seen.get(key), offset = Number(el.getAttribute('data-uth-offset') || 0);
        const fragment = previous && el.dataset.flow && el.dataset.flow === previous.flow && el.tagName === previous.tag && Number.isInteger(offset) && offset > previous.offset;
        if (fresh || !validId(key) || (previous && !fragment)) {
            // Browser Enter can clone attrs. A split is a new authored unit,
            // never a pagination fragment, and invalidates the source too.
            if (previous && !fresh) for (const source of previous.elements) source.removeAttribute('data-uth-grounding');
            key = id(); el.setAttribute('data-uth-id', key); el.removeAttribute('data-uth-grounding'); el.removeAttribute('data-flow'); el.setAttribute('data-uth-offset', '0');
        } else if (!el.hasAttribute('data-uth-offset')) el.setAttribute('data-uth-offset', '0');
        const prior = seen.get(key);
        seen.set(key, { flow: el.dataset.flow, tag: el.tagName, offset: Number(el.dataset.uthOffset), elements: [...(prior?.elements || []), el] });
    }
    // Each fragment repeats the same logical annotation array; offsets refer to
    // the full object, not the displayed page substring.
    for (const unit of logicalGroundingUnits(root)) {
        let offset = 0;
        for (const el of unit.elements) { el.dataset.uthOffset = String(offset); offset += objectText(el).length; }
        let value = unit.grounding;
        try { value = validateAnnotations(value, unit.text); } catch { value = []; }
        for (const el of unit.elements) setAnnotations(el, value);
    }
    return root;
}
function blockPath(el, host) { const path = []; for (let n = el; n && n !== host; n = n.parentElement) path.unshift([...n.parentElement.children].indexOf(n)); return path; }
export function logicalGroundingUnits(root) {
    const units = new Map();
    for (const el of groundingElements(root)) {
        const key = el.getAttribute('data-uth-id'); if (!key) continue;
        let unit = units.get(key);
        if (!unit) { unit = { object_id: key, text: '', grounding: annotations(el), locations: [], elements: [] }; units.set(key, unit); }
        const text = objectText(el), host = el.closest('.page-content'), page = el.closest('.paper-slot');
        const start = unit.text.length;
        unit.text += text; unit.elements.push(el);
        unit.locations.push({ page_id: page?.dataset.pageId || null, page_index: page ? [...page.parentElement.children].indexOf(page) : 0, block_path: host ? blockPath(el, host) : [], start, end: start + text.length, offset: start });
    }
    return [...units.values()];
}
export function documentGroundingUnits(doc) {
    const box = document.createElement('div');
    for (const page of doc.pages) { const slot = document.createElement('div'); slot.className = 'paper-slot'; slot.dataset.pageId = page.id; const content = document.createElement('div'); content.className = 'page-content'; content.innerHTML = page.html; slot.append(content); box.append(slot); }
    return logicalGroundingUnits(box);
}
export function normalizeDocumentGrounding(doc, { fresh = false } = {}) {
    const box = document.createElement('div');
    for (const page of doc.pages) { const content = document.createElement('div'); content.className = 'page-content'; content.innerHTML = page.html; box.append(content); }
    normalizeGrounding(box, { fresh }); doc.pages.forEach((page, i) => { page.html = box.children[i].innerHTML; }); doc.grounding_contract = 2;
    return doc;
}
function sameOrigin(a, b) {
    if (!a || !b || a.kind !== b.kind) return false;
    const keys = a.kind === 'saved' ? ['revision_id', 'association_id'] : ['job_id', 'steering_revision', 'sequence', 'declaration_id'];
    return keys.every(key => a[key] === b[key]);
}
export class GroundingLifecycle {
    constructor(editor) { this.editor = editor; this.clipboard = null; this.assigned = new Set(); this.batchDepth = 0; }
    inspect() { normalizeGrounding(this.editor.root); return logicalGroundingUnits(this.editor.root).map(({ elements, ...unit }) => clone(unit)); }
    reconcile() {
        normalizeGrounding(this.editor.root);
        const previous = new Map(documentGroundingUnits(this.editor.store.document).map(unit => [unit.object_id, unit.text]));
        for (const unit of logicalGroundingUnits(this.editor.root)) if (previous.has(unit.object_id) && previous.get(unit.object_id) !== unit.text && !this.assigned.has(unit.object_id)) for (const el of unit.elements) el.removeAttribute('data-uth-grounding');
    }
    joinFragments() {
        for (const unit of logicalGroundingUnits(this.editor.root)) {
            if (unit.elements.length < 2) continue;
            const first = unit.elements[0];
            for (const fragment of unit.elements.slice(1)) { first.append(...fragment.childNodes); fragment.remove(); }
            first.dataset.uthOffset = '0'; first.removeAttribute('data-flow');
        }
    }
    boundary(range) {
        if (!range.collapsed) return null;
        let el = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement)?.closest('[data-uth-id]');
        if (!el || !this.editor.root.contains(el)) return null;
        const unit = logicalGroundingUnits(this.editor.root).find(item => item.object_id === el.dataset.uthId);
        if (!unit) return null;
        const prefix = document.createRange(); prefix.selectNodeContents(el); prefix.setEnd(range.startContainer, range.startOffset);
        const at = Number(el.dataset.uthOffset || 0) + prefix.toString().length;
        return { el, unit, start: at === 0, end: at === unit.text.length };
    }
    invalidateRange(range, inputType = '') {
        const units = logicalGroundingUnits(this.editor.root), selected = new Set();
        const host = node => (node.nodeType === 1 ? node : node.parentElement)?.closest(selector);
        if (range.collapsed) {
            let el = host(range.startContainer);
            while (el && !el.hasAttribute('data-uth-id')) el = el.parentElement?.closest(selector);
            if (el) selected.add(el.dataset.uthId);
            // At a paragraph boundary Backspace/Delete also edits the adjacent
            // authored object. Range text offsets are only gesture detection.
            if (el && inputType.startsWith('delete')) {
                const local = document.createRange(); local.selectNodeContents(el); local.setEnd(range.startContainer, range.startOffset);
                const at = local.toString().length, index = units.findIndex(unit => unit.object_id === el.dataset.uthId);
                if (inputType.includes('Backward') && at === 0 && index > 0) selected.add(units[index - 1].object_id);
                if (inputType.includes('Forward') && at === el.textContent.length && index >= 0 && index < units.length - 1) selected.add(units[index + 1].object_id);
            }
        } else for (const unit of units) if (unit.elements.some(el => ownedTextNodes(el).some(node => intersectsText(range, node)))) selected.add(unit.object_id);
        for (const unit of units) if (selected.has(unit.object_id)) for (const el of unit.elements) el.removeAttribute('data-uth-grounding');
    }
    assign(assignments, { commit = true } = {}) {
        if (this.editor.readOnly) throw new Error('Cannot annotate a read-only document.');
        if (!Array.isArray(assignments) || assignments.length > 1000) throw new Error('Invalid grounding assignment batch.');
        normalizeGrounding(this.editor.root);
        const units = new Map(logicalGroundingUnits(this.editor.root).map(unit => [unit.object_id, unit]));
        const seen = new Set(), prepared = assignments.map(item => {
            if (!item || seen.has(item.object_id) || !units.has(item.object_id)) throw new Error('Unknown or duplicate grounding object.');
            seen.add(item.object_id); const unit = units.get(item.object_id);
            return { unit, annotations: validateAnnotations(item.annotations, unit.text) };
        });
        const replacement = new Map(prepared.map(item => [item.unit.object_id, item.annotations])), allIds = new Set();
        for (const unit of units.values()) for (const a of replacement.get(unit.object_id) || unit.grounding) { if (allIds.has(a.id)) throw new Error('Duplicate grounding annotation identity.'); allIds.add(a.id); }
        for (const { unit, annotations: value } of prepared) { this.assigned.add(unit.object_id); for (const el of unit.elements) setAnnotations(el, value); }
        if (commit && !this.batchDepth) this.editor.commit('grounding');
        return { assigned_object_ids: prepared.map(item => item.unit.object_id) };
    }
    // Bridge mutations and final assignments run together inside one history
    // step. Nested EditorEngine transactions do not commit independently.
    transaction(kind, fn, assignments = []) {
        if (this.editor.readOnly) throw new Error('Cannot edit a read-only document.');
        this.editor.commit('typing', true);
        const pages = this.editor.paginator.getPages();
        this.batchDepth++;
        try { fn(); this.reconcile(); this.assign(assignments, { commit: false }); }
        catch (error) { this.editor.store.document.pages = pages; this.editor.paginator.render(); this.assigned.clear(); throw error; }
        finally { this.batchDepth--; }
        this.editor.commit(kind);
    }
    applyDocument(staged, assignments = [], { validate = null } = {}) {
        if (this.editor.readOnly) throw new Error('Cannot edit a read-only document.');
        if (staged.grounding_contract !== 2 || staged.id !== this.editor.store.document.id) throw new Error('Native document identity or grounding contract mismatch.');
        const next = clone(staged), previous = new Map(documentGroundingUnits(this.editor.store.document).map(unit => [unit.object_id, unit.text]));
        normalizeDocumentGrounding(next);
        const box = document.createElement('div');
        for (const page of next.pages) { const content = document.createElement('div'); content.className = 'page-content'; content.innerHTML = page.html; box.append(content); }
        const units = new Map(logicalGroundingUnits(box).map(unit => [unit.object_id, unit]));
        for (const unit of units.values()) if (previous.has(unit.object_id) && previous.get(unit.object_id) !== unit.text) for (const el of unit.elements) el.removeAttribute('data-uth-grounding');
        if (!Array.isArray(assignments) || assignments.length > 1000) throw new Error('Invalid grounding assignment batch.');
        const seen = new Set(), annotationIds = new Set();
        const prepared = assignments.map(item => {
            if (!item || !units.has(item.object_id) || seen.has(item.object_id)) throw new Error('Unknown or duplicate grounding object.');
            seen.add(item.object_id); const unit = units.get(item.object_id), value = validateAnnotations(item.annotations, unit.text);
            return { unit, value };
        });
        for (const { unit, value } of prepared) for (const el of unit.elements) setAnnotations(el, value);
        for (const unit of logicalGroundingUnits(box)) for (const a of unit.grounding) { if (annotationIds.has(a.id)) throw new Error('Duplicate grounding annotation identity.'); annotationIds.add(a.id); }
        next.pages.forEach((page, i) => { page.html = box.children[i].innerHTML; });
        if (validate) validate(next);
        if (JSON.stringify(next) === JSON.stringify(this.editor.store.document)) return { changed: false };
        this.editor.store.transact('Agent batch', doc => { for (const key of Object.keys(doc)) if (!(key in next)) delete doc[key]; Object.assign(doc, next); });
        return { changed: true };
    }
    ack({ receipts = [], invalidations = [], submitted_snapshot = null } = {}) {
        if (!Array.isArray(receipts) || !Array.isArray(invalidations)) throw new Error('Invalid grounding acknowledgement.');
        for (const receipt of receipts) if (!validId(receipt.object_id) || !annotationId(receipt.annotation_id) || !validOrigin(receipt.submitted_origin) || receipt.origin?.kind !== 'saved' || !validOrigin(receipt.origin)) throw new Error('Invalid grounding receipt.');
        for (const invalidation of invalidations) if (!validId(invalidation.object_id) || !annotationId(invalidation.annotation_id) || !validOrigin(invalidation.submitted_origin)) throw new Error('Invalid grounding invalidation.');
        if (submitted_snapshot && submitted_snapshot.id !== this.editor.store.document.id) return { updated: 0 };
        let updated = 0;
        const submitted = new Map(submitted_snapshot?.pages ? documentGroundingUnits(submitted_snapshot).map(unit => [unit.object_id, unit]) : []);
        const equivalent = (a, b) => a.start === b.start && a.end === b.end && a.quote === b.quote && a.relation === b.relation && JSON.stringify(a.claim_ids) === JSON.stringify(b.claim_ids);
        const patch = root => { for (const unit of logicalGroundingUnits(root)) {
            const next = [];
            for (const a of unit.grounding) {
                const matches = (item, exact = true) => {
                    if (!sameOrigin(a.origin, item.submitted_origin)) return false;
                    if (exact && (unit.object_id !== item.object_id || a.id !== item.annotation_id)) return false;
                    // Submitted objects have their own canonical receipt. Only
                    // copies created after submission may inherit a source receipt.
                    if (!exact && (!submitted_snapshot || submitted.has(unit.object_id))) return false;
                    const source = submitted.get(item.object_id), annotation = source?.grounding.find(value => value.id === item.annotation_id);
                    if (source) return source.text === unit.text && annotation && sameOrigin(annotation.origin, item.submitted_origin) && equivalent(a, annotation);
                    return !submitted_snapshot && exact && unit.object_id === item.object_id && a.id === item.annotation_id;
                };
                const exactInvalidation = invalidations.find(item => matches(item));
                let receipt = receipts.find(item => matches(item));
                if (exactInvalidation || (!receipt && invalidations.some(item => matches(item, false)))) { updated++; continue; }
                receipt ||= receipts.find(item => matches(item, false));
                if (receipt) { next.push({ ...a, origin: clone(receipt.origin) }); updated++; } else next.push(a);
            }
            for (const el of unit.elements) setAnnotations(el, next);
        } };
        patch(this.editor.root);
        const docs = [this.editor.store.document, ...this.editor.store.history.map(item => item.doc), ...this.editor.store.future.map(item => item.doc)];
        for (const doc of docs) {
            const box = document.createElement('div');
            for (const page of doc.pages) { const content = document.createElement('div'); content.className = 'page-content'; content.innerHTML = page.html; box.append(content); }
            patch(box); doc.pages.forEach((page, i) => { page.html = box.children[i].innerHTML; });
        }
        if (this.clipboard) { const box = document.createElement('div'); box.innerHTML = this.clipboard.html; patch(box); this.clipboard.html = box.innerHTML; }
        this.editor.emit('grounding-ack', { updated });
        return { updated };
    }
    copy(e = null) {
        const range = this.editor.range(), units = logicalGroundingUnits(this.editor.root), selected = [];
        let partial = false;
        for (const unit of units) {
            const owned = unit.elements.flatMap(ownedTextNodes).filter(n => n.length);
            if (!owned.some(n => range.intersectsNode(n) && !(n === range.endContainer && range.endOffset === 0) && !(n === range.startContainer && range.startOffset === n.length))) continue;
            selected.push(unit);
            if (owned.some(n => range.comparePoint(n, 0) !== 0 || range.comparePoint(n, n.length) !== 0)) partial = true;
        }
        const box = document.createElement('div');
        if (!partial && selected.length) {
            const selectedElements = new Set(selected.flatMap(unit => unit.elements)), selectedIds = new Set(selected.map(unit => unit.object_id));
            const containers = [...this.editor.root.querySelectorAll('table,ul,ol')].filter(container => {
                const members = units.filter(unit => unit.elements.some(el => container.contains(el)));
                return members.length && members.every(unit => selectedIds.has(unit.object_id) || (!unit.text && unit.elements.every(el => range.comparePoint(el, 0) === 0 && range.comparePoint(el, el.childNodes.length) === 0))) && ownedTextNodes(container).filter(node => node.length).every(node => range.comparePoint(node, 0) === 0 && range.comparePoint(node, node.length) === 0);
            });
            const emitted = new Set();
            for (const unit of selected) {
                const first = unit.elements[0], complete = containers.find(container => container.contains(first) && !containers.some(parent => parent !== container && parent.contains(container)));
                if (complete) { if (!emitted.has(complete)) { box.append(complete.cloneNode(true)); emitted.add(complete); } continue; }
                if (unit.elements.some(el => [...selectedElements].some(parent => parent !== el && parent.contains(el)))) continue;
                const node = first.cloneNode(false); node.dataset.uthOffset = '0';
                for (const el of unit.elements) node.append(...[...el.childNodes].map(child => child.cloneNode(true)));
                for (const nested of node.querySelectorAll('li[data-uth-id]')) if (!selectedIds.has(nested.dataset.uthId)) nested.remove();
                for (const list of node.querySelectorAll('ul,ol')) if (!list.children.length) list.remove();
                if (node.tagName === 'LI') { const list = document.createElement(first.parentElement.tagName.toLowerCase()); list.append(node); box.append(list); }
                else if (['TD', 'TH'].includes(node.tagName)) { const table = document.createElement('table'), row = table.insertRow(); row.append(node); box.append(table); }
                else box.append(node);
            }
            // A copied table/list is a new structure rather than a continuation
            // of the original paginator's flow.
            for (const el of box.querySelectorAll('[data-flow]')) el.removeAttribute('data-flow');
            this.clipboard = { handle: id(), artifact: this.editor.store.document.id, html: box.innerHTML };
        } else { box.append(range.cloneContents()); this.clipboard = null; }
        const payload = { text: this.editor.selectedText(), html: publicHTML(box.innerHTML), handle: this.clipboard?.handle || '' };
        if (e?.clipboardData) { e.preventDefault(); e.clipboardData.setData('text/plain', payload.text); e.clipboardData.setData('text/html', payload.html); if (payload.handle) e.clipboardData.setData('application/x-uthereal-word-copy', payload.handle); }
        return payload;
    }
    copiedHTML(handle) {
        if (!this.clipboard || this.clipboard.handle !== handle || this.clipboard.artifact !== this.editor.store.document.id) return null;
        const box = document.createElement('div'); box.innerHTML = this.clipboard.html;
        const keys = new Map();
        for (const el of groundingElements(box)) { const old = el.dataset.uthId; if (!keys.has(old)) keys.set(old, id()); el.dataset.uthId = keys.get(old); setAnnotations(el, annotations(el).map(a => ({ ...a, id: id() }))); }
        return box.innerHTML;
    }
}
