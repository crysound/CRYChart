import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {build} from 'esbuild'
import {connectVisibleChrome, ensureTestServer} from './visible-browser.mjs'

// Original renderer experiments only. No reference implementation is inspected,
// modified, imported, or timed by this diagnostic.
const directory = `codex_artifact/line-shader-diagnostics/${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`
const isolate = process.argv.includes('--isolate')
const textureMode = process.argv.includes('--texture')
await mkdir(directory, {recursive: true})
await writeFile(directory + '/runner.mjs', await readFile('scripts/line-shader-diagnostics.mjs'))
await build({stdin: {contents: "export {LineStripRenderer} from './src/render-line-strip.ts'; export {TextureLineRenderer} from './src/render-line-texture.ts';", resolveDir: process.cwd()}, bundle: true, format: 'esm', outfile: directory + '/renderers.js'})
const bundle = await readFile(directory + '/renderers.js')
await writeFile(directory + '/fixture.html', '<!doctype html><meta charset="utf-8"><title>CRYChart shader diagnostics</title><style>body{background:#101827;color:white;font:16px system-ui;margin:20px}canvas{display:block;width:1000px;height:600px;background:black}p{max-width:1000px}</style><h2 id="status">Visible Chrome: original shader diagnostics</h2><canvas id="chart" width="1000" height="600"></canvas><p>Discard and constant-fragment modes intentionally do not draw a valid chart. They diagnose pipeline cost only. Production rendering remains unchanged.</p>')
const report = {
  createdAt: new Date().toISOString(), status: 'inprogress', visible: true, headless: false,
  productionChanged: false, parityClaim: false, bundleSha256: createHash('sha256').update(bundle).digest('hex'),
  mode: isolate ? 'submission-upload-draw-isolation' : textureMode ? 'RG32F-position-texture' : 'shader-variants',
  checks: [], trials: [], errors: [],
  limitations: [
    'RASTERIZER_DISCARD omits rasterization, fragment work and blending. Its time is not valid chart performance.',
    'Constant fragment changes coverage, overdraw and live varyings. Stage timings cannot be subtracted as an exact decomposition.',
    'GPU queries include renderer clear/upload/draw calls and end before a 1x1 readback. They are not the paired public-API benchmark.',
    'Reciprocal multiplication may round differently from division and is rejected on any full-RGBA difference.',
  ],
}
const server = await ensureTestServer()
let browser, page
try {
  const connected = await connectVisibleChrome(); browser = connected.browser; page = connected.page
  report.browser = connected.metadata.Browser
  await page.setViewportSize({width: 1100, height: 760})
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto('http://127.0.0.1:4178/' + directory + '/fixture.html', {waitUntil: 'load'})
  report.environment = await page.evaluate(setup, {isolate, textureMode})
  for (const id of isolate ? [] : ['smooth', 'pan', 'nan', 'epoch', 'epoch-pan', 'extreme', 'dense', 'dense-pan', 'dense-zoom', 'sharp', 'append-initial', 'append-tail', 'row-boundary-initial', 'row-boundary-append']) {
    const result = await page.evaluate(compareCase, id)
    report.checks.push(result)
    console.log(JSON.stringify({case: id, candidates: result.candidates}))
  }
  for (let repetition = 0; repetition < 3; repetition++) {
    const trial = await page.evaluate(measure, {repetition, frames: 24})
    trial.screenshots = {}
    for (const [name, data] of Object.entries(trial.images ?? {})) {
      const path = `${directory}/stream-${repetition}-${name}.png`
      await writeFile(path, Buffer.from(data.split(',')[1], 'base64')); trial.screenshots[name] = path
    }
    delete trial.images; report.trials.push(trial)
    console.log(JSON.stringify({repetition, queriesValid: trial.queriesValid, summary: trial.summary, pixelChecks: trial.pixelChecks}))
  }
  await page.evaluate(() => window.__lineDiagnostic.dispose())
  report.status = report.errors.length === 0 && report.trials.every(trial => trial.queriesValid) ? 'diagnostic-collected-candidate-review-required' : 'diagnostic-failed'
  if (report.status === 'diagnostic-failed') process.exitCode = 1
} catch (error) {
  report.errors.push(error.message); report.status = 'diagnostic-failed'; process.exitCode = 1
} finally {
  report.completedAt = new Date().toISOString()
  await writeFile(directory + '/report.json', JSON.stringify(report, null, 2) + '\n')
  if (page) await page.goto('http://127.0.0.1:4178/#demo=stream').catch(() => {})
  if (browser) await browser.close()
  await server.close()
  console.log(JSON.stringify({status: report.status, report: directory + '/report.json'}))
}

