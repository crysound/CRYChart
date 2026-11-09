import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {build} from 'esbuild'
import {connectVisibleChrome, ensureTestServer} from './visible-browser.mjs'

// Original code only. The full-series control uses the production projection
// helper. No vendor bytes, application process, or commercial configuration.
const directory = `codex_artifact/line-blocks-visible/${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`
const ringOnly = process.argv.includes('--ring-only')
const repetitions = Number(process.argv.find(value => value.startsWith('--repetitions='))?.split('=')[1] ?? 3)
if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 3) throw new Error('Repetitions must be from 1 to 3')
await mkdir(directory, {recursive: true})
await writeFile(directory + '/runner.mjs', await readFile(import.meta.filename))
await build({stdin: {contents: [
  "export {LineStripRenderer} from './src/render-line-strip.ts';",
  "export {LineBlockCache} from './src/line-block-cache.ts';",
  "export {DataSetXY} from './src/core/data.ts';",
  "export {getColumnOrder} from './src/data-order.ts';",
  "export {firstRunValue,projectXYRuns} from './src/data-runs.ts';",
  "export {visibleSourceSegments} from './src/viewport.ts';",
].join('\n'), resolveDir: process.cwd()}, bundle: true, format: 'esm', outfile: directory + '/candidate.js'})
const bytes = await readFile(directory + '/candidate.js')
await writeFile(directory + '/fixture.html', '<!doctype html><meta charset="utf-8"><title>CRYChart visible block-cache oracle</title><style>body{background:#101827;color:white;font:16px system-ui;margin:20px}canvas{display:block;width:1000px;height:600px;background:#000}p{max-width:1000px}</style><h2 id="status">Visible Chrome: block-cache precision and seams</h2><canvas id="chart" width="1000" height="600"></canvas><p>Experimental cache, production unchanged. Exact source data are retained. Whole-series and per-block origins are compared independently of the same-origin segmentation control.</p>')
const report = {createdAt: new Date().toISOString(), status: 'inprogress', visible: true, headless: false, productionChanged: false, parityClaim: false,
  bundleSha256: createHash('sha256').update(bytes).digest('hex'), checks: [], trials: [], errors: [],
  definitions: {
    fullRgba: 'All 1000×600×4 RGBA bytes from the same visible WebGL2 drawing buffer. Any byte difference remains a difference.',
    sameOriginControl: 'Reprojects the exact raw source into the whole-series origin while retaining block ownership and halos; isolates segmentation from origin rounding. This is a diagnostic, not the proposed cache.',
    precision: 'CPU Float64 source versus Float64 origin plus stored Float32 relative position; maximum error over owned points, and seams checked against the exact source coordinate.',
    gpu: 'EXT_disjoint_timer_query_webgl2 around clear, upload and draw commands; query excludes synchronous readPixels. Queries are polled asynchronously and disjoint results rejected.',
    work: 'JavaScript preparation plus draw submission followed by 1×1 readPixels. Includes readback/driver overhead; not pure GPU time or presentation latency.',
  }, limitations: ['Independent direct-renderer fixture, not OpenTest application execution or official-library performance.', 'Per-block origins may improve source-coordinate precision yet change raster bytes. Neither is silently relabeled equivalent.', 'Source memory is preserved; only derived projection and renderer caches are eligible for eviction.'],
}
let browser, page
const server = await ensureTestServer()
try {
  const connected = await connectVisibleChrome(); browser = connected.browser; page = connected.page
  report.browser = connected.metadata.Browser
  await page.setViewportSize({width: 1100, height: 780})
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto('http://127.0.0.1:4178/' + directory + '/fixture.html', {waitUntil: 'load'})
  report.environment = await page.evaluate(setup)
  const cases = ringOnly ? [] : ['binary', 'smooth', 'pan', 'zoom', 'negative', 'nan-seam', 'epoch-48k', 'large-offset-small-amplitude', 'ring-initial', 'ring-wrap', 'append-initial', 'append-tail', 'pan-cross-block', 'stack-clip', 'empty-clip', 'clear-refill', 'dense-visible-quarter']
  for (const id of cases) {
    const result = await page.evaluate(compareCase, id)
    result.screenshots = {}
    for (const [name, data] of Object.entries(result.images)) {
      const file = `${directory}/${id}-${name}.png`; await writeFile(file, Buffer.from(data.split(',')[1], 'base64')); result.screenshots[name] = file
    }
    delete result.images; report.checks.push(result)
    console.log(JSON.stringify({case: id, sameOrigin: result.sameOrigin, candidate: result.candidate, precision: result.precision, stats: result.stats}))
  }
  for (let repetition = 0; repetition < repetitions; repetition++) {
    const result = await page.evaluate(measure, {repetition, frames: 16})
    result.screenshots = {}
    for (const [name, data] of Object.entries(result.images)) {
      const file = `${directory}/stream-${repetition}-${name}.png`; await writeFile(file, Buffer.from(data.split(',')[1], 'base64')); result.screenshots[name] = file
    }
    delete result.images
    report.trials.push(result)
    console.log(JSON.stringify({repetition, valid: result.valid, summaries: result.summaries, pixelChecks: result.pixelChecks}))
  }
  report.disposal = await page.evaluate(() => window.__blocks.dispose())
  report.status = report.errors.length || report.checks.some(check => !check.sourceUnchanged || check.glError) || report.trials.some(trial => !trial.valid) ? 'failed' : 'observed-review-required'
} catch (error) {report.errors.push(error.message); report.status = 'failed'; process.exitCode = 1}
finally {
  report.completedAt = new Date().toISOString()
  await writeFile(directory + '/report.json', JSON.stringify(report, null, 2) + '\n')
  if (page) await page.goto('http://127.0.0.1:4178/#demo=stream').catch(() => {})
  if (browser) await browser.close()
  await server.close()
  console.log(JSON.stringify({status: report.status, report: directory + '/report.json'}))
}

