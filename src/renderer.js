/**
 * QuireGPU — demand-driven, visible-page WebGPU compositor.
 * Editing: GPU page surfaces + accessible DOM text/selection/IME.
 * Reading: browser-shaped page snapshots uploaded as GPU textures.
 * No raster loop runs while idle. No browser-support claim is simulated.
 */
import { Emitter } from './core.js';
const RECT_SHADER = `
struct View { size: vec2f, padding: vec2f };
@group(0) @binding(0) var<uniform> view: View;
struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f, @location(1) size: vec2f, @location(2) color: vec4f, @location(3) radius: f32 };
@vertex fn vs(@builtin(vertex_index) vertex: u32, @location(0) rect: vec4f, @location(1) color: vec4f, @location(2) radius: f32) -> Out {
 let corners=array<vec2f,6>(vec2f(0.,0.),vec2f(1.,0.),vec2f(0.,1.),vec2f(0.,1.),vec2f(1.,0.),vec2f(1.,1.));
 let uv=corners[vertex];let pixel=rect.xy+uv*rect.zw;var o:Out;
 o.position=vec4f(pixel/view.size*vec2f(2.,-2.)+vec2f(-1.,1.),0.,1.);o.uv=uv;o.size=rect.zw;o.color=color;o.radius=radius;return o;
}
@fragment fn fs(i:Out)->@location(0) vec4f {
 let p=abs((i.uv-vec2f(.5))*i.size)-i.size*.5+vec2f(i.radius);
 let distance=length(max(p,vec2f(0.)))+min(max(p.x,p.y),0.)-i.radius;
 let alpha=i.color.a*(1.-smoothstep(-.6,.6,distance));return vec4f(i.color.rgb*alpha,alpha);
}`;
const TEXTURE_SHADER = `
struct View { size: vec2f, padding: vec2f };
@group(0) @binding(0) var<uniform> view: View;
@group(1) @binding(0) var pageSampler: sampler;
@group(1) @binding(1) var pageTexture: texture_2d<f32>;
struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vertex: u32,@location(0) rect:vec4f)->Out {
 let corners=array<vec2f,6>(vec2f(0.,0.),vec2f(1.,0.),vec2f(0.,1.),vec2f(0.,1.),vec2f(1.,0.),vec2f(1.,1.));
 var o:Out;let uv=corners[vertex];o.position=vec4f((rect.xy+uv*rect.zw)/view.size*vec2f(2.,-2.)+vec2f(-1.,1.),0.,1.);o.uv=uv;return o;
}
@fragment fn fs(i:Out)->@location(0) vec4f{return textureSample(pageTexture,pageSampler,i.uv);}`;
const cssSnapshotProperties = ['display', 'position', 'box-sizing', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'line-height', 'letter-spacing', 'word-spacing', 'white-space', 'overflow-wrap', 'word-break', 'text-align', 'text-indent', 'text-transform', 'text-decoration', 'text-decoration-color', 'color', 'background-color', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-collapse', 'border-spacing', 'border-radius', 'vertical-align', 'list-style-type', 'list-style-position', 'float', 'clear', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap', 'grid-template-columns', 'grid-template-rows', 'top', 'left', 'right', 'bottom', 'opacity'];
export class PageRasterizer {
    async rasterize(paper, scale = 1.5) {
        const width = paper.offsetWidth, height = paper.offsetHeight, clone = paper.cloneNode(true);
        const sourceElements = [paper, ...paper.querySelectorAll('*')], cloneElements = [clone, ...clone.querySelectorAll('*')];
        sourceElements.forEach((source, i) => { const target = cloneElements[i], style = getComputedStyle(source); for (const property of cssSnapshotProperties) {
            const value = style.getPropertyValue(property);
            if (value)
                target.style.setProperty(property, value);
        } target.style.visibility = 'visible'; target.removeAttribute('contenteditable'); target.removeAttribute('id'); target.removeAttribute('role'); target.removeAttribute('spellcheck'); if (source.hidden)
            target.style.display = 'none'; });
        Object.assign(clone.style, { transform: 'none', position: 'relative', top: '0', left: '0', width: width + 'px', height: height + 'px', backgroundColor: '#ffffff', boxShadow: 'none', margin: '0' });
        clone.classList.remove('gpu-rasterized');
        const root = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
        root.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        root.style.cssText = `width:${width}px;height:${height}px;overflow:hidden;background:#ffffff`;
        root.append(clone);
        const xml = new XMLSerializer().serializeToString(root);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}"><foreignObject width="${width}" height="${height}">${xml}</foreignObject></svg>`;
        const image = new Image();
        image.decoding = 'async';
        const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('Page snapshot could not be rasterized.')); image.src = url; });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(width * scale);
        canvas.height = Math.ceil(height * scale);
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        // Accessing pixels verifies origin cleanliness before the WebGPU upload.
        ctx.getImageData(0, 0, 1, 1);
        return canvas;
    }
}
export class GPUPageRenderer extends Emitter {
    constructor(canvas, viewport, root) { super(); this.canvas = canvas; this.viewport = viewport; this.root = root; this.ready = false; this.reading = false; this.framePending = false; this.disposed = false; this.revision = 0; this.cache = new Map(); this.pending = new Map(); this.failed = new Map(); this.maxTextures = 8; this.capacity = 0; this.rasterizer = new PageRasterizer(); this.stats = { backend: 'DOM', drawCalls: 0, visiblePages: 0, textureBytes: 0, frames: 0, cpuMs: 0, lastError: null }; this.schedule = this.schedule.bind(this); this.viewport.addEventListener('scroll', this.schedule, { passive: true }); this.observer = new ResizeObserver(this.schedule); this.observer.observe(viewport); this.observer.observe(root); this.resizeWindow = () => this.schedule(); window.addEventListener('resize', this.resizeWindow); this.themeObserver = new MutationObserver(() => this.schedule()); this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] }); }
    async initialize() {
        if (new URLSearchParams(window.location.search).get('renderer') === 'dom') {
            this.fallback('DOM renderer selected');
            return false;
        }
        let scope = false;
        try {
            if (!navigator.gpu)
                throw new Error('WebGPU is not exposed in this browser or context.');
            this.adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
            if (!this.adapter)
                throw new Error('No WebGPU adapter was available.');
            this.device = await this.adapter.requestDevice();
            this.device.lost.then(info => { if (!this.disposed)
                this.fallback(`GPU device lost: ${info.message || info.reason}`); });
            this.device.addEventListener('uncapturederror', event => { console.error('QuireGPU validation:', event.error); if (!this.disposed)
                this.fallback(event.error.message); });
            this.device.pushErrorScope('validation');
            scope = true;
            this.context = this.canvas.getContext('webgpu');
            if (!this.context)
                throw new Error('A WebGPU canvas context was not available.');
            this.format = navigator.gpu.getPreferredCanvasFormat();
            this.context.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' });
            this.viewBuffer = this.device.createBuffer({ label: 'quire.viewport', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            const viewLayout = this.device.createBindGroupLayout({ label: 'quire.viewport-layout', entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }] });
            this.viewGroup = this.device.createBindGroup({ layout: viewLayout, entries: [{ binding: 0, resource: { buffer: this.viewBuffer } }] });
            const rectModule = this.device.createShaderModule({ label: 'quire.rounded-surfaces', code: RECT_SHADER });
            const vertexBuffers = [{ arrayStride: 36, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }, { shaderLocation: 2, offset: 32, format: 'float32' }] }];
            this.surfacePipeline = await this.device.createRenderPipelineAsync({ label: 'quire.surface-pipeline', layout: this.device.createPipelineLayout({ bindGroupLayouts: [viewLayout] }), vertex: { module: rectModule, entryPoint: 'vs', buffers: vertexBuffers }, fragment: { module: rectModule, entryPoint: 'fs', targets: [{ format: this.format, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] }, primitive: { topology: 'triangle-list' } });
            this.textureLayout = this.device.createBindGroupLayout({ label: 'quire.page-texture-layout', entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }] });
            const textureModule = this.device.createShaderModule({ label: 'quire.page-textures', code: TEXTURE_SHADER });
            this.texturePipeline = await this.device.createRenderPipelineAsync({ label: 'quire.texture-pipeline', layout: this.device.createPipelineLayout({ bindGroupLayouts: [viewLayout, this.textureLayout] }), vertex: { module: textureModule, entryPoint: 'vs', buffers: [{ arrayStride: 36, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }] }] }, fragment: { module: textureModule, entryPoint: 'fs', targets: [{ format: this.format }] }, primitive: { topology: 'triangle-list' } });
            this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });
            const pendingValidation = this.device.popErrorScope();
            scope = false;
            const validation = await pendingValidation;
            if (validation)
                throw new Error(validation.message);
            await this.device.queue.onSubmittedWorkDone();
            this.ready = true;
            this.stats.backend = 'WebGPU';
            document.body.classList.add('gpu-ready');
            this.emit('ready', { adapter: this.adapter.info });
            this.schedule();
            return true;
        }
        catch (error) {
            if (scope)
                await this.device.popErrorScope().catch(() => null);
            this.fallback(error.message);
            return false;
        }
    }
    fallback(reason) { this.ready = false; for (const entry of this.cache.values())
        entry.texture.destroy(); this.cache.clear(); this.stats.textureBytes = 0; this.stats.backend = 'DOM'; this.stats.lastError = reason; document.body.classList.remove('gpu-ready'); this.root.querySelectorAll('.gpu-rasterized').forEach(p => p.classList.remove('gpu-rasterized')); this.emit('fallback', reason); }
    setReading(value) { this.reading = value; if (!value)
        this.root.querySelectorAll('.gpu-rasterized').forEach(p => p.classList.remove('gpu-rasterized')); this.schedule(); }
    invalidate() { this.revision++; this.failed.clear(); for (const entry of this.cache.values())
        entry.texture.destroy(); this.cache.clear(); this.stats.textureBytes = 0; this.root.querySelectorAll('.gpu-rasterized').forEach(p => p.classList.remove('gpu-rasterized')); this.schedule(); }
    schedule() { if (this.framePending || this.disposed)
        return; this.framePending = true; requestAnimationFrame(() => { this.framePending = false; try {
        this.render();
    }
    catch (error) {
        this.fallback(error.message);
    } }); }
    ensureCapacity(count) { if (this.capacity >= count)
        return; this.buffer?.destroy(); this.capacity = Math.max(32, 2 ** Math.ceil(Math.log2(count))); this.buffer = this.device.createBuffer({ label: 'quire.page-instances', size: this.capacity * 36, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }); this.data = new Float32Array(this.capacity * 9); }
    async cachePage(slot) {
        const id = slot.dataset.pageId, revision = this.revision;
        if (this.pending.has(id) || this.cache.has(id) || this.failed.get(id) === revision)
            return;
        this.pending.set(id, revision);
        let texture = null, scope = false;
        try {
            const bitmap = await this.rasterizer.rasterize(slot.querySelector('.paper'), Math.min(window.devicePixelRatio || 1, 1.5));
            if (this.disposed || !this.ready || revision !== this.revision || !this.reading)
                return;
            this.device.pushErrorScope('validation');
            scope = true;
            texture = this.device.createTexture({ label: `quire.page.${id}`, size: [bitmap.width, bitmap.height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
            this.device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, { width: bitmap.width, height: bitmap.height });
            const bindGroup = this.device.createBindGroup({ layout: this.textureLayout, entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: texture.createView() }] });
            const validationPromise = this.device.popErrorScope();
            scope = false;
            const validation = await validationPromise;
            if (validation)
                throw new Error(validation.message);
            if (this.disposed || !this.ready || revision !== this.revision || !this.reading) {
                texture.destroy();
                texture = null;
                return;
            }
            this.cache.set(id, { texture, bindGroup, revision, lastUsed: performance.now(), bytes: bitmap.width * bitmap.height * 4 });
            texture = null;
            while (this.cache.size > this.maxTextures) {
                const [oldId, entry] = [...this.cache].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
                entry.texture.destroy();
                this.cache.delete(oldId);
                const old = this.root.querySelector(`[data-page-id="${CSS.escape(oldId)}"] .paper`);
                old?.classList.remove('gpu-rasterized');
            }
            this.stats.textureBytes = [...this.cache.values()].reduce((s, e) => s + e.bytes, 0);
            this.schedule();
        }
        catch (error) {
            if (scope)
                await this.device.popErrorScope().catch(() => null);
            texture?.destroy();
            this.failed.set(id, revision);
            this.stats.lastError = error.message;
            this.emit('snapshot-error', error.message);
        }
        finally {
            this.pending.delete(id);
            if (revision !== this.revision && this.reading)
                this.schedule();
        }
    }
    render() {
        if (!this.ready || this.disposed)
            return;
        const started = performance.now(), view = this.viewport.getBoundingClientRect();
        if (view.width < 1 || view.height < 1)
            return;
        const width = this.viewport.clientWidth, height = this.viewport.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2, this.device.limits.maxTextureDimension2D / width, this.device.limits.maxTextureDimension2D / height);
        Object.assign(this.canvas.style, { left: view.left + 'px', top: view.top + 'px', width: width + 'px', height: height + 'px' });
        const pxW = Math.max(1, Math.round(width * dpr)), pxH = Math.max(1, Math.round(height * dpr));
        if (this.canvas.width !== pxW || this.canvas.height !== pxH) {
            this.canvas.width = pxW;
            this.canvas.height = pxH;
        }
        const visible = [...this.root.children].map(slot => ({ slot, rect: slot.getBoundingClientRect() })).filter(({ rect }) => rect.bottom >= view.top - 8 && rect.top <= view.top + height + 8 && rect.right >= view.left && rect.left <= view.left + width);
        this.ensureCapacity(Math.max(1, visible.length * 4));
        this.device.queue.writeBuffer(this.viewBuffer, 0, new Float32Array([width, height, 0, 0]));
        let count = 0;
        const textureDraws = [];
        const put = (x, y, w, h, color, radius = 0) => { const at = count++; this.data.set([x, y, w, h, ...color, radius], at * 9); return at; };
        const dark = document.body.classList.contains('dark');
        for (const { slot, rect } of visible) {
            const x = rect.left - view.left, y = rect.top - view.top, w = rect.width, h = rect.height;
            put(x - 3, y + 1, w + 6, h + 6, [.1, .16, .23, .025], 2);
            put(x - 1, y, w + 2, h + 2, [.35, .44, .54, dark ? .4 : .16], 1);
            const paperInstance = put(x, y, w, h, [1, 1, 1, 1]);
            if (this.reading) {
                const cached = this.cache.get(slot.dataset.pageId);
                if (cached?.revision === this.revision) {
                    cached.lastUsed = performance.now();
                    textureDraws.push({ index: paperInstance, bindGroup: cached.bindGroup });
                    slot.querySelector('.paper').classList.add('gpu-rasterized');
                }
                else {
                    slot.querySelector('.paper').classList.remove('gpu-rasterized');
                    this.cachePage(slot);
                }
            }
        }
        this.device.queue.writeBuffer(this.buffer, 0, this.data, 0, count * 9);
        const encoder = this.device.createCommandEncoder({ label: 'quire.frame' });
        const pass = encoder.beginRenderPass({ label: 'quire.page-composition', colorAttachments: [{ view: this.context.getCurrentTexture().createView(), clearValue: dark ? { r: 21 / 255, g: 30 / 255, b: 40 / 255, a: 1 } : { r: 237 / 255, g: 240 / 255, b: 244 / 255, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
        pass.setPipeline(this.surfacePipeline);
        pass.setBindGroup(0, this.viewGroup);
        pass.setVertexBuffer(0, this.buffer);
        if (count)
            pass.draw(6, count);
        if (textureDraws.length) {
            pass.setPipeline(this.texturePipeline);
            for (const draw of textureDraws) {
                pass.setBindGroup(1, draw.bindGroup);
                pass.setVertexBuffer(0, this.buffer, draw.index * 36, 36);
                pass.draw(6, 1);
            }
        }
        pass.end();
        this.device.queue.submit([encoder.finish()]);
        this.stats.frames++;
        this.stats.visiblePages = visible.length;
        this.stats.drawCalls = (count ? 1 : 0) + textureDraws.length;
        this.stats.cpuMs = performance.now() - started;
        this.emit('frame', this.stats);
    }
    dispose() { this.disposed = true; this.observer.disconnect(); this.themeObserver.disconnect(); this.viewport.removeEventListener('scroll', this.schedule); window.removeEventListener('resize', this.resizeWindow); this.invalidate(); this.buffer?.destroy(); this.viewBuffer?.destroy(); this.device?.destroy(); }
}
