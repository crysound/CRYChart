import {mkdir, writeFile, readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {build} from 'esbuild'
import {connectVisibleChrome, ensureTestServer} from './visible-browser.mjs'

const relative = process.argv.includes('--relative')
const geometryOnly = process.argv.includes('--geometry-only')
const baseDirectory = relative ? 'codex_artifact/line-direction-visible' : 'codex_artifact/line-offsets-visible'
const directory = `${baseDirectory}/${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`
await mkdir(directory, {recursive: true})
await build({stdin: {contents: "export {LineStripRenderer} from './src/render-line-strip.ts'; export {LineOffsetCache} from './src/render-line-offsets.ts'; export {lineDirectionOracle} from './src/render-line-direction.ts'", resolveDir: process.cwd()}, bundle: true, format: 'esm', outfile: directory + '/renderers.js'})
const bundle = await readFile(directory + '/renderers.js')
await writeFile(directory + '/fixture.html', '<!doctype html><meta charset="utf-8"><title>CRYChart offset-cache validation</title><style>body{background:#101827;color:white;font:16px system-ui;margin:20px}canvas{display:block;width:1000px;height:600px;background:black}p{max-width:1000px}</style><h2 id="status">Visible Chrome: original GPU offset-cache candidate</h2><canvas id="chart" width="1000" height="600"></canvas><p>Comparing complete RGBA pixels against the stable line strip. Candidate remains disabled unless accuracy and measured performance pass.</p>')
const report = {createdAt: new Date().toISOString(), status: 'inprogress', visible: true, headless: false, directionMode: relative ? 'relative' : 'projected', experimentalDefaultEnabled: false, bundleSha256: createHash('sha256').update(bundle).digest('hex'), checks: [], errors: [], performance: undefined, performanceStatus: geometryOnly ? 'not-run-geometry-only' : 'pending', completeQualityEquivalence: false}
report.sources = Object.fromEntries(await Promise.all(['src/render-line-strip.ts', 'src/render-line-offsets.ts', 'src/render-line-direction.ts', 'scripts/test-line-offsets-visible.mjs'].map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])))
const server = await ensureTestServer()
let browser, page
try {
  const connected = await connectVisibleChrome(); browser = connected.browser; page = connected.page
  report.browser = connected.metadata.Browser
  await page.setViewportSize({width: 1100, height: 760})
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto('http://127.0.0.1:4178/' + directory + '/fixture.html', {waitUntil: 'load'})
  report.environment = await page.evaluate(setup, {relative})
  const session = await page.context().newCDPSession(page)
  for (const id of ['smooth', 'pan-positive', 'pan-negative', 'nan-gaps', 'epoch', 'epoch-pan', 'extreme-ratio', 'extreme-ratio-pan', 'append-initial', 'append-tail', 'zoom', 'dense', 'dense-pan', 'dense-zoom', 'sharp', 'sharp-pan']) {
    const result = await page.evaluate(compareCase, id)
    if (result.images) {
      result.imagesSaved = {}
      for (const [name, data] of Object.entries(result.images)) {const path = `${directory}/${id}-${name}.png`; await writeFile(path, Buffer.from(data.split(',')[1], 'base64')); result.imagesSaved[name] = path}
      delete result.images
    }
    const image = await session.send('Page.captureScreenshot', {format: 'png', fromSurface: true, captureBeyondViewport: false, clip: {x: 0, y: 0, width: 1100, height: 760, scale: 1}})
    const filename = `${id}.png`; await writeFile(`${directory}/${filename}`, Buffer.from(image.data, 'base64'))
    result.screenshot = `${directory}/${filename}`
    report.checks.push(result)
    console.log(JSON.stringify({case: id, passed: result.passed, differingBytes: result.differingBytes, maxDifference: result.maxDifference, offsetStats: result.offsetStats, geometry: result.geometry, oldPixelDifference: result.oldPixelDifference}))
  }
  report.performance = []
  for (let repetition = 0; repetition < (geometryOnly ? 0 : 3); repetition++) {
    const trial = await page.evaluate(measureRenderers, {repetition, frames: 24})
    trial.screenshots = {}
    for (const [name, data] of Object.entries(trial.images ?? {})) {
      const path = `${directory}/stream-${repetition}-${name}.png`
      await writeFile(path, Buffer.from(data.split(',')[1], 'base64'))
      trial.screenshots[name] = path
    }
    delete trial.images
    report.performance.push(trial)
    console.log(JSON.stringify({repetition, valid: trial.valid, summary: trial.summary, pixels: trial.pixelChecks}))
  }
  await page.evaluate(() => window.__offsetFixture.dispose())
  report.status = report.errors.length === 0 && report.checks.every(check => check.passed) && report.performance.every(trial => trial.valid) ? 'passed-candidate-review-required' : 'failed-candidate-disabled'
  if (report.status !== 'passed-candidate-review-required') process.exitCode = 1
} catch (error) {
  report.status = 'failed-candidate-disabled'; report.errors.push(error.message); process.exitCode = 1
} finally {
  report.completedAt = new Date().toISOString()
  await writeFile(directory + '/report.json', JSON.stringify(report, null, 2) + '\n')
  await writeFile(baseDirectory + '/latest.json', JSON.stringify({report: directory + '/report.json', status: report.status}, null, 2) + '\n')
  if (page) await page.goto('http://127.0.0.1:4178/#demo=stream').catch(() => {})
  if (browser) await browser.close()
  await server.close()
  console.log(JSON.stringify({status: report.status, report: directory + '/report.json', performance: report.performance?.map(trial => trial.summary)}))
}

