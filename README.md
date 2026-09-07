# Quire

**A working, local-first, Word-inspired document editor in plain HTML, CSS, and JavaScript.**

Quire combines a familiar ribbon, real paginated editing, document tools, and an actual WebGPU page compositor. The application has no runtime dependencies, framework, build-service requirement, external fonts, CDN, telemetry, or cloud account.

This is an initial implementation, not a claim of complete Microsoft Word parity, certified OOXML conformance, or production validation across all browsers. Its implemented scope and remaining boundaries are explicit below. Quire is independent and is not affiliated with Microsoft.

## Run

Build the self-contained `Quire.html` with `npm run build`, then open it directly for a quick start. Generated HTML is not checked into Git. Browser policy determines whether file-origin storage, clipboard access, and WebGPU are available; the application reports the actual renderer and storage state.

For a stable origin and the intended WebGPU path, serve the application on localhost or an HTTPS static host:

```sh
cd quire
npm start
```

Open `http://localhost:4173`. Node 18 or later is sufficient. There is no `npm install` step for running or building the app. The bundled server is a development server, not a hardened public web server.

```sh
# Rebuild the standalone file after editing the source.
npm run build

# Another port, on shells supporting environment assignments.
PORT=8080 npm start
```

Deploy `index.html` and `src/` together to a static host, or deploy only `Quire.html` as `index.html`. No server API is used. Do not open the modular `index.html` via `file://`; use the standalone file or HTTP server instead.

## GitHub Pages

The repository includes `.github/workflows/pages.yml`. After GitHub Pages is enabled with **GitHub Actions** as its source, pushes to `main` build and deploy the application automatically. The workflow can also be dispatched manually.

```sh
npm run build:pages
```

The build writes `_site/index.html` and `_site/Quire.html` from the self-contained build, plus `.nojekyll`. Only `_site/` is uploaded, not the repository, test output, or publishing scripts. This works at the project path `/Quire/` without root-relative module or stylesheet URLs. No runtime npm dependencies or external assets are required.

The deployment job is separate from the read-only build job and has only `contents: read`, `pages: write`, and `id-token: write` permissions. The existing browser-integration workflow remains independent.