async function setup() {
  const api = await import('./candidate.js')
  const {DataSetXY, LineStripRenderer, LineBlockCache, getColumnOrder, firstRunValue, projectXYRuns, visibleSourceSegments} = api
  const canvas = document.getElementById('chart'), gl = canvas.getContext('webgl2', {antialias: false, preserveDrawingBuffer: true, alpha: true, premultipliedAlpha: true})
  if (!gl) throw new Error('Visible WebGL2 unavailable')
  const rect = {left: 100, top: 80, width: 800, height: 420}
  const renderers = {whole: new LineStripRenderer(gl), blocks: new LineStripRenderer(gl), control: new LineStripRenderer(gl)}
  let packetId = 100
  const created = [], caches = []
  function source(count, options = {}) {
    const data = new DataSetXY({schema: {x: {storage: Float64Array, auto: true, pattern: 'progressive'}, y: {storage: options.storage ?? Float64Array}}})
    if (options.capacity) data.setMaxSampleCount(options.capacity)
    const values = Float64Array.from({length: count}, (_, i) => options.value ? options.value(i) : Math.sin(i * .073) + .2 * Math.cos(i * .197))
    data.appendSamples({y: values}, {start: options.start ?? 0, step: options.step ?? 1}); created.push(data); return data
  }
  const cache = size => {const result = new LineBlockCache({segmentsPerBlock: size}); caches.push(result); return result}
  const cases = {}, add = (id, data, options = {}) => cases[id] = {id, data, cache: options.cache ?? cache(options.blockSize ?? 128), domain: options.domain ?? {x: {start: data.getValue('x', 0), end: data.getValue('x', data.getSampleCount() - 1)}, y: {start: -1.5, end: 1.5}}, ...options}
  const binary = source(1025, {step: .25, value: i => (i % 32 - 16) / 16}), smooth = source(1001)
  add('binary', binary); add('smooth', smooth)
  add('pan', smooth, {cache: cases.smooth.cache, domain: {x: {start: 9.125, end: 1009.125}, y: {start: -1.5, end: 1.5}}})
  add('zoom', smooth, {cache: cases.smooth.cache, domain: {x: {start: 250.25, end: 450.25}, y: {start: -.7, end: .7}}})
  add('negative', source(1001, {start: -12345.25, step: .25}))
  const nan = source(1001, {value: i => [127, 128, 129, 255, 256, 384, 385, 1000].includes(i) ? NaN : Math.sin(i * .073)})
  add('nan-seam', nan)
  add('epoch-48k', source(8001, {start: 1700000000000, step: 1000 / 48000}), {blockSize: 512})
  add('large-offset-small-amplitude', source(1001, {start: 1e12, step: .000244140625, value: i => 1e9 + Math.sin(i * .073) * .00001}), {domain: {x: {start: 1e12, end: 1e12 + .244140625}, y: {start: 1e9 - .000015, end: 1e9 + .000015}}})
  const ring = source(1001, {capacity: 1001})
  add('ring-initial', ring); add('ring-wrap', ring, {cache: cases['ring-initial'].cache, mutate: () => ring.appendSamples({y: Float64Array.from({length: 137}, (_, i) => Math.sin((1001 + i) * .073) + .2 * Math.cos((1001 + i) * .197))})})
  const append = source(997)
  add('append-initial', append); add('append-tail', append, {cache: cases['append-initial'].cache, mutate: () => {append.appendSamples({y: [0, .2, .4]}); append.appendSamples({y: [.6, .8, 1, .8, .6]})}})
  add('pan-cross-block', smooth, {cache: cases.smooth.cache, domain: {x: {start: 510, end: 710}, y: {start: -1.5, end: 1.5}}})
  add('stack-clip', smooth, {clipRect: {left: 100, top: 220, width: 800, height: 140}})
  add('empty-clip', smooth, {clipRect: {left: 100, top: 220, width: 800, height: 0}})
  add('clear-refill', append, {cache: cases['append-initial'].cache, mutate: () => {append.clear(); append.appendSamples({y: Float64Array.from({length: 1005}, (_, i) => .5 * Math.cos(i * .057))}, {start: 40000, step: .25})}})
  const dense = source(100000)
  add('dense-visible-quarter', dense, {blockSize: 32760, domain: {x: {start: 75000, end: 99999}, y: {start: -1.5, end: 1.5}}})
  function request(data, options) {
    const next = data.getNextSampleIndex(), first = next - data.getSampleCount(), order = getColumnOrder(data, 'x')
    const visibleSegments = visibleSourceSegments(data, 'x', options.domain.x, rect.width, 2)
    if (!visibleSegments) throw new Error('Source order is not eligible')
    return {source: {identity: data, revision: data.revision, contentEpoch: data.getContentEpoch(), firstSampleIndex: first, nextSampleIndex: next, x: data.getColumnRuns('x'), y: data.getColumnRuns('y')}, projectionKey: 'linear-x-y', coordinateMode: 'linear', bindingRevision: 0, styleRevision: 0, visibleSegments, domain: options.domain, clipRect: options.clipRect, style: {color: options.color ?? [.1, .86, .7, 1], thickness: 2}, monotonicX: order.finite && order.strict ? 'verified-strict' : 'invalid'}
  }
  function whole(data, options, id = packetId++) {
    const x = data.getColumnRuns('x'), y = data.getColumnRuns('y'), positions = new Float32Array(data.getSampleCount() * 2)
    const x0 = firstRunValue(x), y0 = firstRunValue(y), origin = {x: Number.isFinite(x0) ? x0 : 0, y: Number.isFinite(y0) ? y0 : 0, z: 0}
    const order = projectXYRuns(x, y, positions, 0, origin, false, false)
    return {id, revision: data.revision, count: data.getSampleCount(), positions, origin, domain: options.domain, clipRect: options.clipRect, color: options.color ?? [.1, .86, .7, 1], thickness: 2, pointSize: 0, dimensions: 2, mode: 'line', monotonicX: order.monotonic, strictlyMonotonicX: order.strict}
  }
  function control(data, packets, origin) {
    const first = data.getNextSampleIndex() - data.getSampleCount(), count = data.getSampleCount()
    return packets.map(packet => {
      const positions = new Float32Array(packet.count * 2)
      for (let i = 0; i < packet.count; i++) {const index = Math.max(0, Math.min(count - 1, packet.sourceFirstSample + i - first)); positions[i * 2] = data.getValue('x', index) - origin.x; positions[i * 2 + 1] = data.getValue('y', index) - origin.y}
      return {...packet, id: packetId++, positions, origin, updateFrom: undefined, previousRevision: undefined}
    })
  }
  function render(name, packets) {
    gl.disable(gl.SCISSOR_TEST); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
    const renderer = renderers[name]; renderer.beginFrame()
    for (const packet of packets) if (!renderer.draw(packet, rect, 1)) throw new Error('Renderer rejected packet')
    renderer.endFrame()
  }
  const pixels = () => {const data = new Uint8Array(canvas.width * canvas.height * 4); gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data); return data}
  const compare = (a, b) => {let differingBytes = 0, maxDifference = 0, visiblePixels = 0, absentPixels = 0; for (let i = 0; i < a.length; i++) {const difference = Math.abs(a[i] - b[i]); if (difference) differingBytes++; maxDifference = Math.max(maxDifference, difference); if (i % 4 === 3) {if (b[i]) visiblePixels++; if (a[i] > 127 && b[i] === 0) absentPixels++}} return {differingBytes, maxDifference, visiblePixels, absentPixels, samePixels: differingBytes === 0}}
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  window.__blocks = {api, gl, canvas, rect, renderers, cases, source, cache, request, whole, control, render, pixels, compare,
    dispose() {
      const before = created.map(data => data.getSampleCount())
      const handles = Object.values(renderers).flatMap(renderer => [...renderer.buffers.values()].map(entry => entry.buffer))
      const rendererStorageBytesBefore = Object.values(renderers).reduce((total, renderer) => total + [...renderer.buffers.values()].reduce((sum, entry) => sum + entry.storage.byteLength, 0), 0)
      for (const value of caches) value.dispose()
      for (const renderer of Object.values(renderers)) renderer.dispose()
      const after = created.map(data => data.getSampleCount())
      const cacheEntriesAfter = caches.reduce((sum, value) => sum + value.entries.size, 0)
      const rendererEntriesAfter = Object.values(renderers).reduce((sum, renderer) => sum + renderer.buffers.size, 0)
      const liveBufferHandlesAfter = handles.filter(buffer => gl.isBuffer(buffer)).length
      for (const data of created) data.dispose()
      return {sourceAliveAfterCacheDispose: before.every((count, i) => count === after[i]), rendererStorageBytesBefore, cacheEntriesAfter, rendererEntriesAfter, liveBufferHandlesAfter, glError: gl.getError(), qualification: 'Original cache maps and WebGL buffer handles; not browser process-memory recovery'}
    }}
  return {browserDpr: devicePixelRatio, rendererDpr: 1, canvasDevicePixels: {width: canvas.width, height: canvas.height}, plotDevicePixels: rect, renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), context: gl.getContextAttributes()}
}