async function setup({relative}) {
  const {LineStripRenderer, LineOffsetCache, lineDirectionOracle} = await import('./renderers.js')
  const canvas = document.getElementById('chart')
  const gl = canvas.getContext('webgl2', {antialias: false, preserveDrawingBuffer: true, alpha: true, premultipliedAlpha: true})
  if (!gl) throw new Error('Visible WebGL2 context unavailable')
  const directionMode = relative ? 'relative' : 'projected'
  const stable = new LineStripRenderer(gl, {directionMode}), cached = new LineStripRenderer(gl, {cacheOffsets: true, directionMode})
  const projected = relative ? new LineStripRenderer(gl) : undefined
  const rect = {left: 100, top: 80, width: 800, height: 420}
  const packet = (id, count, xStep = 1, amplitude = 1, originX = 0) => {
    const positions = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {positions[i * 2] = i * xStep; positions[i * 2 + 1] = amplitude * (Math.sin(i * .073) + .2 * Math.cos(i * .197))}
    return {id, revision: 1, count, positions, dimensions: 2, mode: 'line', strictlyMonotonicX: true, monotonicX: true, color: [.1, .86, .7, 1], thickness: 2, pointSize: 0, origin: {x: originX, y: 0, z: 0}, domain: {x: {start: originX, end: originX + (count - 1) * xStep}, y: {start: -1.4 * amplitude, end: 1.4 * amplitude}}}
  }
  const smooth = packet(1, 1001), gaps = packet(2, 1001)
  gaps.positions[401 * 2 + 1] = NaN; gaps.positions[402 * 2 + 1] = NaN; gaps.positions[800 * 2 + 1] = NaN
  const epoch = packet(3, 1001, .25, 1, 1700000000000), extreme = packet(4, 1001, 100000, 0.000001)
  const dense = packet(6, 100000), sharp = packet(7, 1001)
  for (let i = 0; i < sharp.count; i++) sharp.positions[i * 2 + 1] = i % 17 === 0 ? -1 : i % 17 === 8 ? 1 : .1 * Math.sin(i)
  const appendFull = packet(5, 45); appendFull.domain.x = {start: 0, end: 64}
  const appendInitial = {...appendFull, positions: appendFull.positions.subarray(0, 37 * 2), count: 37}
  const appendNext = {...appendFull, revision: 2, previousRevision: 1, updateFrom: 37}
  const cases = {
    smooth,
    'pan-positive': {...smooth, domain: {x: {start: 17.125, end: 1017.125}, y: smooth.domain.y}},
    'pan-negative': {...smooth, domain: {x: {start: -123.5, end: 876.5}, y: smooth.domain.y}},
    'nan-gaps': gaps,
    epoch,
    'epoch-pan': {...epoch, domain: {x: {start: epoch.origin.x + .5, end: epoch.origin.x + 250.5}, y: epoch.domain.y}},
    'extreme-ratio': extreme,
    'extreme-ratio-pan': {...extreme, domain: {x: {start: 500000, end: 100500000}, y: extreme.domain.y}},
    'append-initial': appendInitial,
    'append-tail': appendNext,
    zoom: {...appendNext, domain: {x: {start: 10, end: 35}, y: {start: -.7, end: .7}}},
    dense,
    'dense-pan': {...dense, domain: {x: {start: .125, end: 99999.125}, y: dense.domain.y}},
    'dense-zoom': {...dense, domain: {x: {start: 45000, end: 55000}, y: {start: -.7, end: .7}}},
    sharp,
    'sharp-pan': {...sharp, domain: {x: {start: .875, end: 1000.875}, y: sharp.domain.y}},
  }
  const clear = () => {gl.disable(gl.SCISSOR_TEST); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)}
  const pixels = () => {const bytes = new Uint8Array(canvas.width * canvas.height * 4); gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes); return bytes}
  const render = (renderer, packets) => {clear(); renderer.beginFrame(); for (const packet of packets) if (!renderer.draw(packet, rect, 1)) throw new Error('An eligible line packet was rejected'); renderer.endFrame()}
  function geometry(packet) {
    const positions = new Float32Array((packet.count + 2) * 2)
    positions.set(packet.positions.subarray(0, 2), 0); positions.set(packet.positions, 2); positions.set(packet.positions.subarray((packet.count - 1) * 2, packet.count * 2), (packet.count + 1) * 2)
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
    const read = mode => {
      const cache = new LineOffsetCache(gl, {directionMode: mode})
      const result = cache.update(packet, rect, 1, {buffer, strideBytes: 8, centerOffsetBytes: 8})
      const offsets = new Float32Array(packet.count * 4); gl.bindBuffer(gl.ARRAY_BUFFER, result.buffer); gl.getBufferSubData(gl.ARRAY_BUFFER, 0, offsets)
      cache.dispose(); return offsets
    }
    const relativeOffsets = read('relative'), projectedOffsets = read('projected')
    gl.deleteBuffer(buffer)
    const indices = new Set([0, 1, packet.count - 2, packet.count - 1])
    for (let index = 0; index < Math.min(2048, packet.count); index++) indices.add(Math.floor(index * (packet.count - 1) / Math.max(1, Math.min(2048, packet.count) - 1)))
    for (let index = 1; index < packet.count - 1; index++) if (!Number.isFinite(packet.positions[index * 2 + 1])) {indices.add(index - 1); indices.add(index); indices.add(index + 1)}
    const span = [packet.domain.x.end - packet.domain.x.start, packet.domain.y.end - packet.domain.y.start], size = [rect.width, rect.height]
    const errors = {relative: [], projected: []}
    for (const index of indices) {
      const at = i => [positions[i * 2], positions[i * 2 + 1]]
      const expected = lineDirectionOracle(at(index), at(index + 1), at(index + 2), span, size, packet.thickness)
      for (const [name, actual] of [['relative', relativeOffsets], ['projected', projectedOffsets]]) {
        const error = Math.max(Math.hypot((actual[index * 4] - expected[0]) * size[0] / 2, (actual[index * 4 + 1] - expected[1]) * size[1] / 2), Math.hypot((actual[index * 4 + 2] - expected[2]) * size[0] / 2, (actual[index * 4 + 3] - expected[3]) * size[1] / 2))
        errors[name].push(error)
      }
    }
    const summary = Object.fromEntries(Object.entries(errors).map(([name, values]) => {const sorted = [...values].sort((a, b) => a - b); return [name, {sampledPoints: values.length, maximumOffsetErrorPixels: Math.max(...values), p95OffsetErrorPixels: sorted[Math.ceil(sorted.length * .95) - 1], allFinite: values.every(Number.isFinite)}]}))
    return {summary, glError: gl.getError(), definition: 'Actual transform-feedback offsets versus independent Float64 miter/cap oracle on exact uploaded Float32 positions; excludes source projection and viewport-center rounding', tolerancePixels: .001, passed: summary.relative.allFinite && summary.relative.maximumOffsetErrorPixels <= .001}
  }
  window.__offsetFixture = {gl, canvas, stable, cached, projected, relative, rect, cases, render, pixels, packet, geometry, newCached: () => new LineStripRenderer(gl, {cacheOffsets: true, directionMode}), dispose: () => {stable.dispose(); cached.dispose(); projected?.dispose()}}
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  return {browserDpr: devicePixelRatio, rendererDpr: 1, canvas: {width: canvas.width, height: canvas.height}, plotDevicePixels: rect, renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), context: gl.getContextAttributes(), gpuQuery: !!gl.getExtension('EXT_disjoint_timer_query_webgl2')}
}

