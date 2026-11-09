import {build} from 'esbuild'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'

const directory = 'codex_artifact/line-block-projection-compare/' + new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
await mkdir(directory, {recursive: true})
await build({stdin: {contents: "export {LineBlockCache} from './src/line-block-cache.ts';", resolveDir: process.cwd()}, bundle: true, platform: 'node', format: 'esm', outfile: directory + '/candidate.js'})
const previousPath = 'codex_artifact/line-blocks-visible/2026-11-02T08-27-09-539Z/candidate.js'
const previous = await import(pathToFileURL(resolve(previousPath))), current = await import(pathToFileURL(resolve(directory, 'candidate.js')))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const results = []
for (const storage of [Float32Array, Float64Array]) {
  const data = new previous.DataSetXY({schema: {x: {storage: Float64Array, auto: true, pattern: 'progressive'}, y: {storage}}})
  data.setMaxSampleCount(100000)
  const caches = [new previous.LineBlockCache(), new current.LineBlockCache()]
  let next = 0
  function append(count, step = 1000 / 48000, start) {
    const values = new storage(count)
    for (let i = 0; i < count; i++) values[i] = (next + i) % 997 === 0 ? NaN : Math.sin((next + i) * .073)
    data.appendSamples({y: values}, {step, ...(start === undefined ? {} : {start})}); next += count
  }
  function check(id, viewOffset = 0, visible = 80000) {
    const after = data.getNextSampleIndex(), first = after - data.getSampleCount()
    const order = previous.getColumnOrder(data, 'x'), start = Math.max(first, after - visible - viewOffset), end = Math.min(after - 1, start + visible)
    const request = {source: {identity: data, contentEpoch: data.getContentEpoch(), revision: data.revision, firstSampleIndex: first, nextSampleIndex: after, x: data.getColumnRuns('x'), y: data.getColumnRuns('y')}, coordinateMode: 'linear', projectionKey: 'linear', bindingRevision: 0, styleRevision: 0, visibleSegments: {first: start, end}, domain: {x: {start: data.getValue('x', start - first), end: data.getValue('x', end - first)}, y: {start: -2, end: 2}}, style: {color: [0, 1, 1, 1], thickness: 2}, monotonicX: order.strict && order.finite ? 'verified-strict' : 'invalid'}
    const [before, candidate] = caches.map(cache => cache.update(request))
    if (before.kind !== 'blocks' || candidate.kind !== 'blocks') throw new Error('Unexpected fallback')
    const packets = candidate.packets.map((packet, index) => {
      const baseline = before.packets[index], bytes = Buffer.from(packet.positions.buffer, packet.positions.byteOffset, packet.positions.byteLength), reference = Buffer.from(baseline.positions.buffer, baseline.positions.byteOffset, baseline.positions.byteLength)
      return {sameBytes: bytes.equals(reference), sha256: hash(bytes), sameOrigin: JSON.stringify(packet.origin) === JSON.stringify(baseline.origin), samePrecision: JSON.stringify(packet.precision) === JSON.stringify(baseline.precision), sameRange: packet.drawFirst === baseline.drawFirst && packet.drawCount === baseline.drawCount, sameRevision: packet.revision === baseline.revision && packet.previousRevision === baseline.previousRevision && packet.updateFrom === baseline.updateFrom}
    })
    const statsEqual = JSON.stringify(before.stats) === JSON.stringify(candidate.stats)
    results.push({storage: storage.name, id, packets, statsEqual, passed: before.packets.length === candidate.packets.length && statsEqual && packets.every(packet => packet.sameBytes && packet.sameOrigin && packet.samePrecision && packet.sameRange && packet.sameRevision)})
  }
  append(100000, 1000 / 48000, 1700000000000); check('epoch-initial')
  append(997); append(3); append(55); check('multi-append-ring')
  check('pan-same-block', 1); check('zoom', 0, 1000)
  append(32770); check('cross-block-and-ring')
  data.clear(); next = 0; append(100000, .25, -100000); check('clear-negative-X')
  append(1000, .125); check('new-affine-step')
  caches.forEach(cache => cache.dispose()); data.dispose()
}
const report = {createdAt: new Date().toISOString(), previousPath, candidateSha256: hash(await readFile(directory + '/candidate.js')), status: results.every(result => result.passed) ? 'passed' : 'failed', scope: 'CPU projection bytes and metadata, not browser rendering or performance', results}
await writeFile(directory + '/report.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({status: report.status, cases: results.length, report: directory + '/report.json'}))
if (report.status !== 'passed') process.exitCode = 1