async function compareCase(id) {
  const f = window.__blocks, item = f.cases[id], data = item.data
  document.getElementById('status').textContent = 'Visible block-cache oracle: ' + id
  item.mutate?.()
  if (item.mutate) item.domain.x = {start: data.getValue('x', 0), end: data.getValue('x', data.getSampleCount() - 1)}
  const fingerprint = async () => {
    const values = new Float64Array(data.getSampleCount() * 2)
    for (let i = 0; i < data.getSampleCount(); i++) {values[i * 2] = data.getValue('x', i); values[i * 2 + 1] = data.getValue('y', i)}
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', values))].map(value => value.toString(16).padStart(2, '0')).join('')
    return {count: data.getSampleCount(), next: data.getNextSampleIndex(), epoch: data.getContentEpoch(), sha256}
  }
  const before = await fingerprint(), request = f.request(data, item), result = item.cache.update(request)
  if (result.kind !== 'blocks') throw new Error('Block fallback: ' + result.reason)
  const whole = f.whole(data, item), control = f.control(data, result.packets, whole.origin), images = {}
  f.render('whole', [whole]); const expected = f.pixels(); images.whole = f.canvas.toDataURL('image/png')
  f.render('control', control); const sameOrigin = f.compare(expected, f.pixels())
  f.render('blocks', result.packets); const candidatePixels = f.pixels(), candidate = f.compare(expected, candidatePixels); images.blocks = f.canvas.toDataURL('image/png')
  const first = data.getNextSampleIndex() - data.getSampleCount()
  let blockErrorX = 0, blockErrorY = 0, wholeErrorX = 0, wholeErrorY = 0, requested = 0
  const seams = []
  for (const packet of result.packets) {
    requested += packet.endOwnedSegment - packet.firstOwnedSegment
    for (let local = packet.drawFirst; local < packet.drawFirst + packet.drawCount; local++) {
      const index = packet.sourceFirstSample + local - first, x = data.getValue('x', index), y = data.getValue('y', index)
      blockErrorX = Math.max(blockErrorX, Math.abs(packet.positions[local * 2] + packet.origin.x - x)); wholeErrorX = Math.max(wholeErrorX, Math.abs(whole.positions[index * 2] + whole.origin.x - x))
      if (Number.isFinite(y)) {blockErrorY = Math.max(blockErrorY, Math.abs(packet.positions[local * 2 + 1] + packet.origin.y - y)); wholeErrorY = Math.max(wholeErrorY, Math.abs(whole.positions[index * 2 + 1] + whole.origin.y - y))}
    }
    if (seams.length || packet !== result.packets[0]) {
      const index = packet.firstOwnedSegment - first, x = data.getValue('x', index), y = data.getValue('y', index), px = f.rect.left + (x - item.domain.x.start) / (item.domain.x.end - item.domain.x.start) * f.rect.width, py = f.canvas.height - (f.rect.top + f.rect.height) + (y - item.domain.y.start) / (item.domain.y.end - item.domain.y.start) * f.rect.height
      let baselinePeakAlpha = 0, candidatePeakAlpha = 0
      if (Number.isFinite(py)) for (let row = Math.floor(py) - 3; row <= Math.ceil(py) + 3; row++) for (let column = Math.floor(px) - 3; column <= Math.ceil(px) + 3; column++) if (row >= 0 && row < f.canvas.height && column >= 0 && column < f.canvas.width) {const p = (row * f.canvas.width + column) * 4 + 3; baselinePeakAlpha = Math.max(baselinePeakAlpha, expected[p]); candidatePeakAlpha = Math.max(candidatePeakAlpha, candidatePixels[p])}
      seams.push({absoluteSample: packet.firstOwnedSegment, sourceX: x, sourceY: Number.isFinite(y) ? y : null, baselinePeakAlpha, candidatePeakAlpha})
    }
  }
  const partition = result.packets.every((packet, i) => !i || result.packets[i - 1].endOwnedSegment === packet.firstOwnedSegment)
  const after = await fingerprint()
  const cssScaleX = f.rect.width / Math.abs(item.domain.x.end - item.domain.x.start), cssScaleY = f.rect.height / Math.abs(item.domain.y.end - item.domain.y.start)
  return {id, sameOrigin, candidate, precision: {blockErrorX, blockErrorY, wholeErrorX, wholeErrorY, blockCssX: blockErrorX * cssScaleX, blockCssY: blockErrorY * cssScaleY, wholeCssX: wholeErrorX * cssScaleX, wholeCssY: wholeErrorY * cssScaleY, limitation: 'Source reconstruction only; excludes shader uniform rounding, arithmetic and rasterization'}, domain: item.domain, sourceUnchanged: JSON.stringify(before) === JSON.stringify(after), sourceFingerprint: {before, after}, sourceRetainedSamples: data.getSampleCount(), sourceStorage: data.getStorageStats(), stats: result.stats, segmentPartition: {adjacent: partition, actual: requested, expected: request.visibleSegments.end - request.visibleSegments.first}, seams, glError: f.gl.getError(), images}
}