function compareCase(id) {
  const f = window.__offsetFixture, packet = f.cases[id]
  document.getElementById('status').textContent = 'Visible Chrome pixel comparison: ' + id
  const images = {}, difference = (a, b) => {let differingBytes = 0, maxDifference = 0; for (let i = 0; i < a.length; i++) {const d = Math.abs(a[i] - b[i]); if (d) differingBytes++; maxDifference = Math.max(maxDifference, d)} return {differingBytes, maxDifference}}
  let oldPixels
  if (f.projected) {f.render(f.projected, [packet]); oldPixels = f.pixels(); images.projected = f.canvas.toDataURL('image/png')}
  f.render(f.stable, [packet]); const expected = f.pixels(), stableError = f.gl.getError()
  if (f.relative) images.relative = f.canvas.toDataURL('image/png')
  f.render(f.cached, [packet]); const actual = f.pixels(), cachedError = f.gl.getError()
  let differingBytes = 0, maxDifference = 0, visiblePixels = 0
  for (let i = 0; i < actual.length; i++) {const difference = Math.abs(actual[i] - expected[i]); if (difference) differingBytes++; maxDifference = Math.max(maxDifference, difference); if (i % 4 === 3 && actual[i] > 0) visiblePixels++}
  const offsetStats = f.cached.getOffsetStats()
  let contract = true
  if (id.includes('pan')) contract = offsetStats.computations === 0 && offsetStats.cacheHits === 1
  if (id === 'append-tail') contract = offsetStats.computedSamples === 9
  if (id.endsWith('zoom')) contract = offsetStats.computedSamples === packet.count
  const geometry = f.relative ? f.geometry(packet) : undefined
  return {id, passed: differingBytes === 0 && stableError === 0 && cachedError === 0 && visiblePixels > 20 && contract && (!geometry || geometry.passed && geometry.glError === 0), differingBytes, maxDifference, visiblePixels, stableError, cachedError, offsetStats, cacheContract: contract, geometry, oldPixelDifference: oldPixels ? difference(oldPixels, expected) : undefined, images: f.relative ? images : undefined}
}