async function setup({isolate, textureMode}) {
  const {LineStripRenderer, TextureLineRenderer} = await import('./renderers.js')
  const canvas = document.getElementById('chart')
  const gl = canvas.getContext('webgl2', {antialias: false, preserveDrawingBuffer: true, alpha: true, premultipliedAlpha: true})
  if (!gl) throw new Error('WebGL2 unavailable in visible Chrome')
  const rect = {left: 100, top: 80, width: 800, height: 420}, transforms = {}
  function create(variant) {
    if (variant === 'texture') return new TextureLineRenderer(gl)
    const original = gl.shaderSource
    transforms[variant] = []
    gl.shaderSource = function(shader, initial) {
      let source = initial
      const type = gl.getShaderParameter(shader, gl.SHADER_TYPE)
      if (variant === 'constant-fragment' && type === gl.FRAGMENT_SHADER) source = `#version 300 es
precision highp float;
uniform vec4 u_color;
flat in vec2 v_lineStart;flat in vec2 v_lineEnd;flat in float v_valid;
out vec4 color;
void main(){if(v_valid<.5||any(isnan(v_lineStart))||any(isnan(v_lineEnd)))discard;color=u_color;}`
      if (variant === 'flat-segment') {
        if (type === gl.VERTEX_SHADER) source = source
          .replace('flat out float v_valid;', 'flat out float v_valid; flat out vec2 v_delta; flat out float v_squared;')
          .replace('v_lineEnd=(p+1.)*.5*u_size;', 'v_lineEnd=(p+1.)*.5*u_size; v_delta=v_lineEnd-v_lineStart; v_squared=dot(v_delta,v_delta);')
        else source = source
          .replace('flat in float v_valid;', 'flat in float v_valid; flat in vec2 v_delta; flat in float v_squared;')
          .replace('delta=v_lineEnd-v_lineStart;', 'delta=v_delta;')
          .replace('float squared=dot(delta,delta);', 'float squared=v_squared;')
      }
      if (variant === 'reciprocal-projection' && type === gl.VERTEX_SHADER) source = source
        .replace('uniform vec4 u_domain;', 'uniform vec4 u_domain; uniform vec2 u_inverseSpan;')
        .replace('(p-u_domain.xy)/u_domain.zw*2.0-1.0', '(p-u_domain.xy)*u_inverseSpan*2.0-1.0')
      transforms[variant].push({type: type === gl.VERTEX_SHADER ? 'vertex' : 'fragment', changed: source !== initial})
      return original.call(gl, shader, source)
    }
    try {return new LineStripRenderer(gl)} finally {gl.shaderSource = original}
  }
  const names = isolate
    ? ['empty-query', 'clear-only', 'submit-without-draw', 'frozen-draw', 'frozen-vertex-only', 'stable']
    : textureMode ? ['stable', 'texture'] : ['stable', 'vertex-only', 'constant-fragment', 'flat-segment', 'reciprocal-projection']
  const candidates = textureMode ? ['texture'] : ['flat-segment', 'reciprocal-projection']
  const renderers = Object.fromEntries(names.map(name => [name, create(name)]))
  // The constructor's shader override is confined to our original renderer.
  // The one extra uniform is updated at the same point as its domain uniform.
  const reciprocal = renderers['reciprocal-projection'], inverse = reciprocal ? gl.getUniformLocation(reciprocal.program, 'u_inverseSpan') : null
  const originalUniform = gl.uniform4f
  gl.uniform4f = function(location, x, y, z, w) {
    originalUniform.call(gl, location, x, y, z, w)
    if (reciprocal && location === reciprocal.uniforms.domain) gl.uniform2f(inverse, Math.fround(1 / Math.fround(z)), Math.fround(1 / Math.fround(w)))
  }
  const packet = (id, count, step = 1, amplitude = 1, originX = 0) => {
    const positions = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {positions[i * 2] = i * step; positions[i * 2 + 1] = amplitude * (Math.sin(i * .073) + .2 * Math.cos(i * .197))}
    return {id, revision: 1, count, positions, dimensions: 2, mode: 'line', strictlyMonotonicX: true, monotonicX: true, color: [.1, .86, .7, 1], thickness: 2, pointSize: 0, origin: {x: originX, y: 0, z: 0}, domain: {x: {start: originX, end: originX + (count - 1) * step}, y: {start: -1.4 * amplitude, end: 1.4 * amplitude}}}
  }
  const smooth = packet(1, 1001), nan = packet(2, 1001), epoch = packet(3, 1001, .25, 1, 1700000000000), extreme = packet(4, 1001, 100000, .000001), dense = packet(5, 100000), sharp = packet(6, 1001), append = packet(7, 45), rowBoundary = packet(8, 2051)
  nan.positions[401 * 2 + 1] = NaN; nan.positions[402 * 2 + 1] = NaN; nan.positions[800 * 2 + 1] = NaN
  for (let i = 0; i < sharp.count; i++) sharp.positions[i * 2 + 1] = i % 17 === 0 ? -1 : i % 17 === 8 ? 1 : .1 * Math.sin(i)
  append.domain.x = {start: 0, end: 64}
  const cases = {
    smooth, pan: {...smooth, domain: {x: {start: 17.125, end: 1017.125}, y: smooth.domain.y}}, nan, epoch,
    'epoch-pan': {...epoch, domain: {x: {start: epoch.origin.x + .5, end: epoch.origin.x + 250.5}, y: epoch.domain.y}}, extreme, dense,
    'dense-pan': {...dense, domain: {x: {start: .125, end: 99999.125}, y: dense.domain.y}},
    'dense-zoom': {...dense, domain: {x: {start: 45000, end: 55000}, y: {start: -.7, end: .7}}}, sharp,
    'append-initial': {...append, count: 37, positions: append.positions.subarray(0, 74)},
    'append-tail': {...append, revision: 2, previousRevision: 1, updateFrom: 37},
    'row-boundary-initial': {...rowBoundary, count: 2047, positions: rowBoundary.positions.subarray(0, 4094)},
    'row-boundary-append': {...rowBoundary, revision: 2, previousRevision: 1, updateFrom: 2047},
  }
  function render(name, packets) {
    if (name === 'empty-query') return
    gl.disable(gl.RASTERIZER_DISCARD); gl.disable(gl.SCISSOR_TEST); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
    if (name === 'clear-only') return
    if (name.includes('vertex-only')) gl.enable(gl.RASTERIZER_DISCARD)
    const originalDraw = gl.drawArrays
    if (name === 'submit-without-draw') gl.drawArrays = () => {}
    const renderer = renderers[name]; renderer.beginFrame()
    try {for (const value of packets) if (!renderer.draw(value, rect, 1)) throw new Error('Eligible line rejected'); renderer.endFrame()}
    finally {gl.disable(gl.RASTERIZER_DISCARD); gl.drawArrays = originalDraw}
  }
  const pixels = () => {const bytes = new Uint8Array(canvas.width * canvas.height * 4); gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes); return bytes}
  const compare = (expected, actual) => {
    let differingBytes = 0, maxDifference = 0, visiblePixels = 0
    for (let i = 0; i < actual.length; i++) {const difference = Math.abs(expected[i] - actual[i]); if (difference) differingBytes++; maxDifference = Math.max(maxDifference, difference); if (i % 4 === 3 && actual[i]) visiblePixels++}
    return {differingBytes, maxDifference, visiblePixels, glError: gl.getError(), samePixels: differingBytes === 0}
  }
  window.__lineDiagnostic = {gl, canvas, renderers, names, candidates, render, pixels, compare, packet, cases, isolate, dispose: () => {gl.uniform4f = originalUniform; for (const renderer of Object.values(renderers)) renderer.dispose()}}
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  return {browserDpr: devicePixelRatio, rendererDpr: 1, canvasDevicePixels: {width: canvas.width, height: canvas.height}, plotDevicePixels: rect, renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), context: gl.getContextAttributes(), lineWidthRange: Array.from(gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE)), transforms}
}