async function measure({repetition, frames}) {
  const f = window.__blocks, gl = f.gl, extension = gl.getExtension('EXT_disjoint_timer_query_webgl2')
  if (!extension || !gl.getQuery(extension.TIME_ELAPSED_EXT, extension.QUERY_COUNTER_BITS_EXT)) throw new Error('GPU timer unavailable')
  const capacity = 100000, batch = 1000, visibleCount = 25000, channels = 4, pixel = new Uint8Array(4)
  const sources = Array.from({length: channels}, (_, channel) => f.source(capacity, {capacity, storage: Float32Array, value: i => channel * 3 + .8 * Math.sin(i * .017 + channel) + .08 * Math.cos(i * .113)}))
  const caches = sources.map(() => f.cache(32760)), ids = sources.map((_, index) => 1000000 + repetition * 10 + index)
  const options = {domain: {x: {start: capacity - visibleCount, end: capacity - 1}, y: {start: -1, end: 11}}}
  const values = {whole: [], blocks: []}, warmup = {}, images = {}, checks = [], lastPackets = {}
  const poll = query => new Promise(resolve => {const start = performance.now(); const next = () => {
    if (gl.getParameter(extension.GPU_DISJOINT_EXT)) {gl.deleteQuery(query); resolve({status: 'disjoint'}); return}
    if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {const ms = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(query); resolve({status: 'available', ms}); return}
    if (performance.now() - start > 5000) {gl.deleteQuery(query); resolve({status: 'timeout'}); return}
    requestAnimationFrame(next)
  }; requestAnimationFrame(next)})
  async function once(name) {
    await new Promise(requestAnimationFrame)
    const beforeBytes = f.renderers[name].stats.uploadedBytes, began = performance.now()
    let packets, cacheStats
    if (name === 'whole') packets = sources.map((data, i) => f.whole(data, options, ids[i]))
    else {
      const results = sources.map((data, i) => caches[i].update(f.request(data, options)))
      if (results.some(result => result.kind !== 'blocks')) throw new Error('Timed block fallback')
      packets = results.flatMap(result => result.packets); cacheStats = results.map(result => result.stats)
    }
    lastPackets[name] = packets
    const preparationMs = performance.now() - began, query = gl.createQuery()
    gl.beginQuery(extension.TIME_ELAPSED_EXT, query); f.render(name, packets); gl.endQuery(extension.TIME_ELAPSED_EXT)
    const callbackMs = performance.now() - began, readStart = performance.now(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    const workMs = performance.now() - began, readPixelsMs = performance.now() - readStart, glError = gl.getError()
    return {preparationMs, callbackMs, workMs, readPixelsMs, query: await poll(query), glError, uploadedBytes: f.renderers[name].stats.uploadedBytes - beforeBytes, renderer: {...f.renderers[name].stats}, cacheStats}
  }
  document.getElementById('status').textContent = `Visible full-ring cache diagnostic ${repetition + 1}/3: 4 × 100k retained; 25k visible; 1000 appended`
  for (const name of ['whole', 'blocks']) warmup[name] = await once(name)
  for (let frame = 1; frame <= frames; frame++) {
    const next = capacity + frame * batch
    sources.forEach((data, channel) => data.appendSamples({y: Float32Array.from({length: batch}, (_, i) => channel * 3 + .8 * Math.sin((next - batch + i) * .017 + channel) + .08 * Math.cos((next - batch + i) * .113))}))
    options.domain.x = {start: next - visibleCount, end: next - 1}
    const proof = {}
    for (const name of frame % 2 ? ['whole', 'blocks'] : ['blocks', 'whole']) {
      values[name].push(await once(name))
      if (frame === 1 || frame === frames) proof[name] = f.pixels()
      if (frame === frames) images[name] = f.canvas.toDataURL('image/png')
    }
    if (proof.whole) {
      const control = []
      for (let channel = 0; channel < channels; channel++) {
        // Packet groups have equal deterministic block spans, with per-source
        // identities. Keep exact append/cache order instead of guessing IDs.
        const perChannel = lastPackets.blocks.length / channels
        control.push(...f.control(sources[channel], lastPackets.blocks.slice(channel * perChannel, (channel + 1) * perChannel), lastPackets.whole[channel].origin))
      }
      f.render('control', control); const sameOrigin = f.compare(proof.whole, f.pixels())
      if (frame === frames) images.sameOrigin = f.canvas.toDataURL('image/png')
      const fresh = lastPackets.blocks.map((packet, index) => ({...packet, id: 2000000 + repetition * 10000 + frame * 100 + index, previousRevision: undefined, updateFrom: undefined}))
      f.render('control', fresh); const freshUpload = f.compare(proof.blocks, f.pixels())
      if (frame === frames) images.freshUpload = f.canvas.toDataURL('image/png')
      const sourceError = {whole: {x: 0, y: 0, cssX: 0, cssY: 0}, blocks: {x: 0, y: 0, cssX: 0, cssY: 0}}
      for (const name of ['whole', 'blocks']) {
        const perChannel = lastPackets[name].length / channels
        for (let channel = 0; channel < channels; channel++) {
          const source = sources[channel], first = source.getNextSampleIndex() - source.getSampleCount(), visible = f.request(source, options).visibleSegments
          for (const packet of lastPackets[name].slice(channel * perChannel, (channel + 1) * perChannel)) {
            const begin = packet.drawFirst ?? 0, end = begin + (packet.drawCount ?? packet.count)
            for (let local = begin; local < end; local++) {
              const index = name === 'whole' ? local : packet.sourceFirstSample + local - first
              if (index + first < visible.first || index + first > visible.end) continue
              const dx = Math.abs(packet.origin.x + packet.positions[local * 2] - source.getValue('x', index))
              const dy = Math.abs(packet.origin.y + packet.positions[local * 2 + 1] - source.getValue('y', index))
              sourceError[name].x = Math.max(sourceError[name].x, dx); sourceError[name].y = Math.max(sourceError[name].y, dy)
            }
          }
        }
        sourceError[name].cssX = sourceError[name].x * f.rect.width / Math.abs(options.domain.x.end - options.domain.x.start)
        sourceError[name].cssY = sourceError[name].y * f.rect.height / Math.abs(options.domain.y.end - options.domain.y.start)
      }
      const differences = []
      for (let offset = 0; offset < proof.whole.length; offset++) if (proof.whole[offset] !== proof.blocks[offset] && differences.length < 64) differences.push({x: Math.floor(offset / 4) % f.canvas.width, yFromBottom: Math.floor(offset / (f.canvas.width * 4)), channel: offset % 4, whole: proof.whole[offset], blocks: proof.blocks[offset]})
      checks.push({frame, ...f.compare(proof.whole, proof.blocks), sameOrigin, freshUpload, sourceError, differences})
    }
    if (sources.some(data => data.getSampleCount() !== capacity || data.getNextSampleIndex() !== next)) throw new Error('Actual ring retention mismatch')
  }
  const stats = input => {const a = [...input].sort((a, b) => a - b); return {median: a[Math.floor(a.length / 2)], p95: a[Math.ceil(a.length * .95) - 1]}}
  const all = [...Object.values(warmup), ...values.whole, ...values.blocks]
  return {repetition, frames, channels, retainedPerChannel: capacity, visiblePerChannel: visibleCount, batchPerChannel: batch, finalNextSampleIndex: sources[0].getNextSampleIndex(), rawSourceStorage: sources.map(data => data.getStorageStats()), valid: all.every(value => value.glError === 0 && value.query.status === 'available'), warmup, samples: values, pixelChecks: checks, images, summaries: Object.fromEntries(Object.entries(values).map(([name, samples]) => [name, {gpuElapsedMs: stats(samples.map(v => v.query.ms)), workMs: stats(samples.map(v => v.workMs)), preparationMs: stats(samples.map(v => v.preparationMs)), uploadedBytes: stats(samples.map(v => v.uploadedBytes))}]))}
}
