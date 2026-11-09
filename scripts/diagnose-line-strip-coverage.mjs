import assert from 'node:assert/strict'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'

// Independent Float64 geometry diagnostic. It neither renders with WebGL nor
// assumes the older CRY renderer is a visual reference. No production imports.
const referencePath = 'codex_artifact/line-display-visible/2026-11-02T10-47-10-957Z/report.json'
const directory = 'codex_artifact/line-strip-coverage-diagnosis'
const canvas = {width: 1000, height: 600}
const plot = {left: 100, top: 80, width: 800, height: 420}
const viewport = {left: 100, bottom: 100, width: 800, height: 420}
const lineWidth = 2
const geometryRadius = (lineWidth + 2) / 2
const coverageRadius = lineWidth / 2 + .5
const count = 48000
const step = 1000 / 48000
const xLast = (count - 1) * step
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
const add = (a, b) => ({x: a.x + b.x, y: a.y + b.y})
const multiply = (a, scale) => ({x: a.x * scale, y: a.y * scale})
const length = vector => Math.hypot(vector.x, vector.y)
const difference = (a, b) => ({x: a.x - b.x, y: a.y - b.y})
const finite = point => Number.isFinite(point.x) && Number.isFinite(point.y)

function distanceToSegment(point, a, b) {
  const ab = difference(b, a), ap = difference(point, a)
  const squared = ab.x * ab.x + ab.y * ab.y
  const t = Math.max(0, Math.min(1, squared ? (ap.x * ab.x + ap.y * ab.y) / squared : 0))
  return Math.hypot(ap.x - t * ab.x, ap.y - t * ab.y)
}

function inTriangle(point, a, b, c) {
  // Strictly interior misses, not top-left rasterization edge disputes, are the
  // relevant evidence. The tolerance conservatively includes all boundary ties.
  const area = cross(a, b, c)
  if (!Number.isFinite(area) || Math.abs(area) < 1e-12) return false
  const signs = [cross(a, b, point), cross(b, c, point), cross(c, a, point)]
  return area > 0 ? signs.every(value => value >= -1e-8) : signs.every(value => value <= 1e-8)
}

function pairAt(points, index, limit = 4) {
  const p = points[index], previous = points[Math.max(0, index - 1)], next = points[Math.min(points.length - 1, index + 1)]
  const incoming = difference(p, previous), outgoing = difference(next, p)
  const aLength = length(incoming), bLength = length(outgoing)
  const hasPrevious = finite(previous) && aLength > .000005
  const hasNext = finite(next) && bLength > .000005
  let a = hasPrevious ? {x: -incoming.y / aLength, y: incoming.x / aLength} : {x: 0, y: 1}
  const b = hasNext ? {x: -outgoing.y / bLength, y: outgoing.x / bLength} : a
  if (!hasPrevious) a = b
  const sum = add(a, b), sumLength = length(sum)
  const unit = sumLength > .00001 ? multiply(sum, 1 / sumLength) : a
  const dot = unit.x * a.x + unit.y * a.y
  const denominator = Math.max(limit === Infinity ? 0 : 1 / limit, dot)
  const miter = multiply(unit, geometryRadius / denominator)
  let cap = {x: 0, y: 0}
  if (!hasPrevious && hasNext) cap = multiply(outgoing, -geometryRadius / bLength)
  if (hasPrevious && !hasNext) cap = multiply(incoming, geometryRadius / aLength)
  return {
    left: add(add(p, cap), multiply(miter, -1)), right: add(add(p, cap), miter),
    dot, clipped: dot < 1 / limit, actualRadius: length(miter),
    unlimitedRadius: geometryRadius / dot,
  }
}

function segmentHullContains(points, index, pixel, limit = 4) {
  const a = pairAt(points, index, limit), b = pairAt(points, index + 1, limit)
  // The strip has two vertices per sample. Both triangles have the end sample
  // as their last provoking vertex, so their fragment distance is this segment.
  return inTriangle(pixel, a.left, a.right, b.left) || inTriangle(pixel, a.right, b.left, b.right)
}

function adjacentCoverage(points, index, pixel, limit) {
  let expected = 0, covered = 0
  const segments = []
  for (const start of [index - 1, index]) {
    if (start < 0 || start + 1 >= points.length) continue
    const distance = distanceToSegment(pixel, points[start], points[start + 1])
    const alpha = Math.round(Math.max(0, Math.min(1, coverageRadius - distance)) * 255)
    const hull = segmentHullContains(points, start, pixel, limit)
    expected = Math.max(expected, alpha)
    if (hull) covered = Math.max(covered, alpha)
    segments.push({start, distance, minimumAlpha: alpha, triangleHullContains: hull})
  }
  return {expected, covered, segments}
}

// A conservative independent segment quad contains the whole AA capsule. This
// is a geometry lower bound / repair requirement, not a proposed blend policy.
function capsuleQuadContains(a, b, pixel) {
  const delta = difference(b, a), norm = length(delta)
  if (!norm) return Math.abs(pixel.x - a.x) <= coverageRadius && Math.abs(pixel.y - a.y) <= coverageRadius
  const along = multiply(delta, 1 / norm), normal = {x: -along.y, y: along.x}
  const offset = difference(pixel, a)
  const u = offset.x * along.x + offset.y * along.y
  const v = offset.x * normal.x + offset.y * normal.y
  return u >= -coverageRadius && u <= norm + coverageRadius && Math.abs(v) <= coverageRadius
}