function compareCase(id) {
  const f = window.__lineDiagnostic, packet = f.cases[id]
  const original = new Uint8Array(packet.positions.buffer, packet.positions.byteOffset, packet.positions.byteLength).slice()
  document.getElementById('status').textContent = 'Original shader full-RGBA comparison: ' + id
  f.render('stable', [packet]); const expected = f.pixels(), baselineError = f.gl.getError(), candidates = {}
  for (const name of f.candidates) {f.render(name, [packet]); candidates[name] = f.compare(expected, f.pixels())}
  const after = new Uint8Array(packet.positions.buffer, packet.positions.byteOffset, packet.positions.byteLength)
  return {id, baselineError, candidates, inputUnchanged: original.every((byte, index) => byte === after[index])}
}

async function measure({repetition, frames}) {
  const f = window.__lineDiagnostic, gl = f.gl, ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
  if (!ext || !gl.getQuery(ext.TIME_ELAPSED_EXT, ext.QUERY_COUNTER_BITS_EXT)) throw new Error('GPU elapsed query unavailable')
  const prefill = 100000, batch = 1000, maximum = prefill + frames * batch, pixel = new Uint8Array(4)
  const full = Array.from({length: 4}, (_, channel) => {
    const p = f.packet(100 + repetition * 10 + channel, maximum)
    for (let i = 0; i < maximum; i++) {p.positions[i * 2] = i; p.positions[i * 2 + 1] = channel * 3 + .8 * Math.sin(i * .017 + channel) + .08 * Math.cos(i * .113)}
    p.domain.y = {start: -1, end: 11}; return p
  })
  const make = frame => {
    const count = prefill + frame * batch
    return full.map(p => ({...p, count, positions: p.positions.subarray(0, count * 2), revision: frame + 1, previousRevision: frame || undefined, updateFrom: frame ? count - batch : undefined, domain: {x: {start: count - prefill, end: count - 1}, y: p.domain.y}}))
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
  const samples = Object.fromEntries(f.names.map(name => [name, []])), warmup = {}, pixelChecks = [], images = {}
  async function once(name, packets) {
    if (name.startsWith('frozen-')) packets = make(0)
    await new Promise(requestAnimationFrame)
    const query = gl.createQuery(), started = performance.now()
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query); f.render(name, packets); gl.endQuery(ext.TIME_ELAPSED_EXT)
    const callbackMs = performance.now() - started, readStart = performance.now()
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    const synchronizedMs = performance.now() - started, readPixelsMs = performance.now() - readStart, glError = gl.getError()
    return {callbackMs, synchronizedMs, readPixelsMs, glError, query: await readQuery(query), nominalSubmittedSamples: f.renderers[name].stats.submittedSamples, gpuDrawIssued: !['empty-query', 'clear-only', 'submit-without-draw'].includes(name), uploadedBytesTotal: f.renderers[name].stats.uploadedBytes, uploadKind: f.renderers[name].uploadKind ?? 'vertex-buffer'}
  }
  document.getElementById('status').textContent = 'GPU stage diagnostic ' + (repetition + 1) + '/3; blank/fat charts are deliberate diagnostic modes'
  for (const name of f.names) warmup[name] = await once(name, make(0))
  for (let frame = 1; frame <= frames; frame++) {
    const order = frame % 2 ? f.names : [...f.names].reverse(), packets = make(frame), proof = {}
    for (const name of order) {
      samples[name].push(await once(name, packets))
      if (!f.isolate && (frame === 1 || frame === frames) && !['vertex-only', 'constant-fragment'].includes(name)) proof[name] = f.pixels()
      if (frame === frames) images[name] = f.canvas.toDataURL('image/png')
    }
    if (!f.isolate && proof.stable) for (const name of f.candidates) pixelChecks.push({frame, candidate: name, ...f.compare(proof.stable, proof[name])})
  }
  const stats = values => {const sorted = [...values].sort((a, b) => a - b); return {median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * .95) - 1]}}
  const all = [...Object.values(samples).flat(), ...Object.values(warmup)]
  return {repetition, frames, prefillPerChannel: prefill, finalPerChannel: maximum, queriesValid: all.every(s => s.query.status === 'available' && s.glError === 0), samples, warmup, pixelChecks, images, summary: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, {gpuElapsedMs: stats(values.map(v => v.query.ms)), synchronizedMs: stats(values.map(v => v.synchronizedMs)), callbackMs: stats(values.map(v => v.callbackMs))}]))}
}