Deployment configuration: [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [Pages REST API](https://docs.github.com/en/rest/pages/pages).

## Implemented workspace

The initial document, **The clarity report**, is an editable three-page sample. Its research figures are illustrative, not real research findings. Use **File → Blank document** to start from scratch. Report, project-brief, and meeting-notes templates are included.

The interface includes eight editing ribbon tabs: **Home, Insert, Draw, Design, Layout, References, Review, and View**, plus the File workspace. Navigation has heading, page, and search-result views. Comments, revisions, and document insights occupy an optional side panel. Light/dark chrome, focus mode, zoom, page-fit controls, a ruler, and a command palette are implemented.

### Editing

- Native text entry, selection, caret, clipboard handling, and composition/IME integration. Formatting uses DOM Range operations, not `document.execCommand`.
- Bold, italic, underline, strikethrough, subscript, superscript, font family/size, text color, highlight, case conversion, formatting removal, and a format painter.
- Paragraph styles, headings, alignment, indentation, line spacing, bullets, and numbered lists.
- Undo and redo with bounded document snapshots and typing coalescence.
- Paginated flow; long paragraphs split at whitespace, tables at row boundaries, and lists at item boundaries. Reflow rejoins fragments first and preserves text-offset selection bookmarks.
- Explicit page breaks, page size, orientation, margins, running headers, and footer page numbers.

### Document tools

- Tables with row and column insertion, and table deletion.
- Embedded uploaded images, editable display width and alternative text, and a data-driven bar-chart image generator.
- Hyperlinks, symbols, dates, editable Unicode equations, and separators.
- Heading-derived table of contents, citation text, and linked document endnotes.
- Anchored comments, resolve/reopen/delete actions, and basic tracked text insertions/deletions with accept/reject.
- Page-attached pen/highlighter strokes, erasing, and undoable ink.
- Cross-formatting-boundary find/replace, document statistics in a worker, browser spellcheck, and browser speech-synthesis reading.

### Persistence and files

IndexedDB stores the local document library and current-document pointer. Writes are serialized. When storage is denied, documents remain in a session-only in-memory library and the title bar explicitly says **“Session only · export a copy.”** That fallback does not survive closing the tab.

Export `.quire` copies for your own backups even when autosave is available. Browser storage is not a durable backup system and the application does not encrypt it.

| Format | Open/import | Export | Scope |
| --- | --- | --- | --- |
| `.quire` / JSON | Yes | Yes | Native versioned data: supported HTML, layout, comments, revisions, and ink. Import normalizes IDs and layout values. |
| `.docx` | Yes, bounded subset | Yes, real OOXML ZIP | Common paragraphs/runs, headings, direct formatting, lists, tables, inline images, hyperlinks, comments, basic revisions, and exported header/footer parts. Advanced layouts differ. |
| `.html` | Sanitized HTML | Self-contained HTML | Supported rich text and embedded images; Quire-specific metadata is not lossless. |
| `.md` | Basic Markdown | Basic Markdown | Headings, emphasis, links, lists, quotes, simple tables on export, and images on export. Not a complete CommonMark implementation. |
| `.txt` | Yes | Yes | Plain text, with formatting loss by design. |
| Print / PDF | No PDF import | Browser print dialog | Uses print styles and actual laid-out pages; Save as PDF depends on the browser/platform. |

DOCX export writes real Open Packaging Convention ZIP parts and WordprocessingML, not HTML renamed to `.docx`. The dependency-free writer uses ZIP STORE. Import supports STORE and raw DEFLATE through `DecompressionStream`, rejects encrypted containers and unsafe paths, checks CRC and sizes, and bounds inflated data. It does not support legacy binary `.doc`, `.docm` macros, encrypted Word files, or ZIP64.

## Rendering architecture: what actually runs on the GPU

**Editing is hybrid, deliberately.** WebGPU draws the page surfaces. Browser DOM layout and text rendering handle editable text, complex shaping, selection, accessibility, and IME. There is no custom glyph shaper, GPU paragraph-layout engine, or GPU caret engine disguised behind the WebGPU indicator.

**Reading mode uses GPU page textures.** For each uncached visible page, `PageRasterizer` copies computed styles into an isolated page snapshot, rasterizes that snapshot with the browser, verifies that the resulting canvas is origin-clean, and uploads it with `GPUQueue.copyExternalImageToTexture`. WebGPU then draws textured page quads. DOM pages remain present, and are only visually replaced after a corresponding texture is ready. Editing mode immediately restores the live DOM.

`GPUPageRenderer` provides:

- WGSL surface and texture pipelines, asynchronous pipeline creation, and validation error scopes.
- Instanced rounded page surfaces and a grow-only, power-of-two instance buffer.
- Viewport culling and demand-driven animation frames, without a perpetual idle rendering loop.
- A revision-aware, maximum-eight-page LRU texture cache and stale-work rejection.
- Device-limit-aware canvas resolution, device-loss fallback, and snapshot-failure fallback.
- Actual backend, draw-call, visible-page, cache-memory, and CPU submission statistics.

The surface pass needs one instanced draw when there are visible pages. The current reading path adds one draw per textured page. This is not a performance benchmark or a promise of a particular frame rate. Full DOM pagination is still CPU/main-thread work and is not incremental; very large documents can incur significant reflow cost.

The renderer can be inspected through the **About** dialog at the bottom of the activity rail, or through `quire.renderer.stats` in the console. A GPU label is only displayed after adapter/device/pipeline initialization succeeds. Errors return the document to DOM rendering rather than hiding the document.

## Source map

| File | Responsibility |
| --- | --- |
| `index.html` | Accessible application shell and input surfaces. |
| `src/styles.css` | Design tokens, ribbon, panels, page typography, responsive layout, and print styles. |
| `src/core.js` | Validation/sanitization, document transactions/history, local repository, selection bookmarks, pagination, Range editing, search, worker statistics. |
| `src/renderer.js` | WGSL shaders, GPU resources, page rasterization, culling, caching, validation, and fallback. |
| `src/io.js` | CRC32, bounded ZIP parser, ZIP writer, OOXML mapping, HTML/Markdown/plain-text IO. |
| `src/app.js` | Ribbon commands, dialogs, comments/revisions, ink, navigation, persistence coordination, keyboard shortcuts, and bootstrap. |
| `src/templates.js` | Editable sample documents. |
| `src/icons.js` | Original inline SVG interface icons. |
| `build.mjs` | Controlled-module standalone bundler with isolated scopes. |
| `server.mjs` | Dependency-free local static server. |
| `tests/test_editor.py` | Browser integration, file-format, and renderer-preparation checks. |

The internal document representation is a versioned, serializable collection of page HTML fragments with explicit layout, comment, and ink data. It is not a CRDT, immutable rich-text AST, or clone of Word's document object model. The separation into store, editor, paginator, renderer, and IO makes those individual subsystems replaceable.

### Developer API

After bootstrap, `window.quire` exposes the working engine and commands:

```js
const q = window.quire;

// Replace the current document after exporting/saving any work to preserve.
q.store.replace(q.createDocument(
    'A new idea',
    '<h1>A new idea</h1><p>Start writing here.</p>'
));

// Commands use the current or remembered editing selection.
q.editor.insertText(' More text.');
q.actions.undo();
q.actions.redo();
q.runSearch('writing');
q.setZoom(100);
q.setReading(true);

console.table(q.renderer.stats);
console.table(q.paginator.stats);

// Blob-producing API, without initiating a download.
const docxBlob = q.exportDocx();

// Normal application export command, initiating a download.
q.actions['export-quire']();
```

Direct `createDocument`/`insertHTML` calls are trusted developer APIs. Pass untrusted HTML through `quire.sanitizeHTML` or use `quire.importFile`. Imported files and pasted HTML are sanitized by their normal entry points.

## Verification

The included `tests/test-results.json` records the actual delivery-time browser run: **35 passing checks, zero failures, and one explicitly unrun verification group**. The tests exercise real browser editing, range formatting, decoration removal, pagination and fragment recombination, cross-page replacement, comments, revisions, image sizing, table edits, file templates, ink undo, sanitization, native import validation, command UI, responsive behavior, DOCX ZIP/XML export, DEFLATE import, and origin-clean page rasterization.

The available managed browser blocked normal URL navigation, so this run used the built standalone file injected into an inline `about:blank` document. That context did not expose WebGPU or permit persistent IndexedDB. Consequently:

- The real DOM fallback and in-memory document library were tested.
- Browser page rasterization was tested and produced a nonempty, origin-clean page image.
- **Actual GPU adapter execution, shader validation on a real device, texture upload/draw, device-loss behavior, and persistent IndexedDB reload were not validated in this environment.**
- The DOCX checks validate ZIP integrity, XML well-formedness, and selected OOXML parts/elements. They are not a complete OOXML schema validation and do not replace opening representative files in Microsoft Word.

### Run tests on your machine

Python test dependencies are development-only:

```sh
python -m pip install -r requirements-test.txt
python -m playwright install chromium
npm run build
```

Start the server in another terminal with `npm start`, then run:

```sh
# Actual-origin editing, UI, export/import, and persistence tests.
python tests/test_editor.py --url http://localhost:4173

# Also require WebGPU initialization, reading textures, and GPU draws.
python tests/test_editor.py --url http://localhost:4173 --gpu

# Explicit software WebGPU testing on suitable Chromium installations.
# This is API validation, not a physical-GPU performance measurement.
python tests/test_editor.py --url http://localhost:4173 --gpu --software-gpu

# Inline fallback run used for the supplied report.
python tests/test_editor.py --inline
```

Set `CHROMIUM_PATH` to use a particular Chromium executable. A supported secure context, enabled adapter, and compatible platform are required for `--gpu`; the test intentionally fails instead of substituting a fake renderer. `.github/workflows/test.yml` runs the normal-origin suite, not a hardware performance benchmark.

## Known boundaries

Quire is useful as a standalone editor and extensible starting codebase, but is not yet a complete replacement for Word. Specifically:

- No real-time collaboration, cloud sync, accounts, CRDT/OT merge, mail merge, macros, or plugin security sandbox.
- No exact Word typography/layout parity, advanced fields, full section model, multicolumn layout, floating text wrapping, native footnotes, or native Office Math equation layout. The equation tool inserts editable Unicode text. Endnotes are linked document text.
- Tracked changes primarily cover text insertion/deletion; formatting, tables, moves, complex paste, and all IME replacement cases are not full-fidelity Word revisions.
- Tables split between rows and lists between items. A single over-height row, complex nested structure, rowspan spanning a page boundary, or very tall image is not internally subdivided. Such content is preserved, not silently discarded; manual editing may be required. Repeated table headers and widow/orphan control are not implemented.
- DOCX import/export is deliberately lossy outside the supported subset. CSS grids flatten, complex nested numbering and restart rules may differ, imported comments are retained as notes rather than exact original anchors, and imported headers/footers/section structures are not fully restored. Paginated HTML fragments may become separate Word paragraphs/tables on export.
- Ink is page-attached, not text-anchored. Reflow can move text beneath it. Native `.quire` saves and print retain ink; DOCX/Markdown exports do not retain editable ink. Browser page snapshots are not guaranteed identical across engines.
- Browser-owned selection, clipboard, spellcheck, speech, printing, accessibility exposure, and storage remain subject to browser/OS support and policy. Read-aloud voices and enhanced spellcheck may use platform/provider services; Quire itself makes no document-upload or AI-service requests.
- No cross-browser accessibility certification, exhaustive IME/RTL validation, independent security audit, Word compatibility corpus, or measured large-document/GPU performance budget has been completed.

## Security and privacy

Normal file import and HTML paste rebuild a whitelist of elements, classes, and styles; strip scripts, handlers, forms, SVG/MathML embeds, external-image loads, and CSS URL expressions; validate hyperlink protocols; and bound document/container dimensions. Uploaded images are embedded as data URLs. Native import also validates identifiers, dates, layout values, and numeric zoom. These are meaningful safeguards, not a guarantee against every adversarial document or browser vulnerability.

The app does not send document content to a server. Its small static server only serves files. Optional user-clicked hyperlinks and browser/platform features follow their own policies. For sensitive documents, use a trusted browser profile, disable unwanted cloud-assisted browser services, and maintain exported backups.

## Reference APIs and formats

- WebGPU: https://www.w3.org/TR/webgpu/
- MDN WebGPU overview: https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
- Canvas-to-texture upload: https://developer.mozilla.org/en-US/docs/Web/API/GPUQueue/copyExternalImageToTexture
- Native input events: https://developer.mozilla.org/en-US/docs/Web/API/Element/beforeinput_event
- WordprocessingML structure: https://learn.microsoft.com/en-us/office/open-xml/word/structure-of-a-wordprocessingml-document
- Raw DEFLATE import: https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream

## License

MIT; see `LICENSE`. No Microsoft assets or font files are bundled.
