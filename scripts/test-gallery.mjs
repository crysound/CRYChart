import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import ts from 'typescript';
import { connectVisibleChrome, ensureTestServer, showStep } from './visible-browser.mjs';

const root = resolve(process.cwd());
const millionOnly = process.argv.includes('--million-only');
const millionCheckName = 'one million source samples are retained and actually drawn from the complete projected data';
const port = Number(process.env.CRYCHART_PORT ?? 4178);
assert.ok(Number.isInteger(port) && port > 0 && port < 65536, 'CRYCHART_PORT must be a valid TCP port');
if (!existsSync(resolve(root, 'dist/gallery.js'))) throw new Error('Run npm run build before the gallery browser checks.');
const source = ts.createSourceFile('recipes.ts', await readFile(resolve(root, 'examples/recipes.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
let manifest = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'recipes' && ts.isArrayLiteralExpression(node.initializer)) {
    manifest = node.initializer.elements.map(item => {
      const value = name => item.properties.find(property => property.name?.getText(source) === name)?.initializer;
      return { id: value('id')?.text, title: value('title')?.text, references: value('references')?.elements.map(item => item.text), limitation: value('limitation')?.text ?? null };
    });
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(manifest.length >= 24, 'The recipe manifest was not found');
assert.equal(new Set(manifest.map(item => item.id)).size, manifest.length);
const artifacts = resolve(root, process.env.CRYCHART_GALLERY_EVIDENCE ?? 'codex_artifact/gallery');
await mkdir(artifacts, { recursive: true });
const server = await ensureTestServer(port);
const address = `http://127.0.0.1:${port}`;
const report = { observedAt: new Date().toISOString(), browser: 'Visible Google Chrome', browserVisible: true, headless: false, viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1, recipes: [], interactions: [], errors: [], parityClaim: false, limits: 'These tests establish local execution, visible paint and selected interactions. They do not establish visual or behavioral equivalence to all official examples, or CRYChart performance parity.' };
report.focus = millionOnly ? 'million-only' : 'full-gallery';
let browser;
try {
  // The gallery bundles its own copy of the chart library. Checking crychart.js
  // alone cannot establish which build the gallery actually executes.
  report.workspace = root;
  report.baseURL = address;
  report.servedAssets = {};
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  for (const name of ['examples/index.html', 'dist/gallery.js']) {
    const expected = sha256(await readFile(resolve(root, name)));
    const response = await fetch(`${address}/${name}`, { cache: 'no-store' });
    assert.ok(response.ok, `Cannot load the selected gallery asset: ${name}`);
    const actual = sha256(Buffer.from(await response.arrayBuffer()));
    assert.equal(actual, expected, `Another workspace/build is using the requested test port: ${name}`);
    report.servedAssets[name] = { expectedSHA256: expected, servedSHA256: actual };
  }
  const connected = await connectVisibleChrome(); browser = connected.browser;
  report.browserVersion = browser.version();
  report.browserMetadata = connected.metadata;
  const page = connected.page;
  await page.setViewportSize(report.viewport); await page.bringToFront();
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    window.__galleryCanvasContexts = new Map();
    window.__galleryCanvasText = new WeakMap();
    window.__galleryMillionDraws = new Map();
    window.__galleryMillionTraceEnabled = false;
    const instrumented = new WeakSet();
    HTMLCanvasElement.prototype.getContext = function (kind, ...options) {
      const context = original.call(this, kind, ...options);
      if (context) window.__galleryCanvasContexts.set(this, { kind, context });
      if (context && kind === 'webgl2' && !instrumented.has(context)) {
        instrumented.add(context);
        const observe = (mode, first, count, instances) => {
          if (window.__galleryMillionTraceEnabled) {
            const gl = context, program = gl.getParameter(gl.CURRENT_PROGRAM);
            const uniform = name => {
              const location = gl.getUniformLocation(program, name);
              return location ? Array.from(gl.getUniform(program, location)) : undefined;
            };
            const attribute = index => ({
              buffer: gl.getVertexAttrib(index, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING),
              size: gl.getVertexAttrib(index, gl.VERTEX_ATTRIB_ARRAY_SIZE),
              type: gl.getVertexAttrib(index, gl.VERTEX_ATTRIB_ARRAY_TYPE),
              stride: gl.getVertexAttrib(index, gl.VERTEX_ATTRIB_ARRAY_STRIDE),
              divisor: gl.getVertexAttrib(index, gl.VERTEX_ATTRIB_ARRAY_DIVISOR),
              offset: gl.getVertexAttribOffset(index, gl.VERTEX_ATTRIB_ARRAY_POINTER),
            });
            const observed = window.__galleryMillionDraws.get(gl) ?? {};
            const domain = uniform('u_domain'), defaultFramebuffer = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) === null;
            if (domain) observed.geometry = {
              mode, first, count, instances, domain, defaultFramebuffer,
              start: attribute(0), center: attribute(1),
              mask: !defaultFramebuffer ? gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME) : undefined,
            };
            const mask = gl.getUniformLocation(program, 'u_mask');
            if (mask && defaultFramebuffer) observed.composite = {
              mode, first, count, sampler: gl.getUniform(program, mask),
              texture: gl.getParameter(gl.TEXTURE_BINDING_2D),
            };
            window.__galleryMillionDraws.set(gl, observed);
          }
        };
        const draw = context.drawArrays, drawInstanced = context.drawArraysInstanced;
        context.drawArrays = function (mode, first, count) {
          observe(mode, first, count);
          return draw.call(context, mode, first, count);
        };
        context.drawArraysInstanced = function (mode, first, count, instances) {
          observe(mode, first, count, instances);
          return drawInstanced.call(context, mode, first, count, instances);
        };
      }
      return context;
    };
    const nativeText = CanvasRenderingContext2D.prototype.fillText;
    const nativeClear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...options) {
      const textList = window.__galleryCanvasText.get(this) ?? []; textList.push(String(text)); window.__galleryCanvasText.set(this, textList);
      return nativeText.call(this, text, ...options);
    };
    CanvasRenderingContext2D.prototype.clearRect = function (...options) {
      window.__galleryCanvasText.set(this, []); return nativeClear.call(this, ...options);
    };
  });
  // Ensure the diagnostics hooks are present even when reusing an already-open visible page.
  await page.goto(`${address}/examples/index.html`, { waitUntil: 'networkidle' });
  report.deviceScaleFactor = await page.evaluate(() => devicePixelRatio);
  const showProgress = (title, detail) => showStep(page, title, detail);
  let pageErrors = [], consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const mount = async id => {
    if (page.url().startsWith(address)) await page.evaluate(id => { location.hash = `demo=${id}`; }, id);
    else await page.goto(`${address}/examples/index.html#demo=${id}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(id => window.__CRY_GALLERY__?.selected === id && ['mounted', 'error'].includes(window.__CRY_GALLERY__.status), id);
    // Let the canvas render and collect enough live samples to validate visible data geometry.
    await page.waitForTimeout(180);
    const state = await page.evaluate(() => ({ status: window.__CRY_GALLERY__.status, detail: window.__CRY_GALLERY__.detail, ...window.__CRY_GALLERY__.snapshot() }));
    assert.equal(state.status, 'mounted', `${id}: ${state.detail}`);
    return state;
  };
  for (const [index, recipe] of (millionOnly ? [] : manifest).entries()) {
    pageErrors = []; consoleErrors = [];
    const started = performance.now(), result = { ...recipe, status: 'pending' };
    try {
      await showProgress(`可见 Chrome 测试 · ${index + 1} / ${manifest.length}`, `${recipe.title} · 检查实际图形、Canvas 和 WebGL 错误`);
      result.snapshot = await mount(recipe.id);
      result.canvas = await page.evaluate(() => [...document.querySelectorAll('#chart-stage canvas')].map(canvas => {
        const saved = window.__galleryCanvasContexts.get(canvas), bytes = new Uint8Array(canvas.width * canvas.height * 4), errors = [];
        if (saved?.kind === 'webgl2' || saved?.kind === 'webgl') {
          const gl = saved.context; gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
          for (let i = 0; i < 12; i++) { const error = gl.getError(); if (!error) break; errors.push(error); }
        } else if (saved?.kind === '2d') bytes.set(saved.context.getImageData(0, 0, canvas.width, canvas.height).data);
        let painted = 0, chromatic = 0, luminous = 0;
        for (let i = 0; i < bytes.length; i += 16) {
          if (bytes[i + 3] > 30) painted++;
          if (bytes[i + 3] > 100 && Math.max(bytes[i], bytes[i + 1], bytes[i + 2]) - Math.min(bytes[i], bytes[i + 1], bytes[i + 2]) > 45) chromatic++;
          if (bytes[i + 3] > 100 && Math.min(bytes[i], bytes[i + 1], bytes[i + 2]) > 140) luminous++;
        }
        return { backend: saved?.kind, width: canvas.width, height: canvas.height, paintedSamples: painted, chromaticSamples: chromatic, luminousSamples: luminous, glErrors: errors, visible: canvas.getBoundingClientRect().height > 50 };
      }));
      assert.ok(result.canvas.length > 0, `${recipe.id}: no canvas`);
      assert.ok(result.canvas.every(canvas => canvas.visible && canvas.width > 50 && canvas.height > 50), `${recipe.id}: invisible canvas`);
      assert.ok(result.canvas.reduce((sum, canvas) => sum + canvas.paintedSamples, 0) > 100, `${recipe.id}: no visible paint`);
      if (recipe.id === 'grid') {
        assert.equal(result.snapshot.charts[0].dataRows, 12);
        assert.ok(result.canvas.reduce((sum, canvas) => sum + canvas.luminousSamples, 0) > 200, 'grid: no visible table text');
      } else assert.ok(result.canvas.reduce((sum, canvas) => sum + canvas.chromaticSamples, 0) > 20, `${recipe.id}: no colored data geometry; axes alone cannot pass`);
      assert.deepEqual(result.canvas.flatMap(canvas => canvas.glErrors), [], `${recipe.id}: WebGL error`);
      assert.deepEqual(pageErrors, [], `${recipe.id}: uncaught page error`);
      assert.deepEqual(consoleErrors, [], `${recipe.id}: console error`);
      await page.locator('#chart-stage').screenshot({ path: resolve(artifacts, `${recipe.id}.png`) });
      result.status = 'local-render-passed';
    } catch (error) { result.status = 'failed'; result.error = error.message; report.errors.push({ recipe: recipe.id, message: error.message }); }
    result.elapsedMs = Math.round(performance.now() - started); report.recipes.push(result);
    console.log(`${result.status}: ${recipe.id}`);
  }
  async function check(name, action) {
    if (millionOnly && name !== millionCheckName) return;
    await showProgress('可见 Chrome · 交互验证', name);
    pageErrors = []; consoleErrors = [];
    try { const evidence = await action(); assert.deepEqual(pageErrors, [], `${name}: page error`); assert.deepEqual(consoleErrors, [], `${name}: console error`); report.interactions.push({ name, status: 'passed', evidence }); }
    catch (error) { report.interactions.push({ name, status: 'failed', error: error.message }); report.errors.push({ interaction: name, message: error.message }); }
  }
  await check('waveform wheel zoom changes the actual axis interval', async () => {
    const before = await mount('waveform'), rect = await page.locator('#chart-stage').boundingBox();
    await page.mouse.move(rect.x + rect.width * 0.55, rect.y + rect.height * 0.5); await page.mouse.wheel(0, -380); await page.waitForTimeout(160);
    const after = await page.evaluate(() => window.__CRY_GALLERY__.snapshot());
    assert.ok(after.charts[0].x.end - after.charts[0].x.start < before.charts[0].x.end - before.charts[0].x.start);
    return { before: before.charts[0].x, after: after.charts[0].x };
  });
  await check('legend click toggles the actual series visibility', async () => {
    await mount('waveform'); const rect = await page.locator('#chart-stage').boundingBox();
    await page.mouse.click(rect.x + rect.width - 65, rect.y + 70); await page.waitForTimeout(60);
    const hidden = await page.evaluate(() => window.__CRY_GALLERY__.snapshot()); assert.equal(hidden.charts[0].series[0].visible, false);
    await page.mouse.click(rect.x + rect.width - 65, rect.y + 70); const visible = await page.evaluate(() => window.__CRY_GALLERY__.snapshot()); assert.equal(visible.charts[0].series[0].visible, true);
    return { hidden: hidden.charts[0].series[0].visible, restored: visible.charts[0].series[0].visible };
  });
  await check('stream pause freezes samples and resume appends new samples', async () => {
    await mount('stream'); await page.waitForTimeout(200); await page.locator('#pause-button').click();
    const before = await page.evaluate(() => window.__CRY_GALLERY__.snapshot()); await page.waitForTimeout(250);
    const stopped = await page.evaluate(() => window.__CRY_GALLERY__.snapshot()); assert.equal(stopped.count, before.count); assert.equal(stopped.elapsed, before.elapsed);
    await page.locator('#pause-button').click(); await page.waitForTimeout(250); const resumed = await page.evaluate(() => window.__CRY_GALLERY__.snapshot()); assert.ok(resumed.count > stopped.count);
    return { before: before.count, paused: stopped.count, resumed: resumed.count };
  });
  await check('amplitude parameter rebuilds the chart with the expected range', async () => {
    await mount('waveform'); await page.locator('input[name=amplitude]').evaluate(input => { input.value = '2'; input.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(150);
    const snapshot = await page.evaluate(() => window.__CRY_GALLERY__.snapshot()); assert.deepEqual(snapshot.charts[0].y, { start: -3, end: 3 });
    return snapshot.charts[0].y;
  });
  await check('overview selection changes main axis and range band', async () => {
    await mount('zoom-band'); await page.getByLabel('概览窗口位置').evaluate(input => { input.value = '42'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    const snapshot = await page.evaluate(() => window.__CRY_GALLERY__.snapshot()); assert.deepEqual(snapshot.charts[0].x, { start: 42, end: 54 });
    return snapshot.charts[0].x;
  });
  await check('separate vertical axes retain distinct physical ranges', async () => {
    const snapshot = await mount('multi-axis'); assert.equal(snapshot.charts[0].yAxes.length, 2);
    assert.deepEqual(snapshot.charts[0].yAxes.map(axis => axis.interval), [{ start: 30, end: 65 }, { start: -3, end: 3 }]);
    return snapshot.charts[0].yAxes;
  });
  await check('gauge keyboard interaction changes actual value while paused', async () => {
    await mount('gauge'); await page.locator('#pause-button').click();
    const before = await page.evaluate(() => window.__CRY_GALLERY__.snapshot()); await page.locator('#chart-stage canvas').focus(); await page.keyboard.press('ArrowRight');
    const after = await page.evaluate(() => window.__CRY_GALLERY__.snapshot()); assert.ok(Math.abs(after.charts[0].value - before.charts[0].value - 1) < 1e-8);
    return { before: before.charts[0].value, after: after.charts[0].value };
  });
  await check('data-grid header sorts rows by measured temperature', async () => {
    await mount('grid'); await page.locator('#pause-button').click(); const rect = await page.locator('#chart-stage canvas').boundingBox();
    await page.mouse.click(rect.x + 18 + (rect.width - 36) * 0.375, rect.y + 62);
    const snapshot = await page.evaluate(() => window.__CRY_GALLERY__.snapshot()); assert.equal(snapshot.charts[0].sortKey, '温度');
    assert.ok(snapshot.charts[0].firstRows[0]['温度'] <= snapshot.charts[0].firstRows[1]['温度']);
    return { sortKey: snapshot.charts[0].sortKey, firstRows: snapshot.charts[0].firstRows };
  });
  await check('tree-map drilldown paints children and Escape returns to parent', async () => {
    await mount('treemap-drilldown'); const canvas = page.locator('#chart-stage canvas');
    const texts = () => page.evaluate(() => { const canvas = document.querySelector('#chart-stage canvas'), saved = window.__galleryCanvasContexts.get(canvas); return window.__galleryCanvasText.get(saved.context) ?? []; });
    const before = await texts(); assert.ok(before.includes('研发'));
    const rect = await canvas.boundingBox(); await page.mouse.click(rect.x + rect.width * 0.2, rect.y + rect.height * 0.5); await page.mouse.move(5, 5); await page.waitForTimeout(120);
    const children = await texts(); assert.ok(children.includes('算法')); assert.ok(children.includes('系统'));
    await canvas.focus(); await page.keyboard.press('Escape'); await page.waitForTimeout(120); const after = await texts();
    assert.ok(after.includes('研发')); assert.ok(after.includes('制造')); assert.ok(!after.includes('算法')); return { before, drilled: children, returned: after };
  });
  await check('annotations can be added, dragged along the time axis and deleted', async () => {
    await mount('annotations'); assert.equal(await page.locator('.annotation-marker').count(), 1);
    await page.getByRole('button', { name: '添加标注', exact: true }).click(); assert.equal(await page.locator('.annotation-marker').count(), 2);
    const marker = page.locator('.annotation-marker').first(), before = Number(await marker.getAttribute('data-time')), rect = await marker.boundingBox();
    await page.mouse.move(rect.x + 12, rect.y + 10); await page.mouse.down(); await page.mouse.move(rect.x + 132, rect.y + 10, { steps: 5 }); await page.mouse.up();
    const after = Number(await marker.getAttribute('data-time')); assert.ok(after > before + 0.5);
    await page.getByRole('button', { name: '删除标注 2', exact: true }).click(); assert.equal(await page.locator('.annotation-marker').count(), 1);
    return { initial: 1, added: 2, remaining: 1, timeBefore: before, timeAfter: after };
  });
  await check(millionCheckName, async () => {
    const expectedSamples = 1048576;
    await mount('million');
    await page.evaluate(() => { window.__galleryMillionDraws.clear(); window.__galleryMillionTraceEnabled = true; });
    try {
      await page.locator('select[name=points]').selectOption(String(expectedSamples));
      await page.locator('#chart-stage').scrollIntoViewIfNeeded();
      await page.waitForFunction(count => {
        const chart = window.__CRY_GALLERY__?.snapshot().charts[0];
        return chart?.series[0]?.sampleCount === count && chart.stats?.submittedSamples === count && chart.stats.drawCalls > 0;
      }, expectedSamples, { timeout: 15000 });
      const evidence = await page.evaluate(count => {
        const chart = window.__CRY_GALLERY__.snapshot().charts[0];
        const saved = [...window.__galleryCanvasContexts.entries()].find(([canvas, entry]) => canvas.isConnected && document.querySelector('#chart-stage').contains(canvas) && entry.kind === 'webgl2');
        if (!saved) throw new Error('Million-sample geometry verification requires a real WebGL2 data canvas');
        const [canvas, { context: gl }] = saved, observed = window.__galleryMillionDraws.get(gl), draw = observed?.geometry;
        if (!draw || draw.mode !== gl.TRIANGLE_STRIP || draw.first !== 0 || !draw.domain)
          throw new Error('No complete line geometry draw was observed');
        const coverage = draw.instances !== undefined;
        const source = coverage ? draw.start : draw.center;
        const repetitions = coverage ? 1 : 2;
        const observedSamples = coverage ? draw.instances + 1 : draw.count / 2;
        if (source.size !== 2 || source.type !== gl.FLOAT || !source.buffer || ![8,16].includes(source.stride) || source.divisor !== (coverage ? 1 : 0) || observedSamples !== count)
          throw new Error('The line draw does not submit every source coordinate');
        if (coverage) {
          const end = draw.center, composite = observed.composite;
          if (draw.count !== 4 || draw.defaultFramebuffer || end.buffer !== source.buffer || end.size !== 2 || end.type !== gl.FLOAT || end.stride !== source.stride || end.divisor !== 1 || end.offset !== source.offset + source.stride)
            throw new Error('The coverage mask must draw all adjacent source segments');
          if (!draw.mask || !composite || composite.mode !== gl.TRIANGLE_STRIP || composite.first !== 0 || composite.count !== 4 || composite.sampler !== 0 || composite.texture !== draw.mask)
            throw new Error('The observed coverage mask must be composited onto the data canvas');
        } else if (!draw.defaultFramebuffer || source.stride !== 8) {
          throw new Error('The raw strip must draw every duplicated center onto the data canvas');
        }
        const errorsBefore = []; for (let i = 0; i < 12; i++) { const error = gl.getError(); if (!error) break; errorsBefore.push(error); }
        const previousBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING), previousRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
        const sourceStride = source.stride / 4, sampleStride = sourceStride * repetitions;
        const centerCoordinates = new Float32Array((count - 1) * sampleStride + (repetitions - 1) * sourceStride + 2), pixels = new Uint8Array(canvas.width * canvas.height * 4);
        let bufferBytes;
        try {
          gl.bindBuffer(gl.ARRAY_BUFFER, source.buffer);
          bufferBytes = gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE);
          if (source.offset + centerCoordinates.byteLength > bufferBytes) throw new Error('The source coordinate buffer is incomplete');
          gl.getBufferSubData(gl.ARRAY_BUFFER, source.offset, centerCoordinates);
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        } finally {
          gl.bindBuffer(gl.ARRAY_BUFFER, previousBuffer);
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousRead);
        }
        const originX = chart.x.start - draw.domain[0], originY = chart.y.start - draw.domain[1];
        let coordinateMismatches = 0, firstMismatch, peaksChecked = 0;
        for (let index = 0; index < count; index++) {
          const expectedX = Math.fround(index - originX);
          const sourceY = Math.sin(index * .002) + Math.sin(index * .000037) * .6 + (index % 8191 === 0 ? 2 : 0);
          const expectedY = Math.fround(sourceY - originY);
          if (index % 8191 === 0) peaksChecked++;
          for (let vertex = 0; vertex < repetitions; vertex++) {
            const offset = index * sampleStride + vertex * sourceStride;
            if (centerCoordinates[offset] !== expectedX || centerCoordinates[offset + 1] !== expectedY) {
              coordinateMismatches++; firstMismatch ??= { index, vertex, expected: [expectedX, expectedY], actual: Array.from(centerCoordinates.subarray(offset, offset + 2)) };
            }
          }
        }
        let seriesColoredPixels = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 128 && pixels[i + 1] > pixels[i] + 50 && pixels[i + 2] > pixels[i] + 30) seriesColoredPixels++;
        const errorsAfter = []; for (let i = 0; i < 12; i++) { const error = gl.getError(); if (!error) break; errorsAfter.push(error); }
        return { retainedSourceSamples: chart.series[0].sampleCount, submittedSamples: chart.stats.submittedSamples, observedSourceSamples: observedSamples,
          gpuVertices: draw.count * (draw.instances ?? 1), geometryPass: coverage ? 'coverage-mask-and-composite' : 'raw-strip',
          backend: chart.stats.backend, uploads: chart.stats.uploads, uploadedBytes: chart.stats.uploadedBytes, bufferBytes,
          projection: { checkedSamples: count, checkedCoordinates: count * 2 * repetitions, peaksChecked, coordinateMismatches, firstMismatch, origin: { x: originX, y: originY }, precision: 'Float32 relative GPU coordinates, compared against the independent original recipe formula; this is not a raw Float64-byte audit' },
          pixels: { width: canvas.width, height: canvas.height, seriesColoredPixels }, contextLost: gl.isContextLost(), errorsBefore, errorsAfter,
          bindingsRestored: gl.getParameter(gl.ARRAY_BUFFER_BINDING) === previousBuffer && gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) === previousRead,
          downsamplingObserved: observedSamples !== count || chart.stats.submittedSamples !== count,
          limits: 'Readback is diagnostic and outside performance timing. Source retention count, projected geometry, GPU vertices and upload bytes are distinct quantities.' };
      }, expectedSamples);
      assert.equal(evidence.retainedSourceSamples, expectedSamples);
      assert.equal(evidence.submittedSamples, expectedSamples);
      assert.equal(evidence.projection.coordinateMismatches, 0, JSON.stringify(evidence.projection.firstMismatch));
      assert.equal(evidence.projection.peaksChecked, Math.ceil(expectedSamples / 8191));
      assert.equal(evidence.downsamplingObserved, false);
      assert.ok(evidence.pixels.seriesColoredPixels > 1000, 'The real data canvas must contain the series-colored geometry');
      assert.equal(evidence.contextLost, false); assert.deepEqual(evidence.errorsBefore, []); assert.deepEqual(evidence.errorsAfter, []);
      assert.equal(evidence.bindingsRestored, true);
      await page.screenshot({ path: resolve(artifacts, 'million-geometry.png') });
      return evidence;
    } finally {
      await page.evaluate(() => { window.__galleryMillionTraceEnabled = false; window.__galleryMillionDraws.clear(); });
      await page.locator('select[name=points]').selectOption('4096');
    }
  });
  await check('reference inventory search resolves an exact ID without claiming completion', async () => {
    await page.evaluate(() => { location.hash = 'reference=crychart-example-1720-derivedDataProperties'; }); await page.waitForFunction(() => window.__CRY_GALLERY__?.status === 'reference');
    await page.getByLabel('搜索示例').fill('1720'); assert.equal(await page.locator('#demo-list button').count(), 1);
    assert.equal(await page.locator('.status-pill.pending').textContent(), '演示场景');
    const verification = await page.locator('.check-item span').allTextContents();
    assert.deepEqual(verification, Array(4).fill('独立验证'));
    return { matched: 1, status: 'reference', verification };
  });
  await check('responsive layout resizes chart canvas and supports a light theme', async () => {
    await mount('waveform'); await page.setViewportSize({ width: 680, height: 960 }); await page.waitForTimeout(150);
    await page.locator('#theme-button').click(); await page.waitForTimeout(150);
    assert.equal(await page.locator('body').evaluate(body => body.classList.contains('light')), true);
    const stage = await page.locator('#chart-stage').boundingBox(); assert.ok(stage.width < 680 && stage.width > 300);
    await page.screenshot({ path: resolve(artifacts, 'mobile-light.png'), fullPage: true }); return { stageWidth: stage.width };
  });
  report.passed = report.errors.length === 0;
  await page.setViewportSize(report.viewport); await mount('heatmap'); await showProgress(report.passed ? '可见 Chrome 测试完成' : '可见 Chrome 测试发现问题', millionOnly ? `百万采样定向检查：${report.interactions.filter(item => item.status === 'passed').length} / 1；完整样本、GPU 几何和实际像素分别核对。` : `${report.recipes.filter(item => item.status === 'local-render-passed').length} / ${manifest.length} 个原创演示出图；${report.interactions.filter(item => item.status === 'passed').length} 项交互通过；生产负载等价性仍待验收。`);
} catch (error) { report.errors.push({ fatal: error.message }); report.passed = false; }
finally {
  await writeFile(resolve(artifacts, 'run.json'), JSON.stringify(report, null, 2) + '\n');
  // Disconnect only: the user explicitly asked to see Chrome and the final screen remains open.
  if (browser) await browser.close();
  await server.close();
}
console.log(JSON.stringify({ recipes: report.recipes.length, renderPassed: report.recipes.filter(item => item.status === 'local-render-passed').length, interactionsPassed: report.interactions.filter(item => item.status === 'passed').length, failures: report.errors.length, report: resolve(artifacts, 'run.json'), parityClaim: false }));
if (!report.passed) process.exitCode = 1;