function signal(index) {
  return index % 997 === 0 ? 1.2 : index % 991 === 0 ? -1.2 : .7 * Math.sin(index * .19)
}
function projected(index) {
  return {
    x: viewport.left + index * step / xLast * viewport.width,
    y: viewport.bottom + (signal(index) + 1.3) / 2.6 * viewport.height,
  }
}

const original = JSON.parse(await readFile(referencePath, 'utf8'))
assert.equal(original.environment.rendererDpr, 1)
assert.equal(original.environment.context.antialias, false)
assert.deepEqual(original.environment.plot, plot)
const observed = original.checks.find(check => check.id === 'peaks')
assert.equal(observed.rawSourceOracle.checked, 96)
const points = Array.from({length: count}, (_, index) => projected(index))
const checks = observed.rawSourceOracle.checks.map(record => {
  const point = points[record.index]
  assert.ok(Math.abs(point.x - record.x) < 1e-9 && Math.abs(point.y - record.y) < 1e-9)
  const pixel = {x: Math.floor(point.x) + .5, y: Math.floor(point.y) + .5}
  assert.ok(pixel.x > viewport.left && pixel.x < viewport.left + viewport.width)
  assert.ok(pixel.y > viewport.bottom && pixel.y < viewport.bottom + viewport.height)
  const limited = adjacentCoverage(points, record.index, pixel, 4)
  const unlimited = adjacentCoverage(points, record.index, pixel, Infinity)
  assert.equal(limited.expected, record.expectedMinimumAlpha)
  assert.ok([record.index - 1, record.index].some(i => capsuleQuadContains(points[i], points[i + 1], pixel)))
  return {
    index: record.index, sourcePoint: point, pixel,
    expectedMinimumAlpha: limited.expected,
    observedRawAlpha: record.rawAlpha, observedDisplayAlpha: record.displayAlpha,
    limitedHullMinimumAlpha: limited.covered, unlimitedHullMinimumAlpha: unlimited.covered,
    pair: pairAt(points, record.index, 4), adjacentSegments: limited.segments,
  }
})

// Translation phase is deliberate: using an integer-centered apex could hide
// the gap. This exact center is inside the full-strength capsule but outside
// both capped-miter triangles. It is far from all viewport/scissor boundaries.
const canonicalPoints = [
  {x: 99.96, y: 0}, {x: 99.98, y: 0}, {x: 100, y: 100},
  {x: 100.02, y: 0}, {x: 100.04, y: 0},
]
const canonicalPixel = {x: 100.5, y: 99.5}
const canonicalLimited = adjacentCoverage(canonicalPoints, 2, canonicalPixel, 4)
const canonicalUnlimited = adjacentCoverage(canonicalPoints, 2, canonicalPixel, Infinity)
assert.ok(canonicalLimited.expected > 250)
assert.equal(canonicalLimited.covered, 0)
assert.equal(canonicalUnlimited.covered, canonicalLimited.expected)

const limitedMissing = checks.filter(check => check.limitedHullMinimumAlpha < check.expectedMinimumAlpha - 2)
const unlimitedMissing = checks.filter(check => check.unlimitedHullMinimumAlpha < check.expectedMinimumAlpha - 2)
assert.ok(limitedMissing.length > 0)
const report = {
  createdAt: new Date().toISOString(), type: 'independent Float64 CPU geometry diagnosis',
  referencePath, referenceSha256: createHash('sha256').update(await readFile(referencePath)).digest('hex'),
  productionSourceHashes: Object.fromEntries(await Promise.all(['src/render-line-strip.ts', 'src/render-line-direction.ts', 'src/render-line-offsets.ts', 'scripts/test-line-display-visible.mjs'].map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')]))),
  conditions: {canvas, plot, viewport, lineWidth, geometryRadius, coverageRadius, browserDpr: original.environment.browserDpr, rendererDpr: 1, antialias: false},
  oracleValidation: {
    checked: checks.length, exactSourceProjectionMatches: true, expectedAlphaMatches: true,
    pixelCentersUseFramebufferBottomOrigin: true, insideScissor: true,
    readbackUsesBackingPixels: true, browserCssDprAffectsOracle: false,
    fullConservativeCapsuleQuadContainsEveryProbe: true,
  },
  results: {
    observedRawBelowExpected: observed.rawSourceOracle.rawBelowExpected,
    observedDisplayBelowExpected: observed.rawSourceOracle.displayBelowExpected,
    float64LimitedHullBelowExpected: limitedMissing.length,
    float64UnlimitedHullBelowExpected: unlimitedMissing.length,
    limitedMissingWithObservedRawDefect: limitedMissing.filter(check => check.observedRawAlpha < check.expectedMinimumAlpha - 2).length,
    maximumUnlimitedMiterRadiusPixels: Math.max(...checks.map(check => check.pair.unlimitedRadius)),
  },
  canonical: {points: canonicalPoints, pixel: canonicalPixel, limited: canonicalLimited, unlimited: canonicalUnlimited, apexPair: pairAt(canonicalPoints, 2, 4)},
  checks,
  limits: [
    'This is an exact-source Float64 triangle coverage diagnostic, not a new WebGL execution or pixel-equivalence result.',
    'GPU Float32 projection, subpixel rasterization and the display-selected neighbor set can change the exact failure count.',
    'Removing the miter limit is not recommended: enormous triangles introduce clipping, precision and overdraw costs.',
    'A segment-quad repair must explicitly resolve translucent overlap; a second ordinary alpha-blended pass can increase opacity.',
  ],
}
await mkdir(directory, {recursive: true})
await writeFile(directory + '/report.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({directory, oracleValidation: report.oracleValidation, results: report.results, canonical: {expected: canonicalLimited.expected, limited: canonicalLimited.covered, unlimited: canonicalUnlimited.covered}}))