async function measureRenderers({repetition, frames}) {
  const f = window.__offsetFixture, gl = f.gl, ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
  if (!ext || !gl.getQuery(ext.TIME_ELAPSED_EXT, ext.QUERY_COUNTER_BITS_EXT)) return {valid: false, status: 'GPU timer unavailable'}
  const prefill = 100000, batch = 1000, maximum = prefill + frames * batch
  const full = Array.from({length: 4}, (_, channel) => {
    const packet = f.packet(100 + repetition * 10 + channel, maximum)
    for (let i = 0; i < maximum; i++) {packet.positions[i * 2] = i; packet.positions[i * 2 + 1] = channel * 3 + .8 * Math.sin(i * .017 + channel) + .08 * Math.cos(i * .113)}
    packet.domain.y = {start: -1, end: 11}; return packet
  })
  const names = f.projected ? ['projected', 'stable', 'cached'] : ['stable', 'cached']
  const pixels = new Uint8Array(4), samples = Object.fromEntries(names.map(name => [name, []])), warmup = {}, pixelChecks = [], images = {}
  const make = (frame) => {
    const count = prefill + frame * batch
    return full.map(packet => ({...packet, count, positions: packet.positions.subarray(0, count * 2), revision: frame + 1, previousRevision: frame || undefined, updateFrom: frame ? count - batch : undefined, domain: {x: {start: count - prefill, end: count - 1}, y: packet.domain.y}}))
  }
  const readQuery = query => new Promise(resolve => {
    const started = performance.now()
    const poll = () => {
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {gl.deleteQuery(query); resolve({status: 'disjoint'}); return}
      if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {const ms = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(query); resolve({status: 'available', ms}); return}
      if (performance.now() - started > 5000) {gl.deleteQuery(query); resolve({status: 'timeout'}); return}
      requestAnimationFrame(poll)
    }
    requestAnimationFrame(poll)
  })
  const measure = async (name, packets) => {
    await new Promise(requestAnimationFrame)
    const query = gl.createQuery(), start = performance.now()
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query)
    f.render(f[name], packets)
    gl.endQuery(ext.TIME_ELAPSED_EXT)
    const callbackMs = performance.now() - start, readStart = performance.now()
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    const synchronizedMs = performance.now() - start, readPixelsMs = performance.now() - readStart, glError = gl.getError()
    return {callbackMs, synchronizedMs, readPixelsMs, glError, query: await readQuery(query), offsetStats: f[name].getOffsetStats()}
  }
  document.getElementById('status').textContent = 'GPU diagnostic: stable strip and experimental offset cache, 4 × 100000 prefilled'
  for (const name of names) warmup[name] = await measure(name, make(0))
  for (let frame = 1; frame <= frames; frame++) {
    const proof = {}, packets = make(frame)
    for (const name of frame % 2 ? names : [...names].reverse()) {
      samples[name].push(await measure(name, packets))
      if (frame === 1 || frame === frames) proof[name] = f.pixels()
      if (frame === frames) images[name] = f.canvas.toDataURL('image/png')
    }
    if (proof.stable && proof.cached) {
      let differingBytes = 0, maxDifference = 0, visiblePixels = 0
      for (let i = 0; i < proof.stable.length; i++) {
        const difference = Math.abs(proof.stable[i] - proof.cached[i])
        if (difference) differingBytes++
        maxDifference = Math.max(maxDifference, difference)
        if (i % 4 === 3 && proof.cached[i]) visiblePixels++
      }
      pixelChecks.push({frame, differingBytes, maxDifference, visiblePixels, passed: differingBytes === 0 && visiblePixels > 20})
    }
  }
  const summarize = values => {const sorted = [...values].sort((a, b) => a - b); return {median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * .95) - 1]}}
  // A separate untimed renderer recomputes every offset at the final view. This
  // distinguishes translation-cache rounding from the shader split itself.
  const fresh = f.newCached()
  f.render(f.stable, make(frames)); const reference = f.pixels()
  f.render(fresh, make(frames)); const recomputed = f.pixels()
  let freshDifferingBytes = 0, freshMaxDifference = 0
  for (let i = 0; i < reference.length; i++) {const difference = Math.abs(reference[i] - recomputed[i]); if (difference) freshDifferingBytes++; freshMaxDifference = Math.max(freshMaxDifference, difference)}
  const freshFinal = {differingBytes: freshDifferingBytes, maxDifference: freshMaxDifference, glError: gl.getError(), offsets: fresh.getOffsetStats(), timed: false}
  fresh.dispose()
  return {valid: [...Object.values(samples).flat(), ...Object.values(warmup)].every(sample => sample.glError === 0 && sample.query.status === 'available') && pixelChecks.every(check => check.passed), repetition, frames, prefillPerChannel: prefill, finalPerChannel: maximum, samples, warmup, pixelChecks, freshFinal, images, summary: Object.fromEntries(Object.entries(samples).map(([name, frames]) => [name, {gpuElapsedMs: summarize(frames.map(f => f.query.ms)), synchronizedMs: summarize(frames.map(f => f.synchronizedMs)), callbackMs: summarize(frames.map(f => f.callbackMs))}])), range: 'Direct original renderer calls including clear, data uploads and optional TF pass; ends before 1x1 readback. Not the public API paired benchmark.', parityClaim: false}
}
