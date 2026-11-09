import {SpecialtyChart, type SpecialtyOptions} from './specialty.js';
import {Color, ColorRGBA, DashedLine, LUT, SolidFill, SolidLine, emptyLine, resolveValue, type FillStyle, type LineStyle, type ValueOrMutator} from './core/styles.js';
import {applyLine, fillCSS, type UIPoint} from './ui.js';
import type {Rect} from './contracts.js';
import type {EventToken} from './core/events.js';
import {LinearGradientFill, canvasGradient} from './gradients.js';

export type MapProjection = 'mercator' | 'equirectangular';
export type GeoPosition = readonly [number, number, ...number[]];
export interface GeoJSONPolygon {type: 'Polygon'; coordinates: GeoPosition[][];}
export interface GeoJSONMultiPolygon {type: 'MultiPolygon'; coordinates: GeoPosition[][][];}
export interface GeoJSONFeature {type: 'Feature'; id?: string | number; properties: Record<string, unknown> | null; geometry: GeoJSONPolygon | GeoJSONMultiPolygon | null; [key: string]: unknown;}
export interface GeoJSONFeatureCollection {type: 'FeatureCollection'; features: GeoJSONFeature[]; [key: string]: unknown;}
export type MapRegionKey = string | ((feature: GeoJSONFeature, index: number) => string | number);
export interface MapOptions extends SpecialtyOptions {projection?: MapProjection; regionKey?: MapRegionKey;}
export interface MapBounds {minX: number; maxX: number; minY: number; maxY: number;}
export interface ProjectedMapPolygon {rings: UIPoint[][]; bounds: MapBounds; path?: Path2D;}
export interface MapView {projection: MapProjection; center: {longitude: number; latitude: number}; projectedCenter: UIPoint; zoom: number;}
export type MapPointInput = GeoPosition | {longitude: number; latitude: number; [key: string]: unknown} | {lon: number; lat: number; [key: string]: unknown} | {x: number; y: number; [key: string]: unknown};
export interface MapRegionClick {chart: MapChart; key: string; feature: GeoJSONFeature; value?: number; selected: boolean;}

const TAU = Math.PI * 2, MERCATOR_LIMIT = Math.atan(Math.sinh(Math.PI)) * 180 / Math.PI;
const insideRect = (rect: Rect, p: UIPoint) => p.x >= rect.left && p.x <= rect.left + rect.width && p.y >= rect.top && p.y <= rect.top + rect.height;
const normalizedLongitude = (longitude: number) => {const value = ((longitude + 180) % 360 + 360) % 360 - 180; return value === -180 && longitude > 0 ? 180 : value;};
const validProjection = (value: string): value is MapProjection => value === 'mercator' || value === 'equirectangular';
function validatePosition(position: GeoPosition): void {
  if (!Array.isArray(position) || position.length < 2 || !position.every(Number.isFinite) || position[1] < -90 || position[1] > 90) throw new RangeError('Geographic positions require finite longitude and latitude in [-90, 90]');
}

/** World width is one unit, with north at negative projected Y. Longitude may be unwrapped. */
export function projectMapPosition(position: GeoPosition, projection: MapProjection = 'mercator'): UIPoint {
  validatePosition(position); if (!validProjection(projection)) throw new TypeError('Unknown map projection');
  const latitude = Math.max(-MERCATOR_LIMIT, Math.min(MERCATOR_LIMIT, position[1]));
  return {x: position[0] / 360, y: projection === 'equirectangular' ? -position[1] / 360 : -Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360)) / TAU};
}
export function unprojectMapPosition(point: UIPoint, projection: MapProjection = 'mercator'): [number, number] {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !validProjection(projection)) throw new RangeError('Map coordinates and projection must be valid');
  return [point.x * 360, projection === 'equirectangular' ? -point.y * 360 : Math.atan(Math.sinh(-point.y * TAU)) * 180 / Math.PI];
}

function boundsOf(points: readonly UIPoint[]): MapBounds {
  const result = {minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity};
  for (const p of points) {result.minX = Math.min(result.minX, p.x); result.maxX = Math.max(result.maxX, p.x); result.minY = Math.min(result.minY, p.y); result.maxY = Math.max(result.maxY, p.y);}
  return result;
}
function shiftPolygon(polygon: ProjectedMapPolygon, amount: number): void {
  if (!amount) return; polygon.rings.forEach(ring => ring.forEach(point => {point.x += amount;})); polygon.bounds.minX += amount; polygon.bounds.maxX += amount; polygon.path = undefined;
}
function projectRoute(positions: readonly GeoPosition[], projection: MapProjection, preserveWorldBoundary = false): UIPoint[] {
  let previous: number | undefined;
  return positions.map(position => {
    validatePosition(position); let longitude = normalizedLongitude(position[0]);
    if (previous !== undefined && !preserveWorldBoundary) longitude += 360 * Math.round((previous - longitude) / 360);
    previous = longitude; return projectMapPosition([longitude, position[1]], projection);
  });
}

/** Short edges across ±180° are unwrapped; holes follow their exterior's world copy. */
export function projectMapPolygon(rings: readonly (readonly GeoPosition[])[], projection: MapProjection = 'mercator'): ProjectedMapPolygon {
  if (!Array.isArray(rings) || !rings.length || rings.some(ring => !Array.isArray(ring) || ring.length < 3)) throw new RangeError('Polygon rings require at least three geographic positions');
  const projected = rings.map((ring: readonly GeoPosition[]) => {
    ring.forEach(validatePosition);
    const worldBoundary = ring.some(p => p[0] === -180) && ring.some(p => p[0] === 180) && ring.every(p => Math.abs(p[0]) === 180);
    return projectRoute(ring, projection, worldBoundary);
  });
  const bounds = boundsOf(projected[0]), anchor = (bounds.minX + bounds.maxX) / 2;
  for (let i = 1; i < projected.length; i++) {const hole = boundsOf(projected[i]), shift = Math.round(anchor - (hole.minX + hole.maxX) / 2); projected[i].forEach(p => {p.x += shift;});}
  return {rings: projected, bounds};
}

function onSegment(p: UIPoint, a: UIPoint, b: UIPoint): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), tolerance = 1e-11;
  if (length < tolerance) return Math.hypot(p.x - a.x, p.y - a.y) < tolerance;
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) <= tolerance * length && p.x >= Math.min(a.x, b.x) - tolerance && p.x <= Math.max(a.x, b.x) + tolerance && p.y >= Math.min(a.y, b.y) - tolerance && p.y <= Math.max(a.y, b.y) + tolerance;
}
export function pointInMapRing(point: UIPoint, ring: readonly UIPoint[]): boolean {
  let inside = false;
  for (let i = 0, previous = ring.length - 1; i < ring.length; previous = i++) {
    const a = ring[previous], b = ring[i]; if (onSegment(point, a, b)) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < a.x + (point.y - a.y) * (b.x - a.x) / (b.y - a.y)) inside = !inside;
  }
  return inside;
}
/** Hole boundaries are excluded; exterior boundaries are included. Winding order is irrelevant. */
export function pointInMapPolygon(point: UIPoint, rings: readonly (readonly UIPoint[])[]): boolean {
  return !!rings.length && pointInMapRing(point, rings[0]) && !rings.slice(1).some(ring => pointInMapRing(point, ring));
}

function cloneJSON<T>(value: T, visiting = new WeakSet<object>(), depth = 0): T {
  if (value instanceof Color) return value; // Immutable colors are permitted in overlay metadata.
  if (value === null || typeof value !== 'object') {if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') throw new TypeError('GeoJSON properties must contain JSON values'); return value;}
  if (depth > 128 || visiting.has(value)) throw new TypeError('GeoJSON contains a cycle or excessive nesting');
  visiting.add(value); const copy: any = Array.isArray(value) ? [] : {};
  for (const [key, item] of Object.entries(value)) Object.defineProperty(copy, key, {value: cloneJSON(item, visiting, depth + 1), enumerable: true, configurable: true, writable: true});
  visiting.delete(value); return copy;
}
function copyCollection(data: GeoJSONFeatureCollection): GeoJSONFeatureCollection {
  if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new TypeError('Map data must be a GeoJSON FeatureCollection');
  const copy = cloneJSON(data);
  for (const feature of copy.features) {
    if (!feature || feature.type !== 'Feature' || feature.properties !== null && (typeof feature.properties !== 'object' || Array.isArray(feature.properties))) throw new TypeError('GeoJSON features require object or null properties');
    const geometry = feature.geometry;
    if (geometry !== null && (!geometry || geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) throw new TypeError('MapChart supports Polygon and MultiPolygon geometries');
    if (geometry && !Array.isArray(geometry.coordinates)) throw new TypeError('GeoJSON polygon coordinates must be arrays');
  }
  return copy;
}

interface Region {kind: 'region'; key: string; name: string; label: string; feature: GeoJSONFeature; polygons: ProjectedMapPolygon[];}
interface MapSample {position: [number, number]; source: MapPointInput; index: number;}
function copySample(input: MapPointInput, index: number): MapSample {
  const object = input as Record<string, unknown>, position = (Array.isArray(input) ? [input[0], input[1]] : 'longitude' in object ? [object.longitude, object.latitude] : 'lon' in object ? [object.lon, object.lat] : [object.x, object.y]) as [number, number];
  validatePosition(position); return {position, source: cloneJSON(input), index};
}

export class MapOverlay {
  name = ''; visible = true; disposed = false; revision = 0;
  protected samples: MapSample[] = []; private projectedCache?: {projection: MapProjection; revision: number; points: UIPoint[]};
  fill: FillStyle; stroke: LineStyle; pointSize = 8;
  constructor(readonly chart: MapChart, readonly kind: 'points' | 'line') {this.fill = new SolidFill({color: chart.theme.dataColors[1] ?? ColorRGBA(250, 166, 64)}); this.stroke = new SolidLine({fillStyle: this.fill, thickness: 2});}
  private assertAlive(): void {if (this.disposed || this.chart.disposed) throw new Error('Map overlay is disposed');}
  add(points: readonly MapPointInput[]): this {this.assertAlive(); const next = points.map((point, i) => copySample(point, this.samples.length + i)); for (const sample of next) this.samples.push(sample); this.revision++; this.chart.invalidate(); return this;}
  addPoints(points: readonly MapPointInput[]): this {return this.add(points);}
  setData(points: readonly MapPointInput[]): this {this.assertAlive(); const next = points.map(copySample); this.samples = next; this.revision++; this.chart.invalidate(); return this;}
  clear(): this {this.assertAlive(); this.samples = []; this.revision++; this.chart.invalidate(); return this;}
  getPoints(): MapPointInput[] {return this.samples.map(sample => cloneJSON(sample.source));}
  getSampleCount(): number {return this.samples.length;}
  setName(value: string): this {this.name = String(value); this.chart.invalidate(); return this;}
  getName(): string {return this.name;}
  setVisible(value: boolean): this {this.visible = value; this.chart.invalidate(); return this;}
  getVisible(): boolean {return this.visible;}
  setPointSize(value: number): this {if (!Number.isFinite(value) || value < 0) throw new RangeError('Map point size must be nonnegative and finite'); this.pointSize = value; this.chart.invalidate(); return this;}
  setPointFillStyle(value: ValueOrMutator<FillStyle>): this {this.fill = resolveValue(value, this.fill); this.chart.invalidate(); return this;}
  setFillStyle(value: ValueOrMutator<FillStyle>): this {return this.setPointFillStyle(value);}
  getFillStyle(): FillStyle {return this.fill;}
  setStrokeStyle(value: ValueOrMutator<LineStyle>): this {this.stroke = resolveValue(value, this.stroke); this.chart.invalidate(); return this;}
  getStrokeStyle(): LineStyle {return this.stroke;}
  /** Internal cached projected storage; original samples remain in geographic coordinates. */
  projected(projection: MapProjection): {samples: readonly MapSample[]; points: readonly UIPoint[]} {
    if (!this.projectedCache || this.projectedCache.projection !== projection || this.projectedCache.revision !== this.revision) {
      const positions = this.samples.map(sample => sample.position);
      this.projectedCache = {projection, revision: this.revision, points: this.kind === 'line' ? projectRoute(positions, projection) : positions.map(position => projectMapPosition([normalizedLongitude(position[0]), position[1]], projection))};
    }
    return {samples: this.samples, points: this.projectedCache.points};
  }
  dispose(): this {if (!this.disposed) {this.disposed = true; this.samples = []; this.projectedCache = undefined; this.chart.removeOverlay(this);} return this;}
  isDisposed(): boolean {return this.disposed;}
}
export class MapPointSeries extends MapOverlay {constructor(chart: MapChart) {super(chart, 'points'); this.stroke = emptyLine;}}
export class MapLineSeries extends MapOverlay {constructor(chart: MapChart) {super(chart, 'line');}}

export class MapChart extends SpecialtyChart {
  private projection: MapProjection;
  private regionKey?: MapRegionKey;
  private geoJSON: GeoJSONFeatureCollection = {type: 'FeatureCollection', features: []};
  private regions: Region[] = [];
  private values = new Map<string, number>(); private palette?: LUT;
  private regionFill: FillStyle = new SolidFill({color: ColorRGBA(69, 126, 153)});
  private regionStroke: LineStyle = new SolidLine({fillStyle: new SolidFill({color: ColorRGBA(185, 212, 222, 210)}), thickness: .8});
  private tooltipFormatter = (feature: GeoJSONFeature, value: number | undefined, key: string): string => `${String(feature.properties?.name ?? key)}${value === undefined ? '' : '\n' + Number(value.toPrecision(6)).toLocaleString('en-US')}`;
  private center = {x: 0, y: 0}; private zoom = 1; private fitBounds: MapBounds;
  private lastDrag?: UIPoint; private dragOrigin?: UIPoint; private dragMoved = false;
  private selectedRegion?: Region;
  private readonly overlays: MapOverlay[] = [];
  private readonly mapCleanup: Array<() => void> = [];

  constructor(options: MapOptions = {}) {
    if (options.projection && !validProjection(options.projection)) throw new TypeError('Unknown map projection');
    super(options); this.projection = options.projection ?? 'mercator'; this.regionKey = options.regionKey;
    this.fitBounds = this.worldBounds();
    if (this.canvas) {
      const down = () => {this.lastDrag = undefined; this.dragOrigin = undefined; this.dragMoved = false;};
      const end = () => {this.lastDrag = undefined; this.dragOrigin = undefined; this.dragging = false;};
      this.canvas.addEventListener('pointerdown', down, true); this.canvas.addEventListener('pointerup', end); this.canvas.addEventListener('pointercancel', end);
      this.mapCleanup.push(() => this.canvas!.removeEventListener('pointerdown', down, true), () => this.canvas!.removeEventListener('pointerup', end), () => this.canvas!.removeEventListener('pointercancel', end));
    }
  }

  private worldBounds(): MapBounds {return {minX: -.5, maxX: .5, minY: this.projection === 'mercator' ? -.5 : -.25, maxY: this.projection === 'mercator' ? .5 : .25};}
  private prepare(data: GeoJSONFeatureCollection, projection: MapProjection, key = this.regionKey): Region[] {
    const regions = data.features.map((feature, index): Region => {
      const id = typeof key === 'function' ? key(cloneJSON(feature), index) : key ? feature.properties?.[key] ?? feature.id ?? index : feature.id ?? feature.properties?.name ?? index;
      if (typeof id !== 'string' && typeof id !== 'number') throw new TypeError('Map region keys must be strings or numbers');
      const shape = feature.geometry, polygons = !shape ? [] : shape.type === 'Polygon' ? [projectMapPolygon(shape.coordinates, projection)] : shape.coordinates.map(rings => projectMapPolygon(rings, projection));
      return {kind: 'region', key: String(id), name: String(feature.properties?.name ?? id), label: this.tooltipFormatter(cloneJSON(feature), this.values.get(String(id)), String(id)), feature, polygons};
    });
    const polygons = regions.flatMap(region => region.polygons), centers = polygons.map(polygon => ((polygon.bounds.minX + polygon.bounds.maxX) / 2 % 1 + 1) % 1).sort((a, b) => a - b);
    if (centers.length) {
      let gap = -1, first = 0, last = 0;
      for (let i = 0; i < centers.length; i++) {const next = i + 1 < centers.length ? centers[i + 1] : centers[0] + 1, distance = next - centers[i]; if (distance > gap) {gap = distance; first = next; last = centers[i] + 1;}}
      let center = (first + last) / 2; center -= Math.floor(center + .5);
      polygons.forEach(polygon => shiftPolygon(polygon, Math.round(center - (polygon.bounds.minX + polygon.bounds.maxX) / 2)));
    }
    return regions;
  }

  setGeoJSON(data: GeoJSONFeatureCollection, options: {key?: MapRegionKey; fit?: boolean} = {}): this {
    const copy = copyCollection(data), key = options.key ?? this.regionKey, regions = this.prepare(copy, this.projection, key);
    this.geoJSON = copy; this.regions = regions; this.regionKey = key; this.selected = undefined; this.selectedRegion = undefined; this.hovered = undefined;
    if (options.fit !== false) this.fit(); else this.invalidate(); return this;
  }
  getGeoJSON(): GeoJSONFeatureCollection {return cloneJSON(this.geoJSON);}
  setRegionKey(key: MapRegionKey): this {return this.setGeoJSON(this.geoJSON, {key});}
  getRegionCount(): number {return this.regions.length;}
  /** Public geographic picking, independent of the previous rendered hit list. */
  getRegionAt(point: UIPoint): {key: string; feature: GeoJSONFeature; value?: number} | undefined {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !insideRect(this.plotRect(), point)) return undefined;
    const world = this.screenToWorld(point);
    for (let index = this.regions.length - 1; index >= 0; index--) {
      const region = this.regions[index];
      for (const polygon of region.polygons) {
        const x = world.x - Math.round(world.x - (polygon.bounds.minX + polygon.bounds.maxX) / 2);
        if (x >= polygon.bounds.minX && x <= polygon.bounds.maxX && world.y >= polygon.bounds.minY && world.y <= polygon.bounds.maxY && pointInMapPolygon({x, y: world.y}, polygon.rings)) return {key: region.key, feature: cloneJSON(region.feature), value: this.values.get(region.key)};
      }
    }
    return undefined;
  }
  getPlotRect(): Rect {return {...this.plotRect()};}
  getRegions(): Array<{key: string; name: string; value?: number; selected: boolean}> {return this.regions.map(region => ({key: region.key, name: region.name, value: this.values.get(region.key), selected: region.key === this.selectedRegion?.key}));}
  getRegionValue(key: string | number): number | undefined {return this.values.get(String(key));}
  setRegionValues(input: ReadonlyMap<string | number, number | null> | Record<string, number | null>, lut?: LUT): this {
    const values = new Map<string, number>(), entries = input instanceof Map ? input.entries() : Object.entries(input);
    let min = Infinity, max = -Infinity;
    for (const [key, value] of entries) {if (value === null || value === undefined) continue; if (!Number.isFinite(value)) throw new RangeError('Map region values must be finite or null'); values.set(String(key), value); min = Math.min(min, value); max = Math.max(max, value);}
    const labels = this.regions.map(region => this.tooltipFormatter(cloneJSON(region.feature), values.get(region.key), region.key));
    this.values = values; this.regions.forEach((region, index) => {region.label = labels[index];});
    this.palette = lut ?? (values.size ? new LUT({steps: [{value: min, color: ColorRGBA(50, 115, 172)}, {value: max === min ? min + 1 : max, color: ColorRGBA(255, 192, 70)}]}) : undefined);
    this.invalidate(); return this;
  }
  setRegionFillStyle(value: ValueOrMutator<FillStyle>): this {this.regionFill = resolveValue(value, this.regionFill); this.invalidate(); return this;}
  setRegionStrokeStyle(value: ValueOrMutator<LineStyle>): this {this.regionStroke = resolveValue(value, this.regionStroke); this.invalidate(); return this;}
  setTooltipFormatter(value: (feature: GeoJSONFeature, value: number | undefined, key: string) => string): this {const labels = this.regions.map(region => value(cloneJSON(region.feature), this.values.get(region.key), region.key)); this.tooltipFormatter = value; this.regions.forEach((region, index) => {region.label = labels[index];}); this.invalidate(); return this;}
  onRegionClick(listener: (event: MapRegionClick) => void): EventToken {return this.on('regionclick', listener);}
  getSelectedRegion(): string | undefined {return this.selectedRegion?.key;}
  setSelectedRegion(key: string | number | undefined): this {this.selectedRegion = key === undefined ? undefined : this.regions.find(region => region.key === String(key)); this.selected = this.selectedRegion; this.invalidate(); return this;}
  getProjection(): MapProjection {return this.projection;}
  setProjection(projection: MapProjection): this {
    if (!validProjection(projection)) throw new TypeError('Unknown map projection');
    const regions = this.prepare(this.geoJSON, projection); this.projection = projection; this.regions = regions; this.selectedRegion = undefined; this.selected = undefined; this.hovered = undefined; return this.fit();
  }

  private scale(rect = this.plotRect()): number {
    const width = Math.max(1e-5, this.fitBounds.maxX - this.fitBounds.minX), height = Math.max(1e-5, this.fitBounds.maxY - this.fitBounds.minY);
    return Math.max(1e-6, Math.min(rect.width / width, rect.height / height) * .92 * this.zoom);
  }
  private changedView(): this {this.events.emit('viewchange', this.getView()); this.invalidate(); return this;}
  fit(): this {
    const points: UIPoint[] = [];
    this.regions.forEach(region => region.polygons.forEach(polygon => {points.push({x: polygon.bounds.minX, y: polygon.bounds.minY}, {x: polygon.bounds.maxX, y: polygon.bounds.maxY});}));
    const anchor = points.length ? boundsOf(points) : undefined, centerX = anchor ? (anchor.minX + anchor.maxX) / 2 : undefined;
    this.overlays.filter(series => series.visible && !series.disposed).forEach(series => {const projected = series.projected(this.projection).points; projected.forEach(point => {points.push({x: centerX === undefined ? point.x : point.x + Math.round(centerX - point.x), y: point.y});});});
    if (!anchor && points.length) {
      const circular = points.map(point => ((point.x % 1) + 1) % 1).sort((a, b) => a - b);
      let gap = -1, middle = 0;
      for (let i = 0; i < circular.length; i++) {const next = i + 1 < circular.length ? circular[i + 1] : circular[0] + 1; if (next - circular[i] > gap) {gap = next - circular[i]; middle = (next + circular[i] + 1) / 2;}}
      middle -= Math.floor(middle + .5); points.forEach(point => {point.x += Math.round(middle - point.x);});
    }
    this.fitBounds = points.length ? boundsOf(points) : this.worldBounds();
    this.center = {x: (this.fitBounds.minX + this.fitBounds.maxX) / 2, y: (this.fitBounds.minY + this.fitBounds.maxY) / 2}; this.zoom = 1; return this.changedView();
  }
  getView(): MapView {const [longitude, latitude] = unprojectMapPosition(this.center, this.projection); return {projection: this.projection, center: {longitude, latitude}, projectedCenter: {...this.center}, zoom: this.zoom};}
  /** Fit an explicit geographic extent. A west > east interval crosses the date line. */
  setViewBounds(bounds: {west: number; south: number; east: number; north: number}): this {
    if (![bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite) || bounds.south >= bounds.north || bounds.south < -90 || bounds.north > 90) throw new RangeError('Map bounds require finite coordinates and south < north');
    const east = bounds.east < bounds.west ? bounds.east + 360 : bounds.east;
    if (east <= bounds.west || east - bounds.west > 360) throw new RangeError('Map bounds must span more than zero and at most 360 degrees longitude');
    const topLeft = projectMapPosition([bounds.west, bounds.north], this.projection), bottomRight = projectMapPosition([east, bounds.south], this.projection);
    this.fitBounds = {minX: topLeft.x, maxX: bottomRight.x, minY: topLeft.y, maxY: bottomRight.y};
    this.center = {x: (topLeft.x + bottomRight.x) / 2, y: (topLeft.y + bottomRight.y) / 2}; this.zoom = 1; return this.changedView();
  }
  setView(view: {center?: GeoPosition; zoom?: number}): this {
    if (view.zoom !== undefined && (!Number.isFinite(view.zoom) || view.zoom <= 0)) throw new RangeError('Map zoom must be positive and finite');
    const center = view.center ? projectMapPosition(view.center, this.projection) : this.center;
    this.center = {...center}; if (view.zoom !== undefined) this.zoom = Math.max(.25, Math.min(128, view.zoom)); return this.changedView();
  }
  private screenToWorld(point: UIPoint, rect = this.plotRect()): UIPoint {const scale = this.scale(rect); return {x: this.center.x + (point.x - rect.left - rect.width / 2) / scale, y: this.center.y + (point.y - rect.top - rect.height / 2) / scale};}
  private worldToScreen(point: UIPoint, rect = this.plotRect()): UIPoint {const scale = this.scale(rect); return {x: rect.left + rect.width / 2 + (point.x - this.center.x) * scale, y: rect.top + rect.height / 2 + (point.y - this.center.y) * scale};}
  positionToScreen(position: GeoPosition): UIPoint {const point = projectMapPosition(position, this.projection); point.x += Math.round(this.center.x - point.x); return this.worldToScreen(point);}
  screenToPosition(point: UIPoint): [number, number] {if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new RangeError('Map screen position must be finite'); return unprojectMapPosition(this.screenToWorld(point), this.projection);}
  zoomAt(point: UIPoint, factor: number): this {
    if (![point.x, point.y, factor].every(Number.isFinite) || factor <= 0) throw new RangeError('Map zoom anchor and factor must be finite and positive');
    const before = this.screenToWorld(point), next = Math.max(.25, Math.min(128, this.zoom * factor)); if (next === this.zoom) return this;
    this.zoom = next; const after = this.screenToWorld(point); this.center.x += before.x - after.x; this.center.y += before.y - after.y; return this.changedView();
  }
  panBy(dx: number, dy: number): this {if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new RangeError('Map pan distances must be finite'); const scale = this.scale(); this.center.x -= dx / scale; this.center.y -= dy / scale; return this.changedView();}
  protected override dragAt(point: UIPoint): void {
    if (!this.lastDrag) {this.lastDrag = {...point}; this.dragOrigin = {...point}; return;}
    if (this.dragOrigin && Math.hypot(point.x - this.dragOrigin.x, point.y - this.dragOrigin.y) > 3) this.dragMoved = true;
    if (this.dragMoved) this.panBy(point.x - this.lastDrag.x, point.y - this.lastDrag.y); this.lastDrag = {...point};
  }
  protected override wheel(delta: number): boolean {this.zoomAt(this.pointer, Math.exp(Math.max(-2, Math.min(2, -delta * .0015)))); return true;}
  protected override key(key: string): boolean {
    const rect = this.plotRect(), center = {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
    if (key === '+' || key === '=') this.zoomAt(center, 1.25); else if (key === '-') this.zoomAt(center, .8); else if (key === 'Home' || key === '0') this.fit();
    else if (key.startsWith('Arrow')) {const moves: Record<string, [number, number]> = {ArrowLeft: [35, 0], ArrowRight: [-35, 0], ArrowUp: [0, 35], ArrowDown: [0, -35]}; if (!moves[key]) return false; this.panBy(...moves[key]);} else return false;
    return true;
  }
  override activateAt(point: UIPoint): any {if (this.dragMoved) {this.dragMoved = false; return undefined;} return super.activateAt(point);}

  addPointSeries(): MapPointSeries {const series = new MapPointSeries(this); this.overlays.push(series); this.invalidate(); return series;}
  addLineSeries(): MapLineSeries {const series = new MapLineSeries(this); this.overlays.push(series); this.invalidate(); return series;}
  addPoints(data: readonly MapPointInput[]): MapPointSeries {return this.addPointSeries().add(data);}
  addLine(data: readonly MapPointInput[]): MapLineSeries {return this.addLineSeries().add(data);}
  removeOverlay(series: MapOverlay): void {const index = this.overlays.indexOf(series); if (index >= 0) this.overlays.splice(index, 1); this.invalidate();}
  override getSeries(): MapOverlay[] {return [...this.overlays];}
  private worldCopies(bounds: MapBounds, visible: MapBounds): number[] {
    if (bounds.maxY < visible.minY || bounds.minY > visible.maxY) return [];
    let first = Math.ceil(visible.minX - bounds.maxX), last = Math.floor(visible.maxX - bounds.minX);
    if (last - first > 8) {const nearest = Math.round(this.center.x - (bounds.minX + bounds.maxX) / 2); first = nearest - 4; last = nearest + 4;}
    return Array.from({length: Math.max(0, last - first + 1)}, (_, i) => first + i);
  }
  private path(polygon: ProjectedMapPolygon): Path2D | undefined {
    if (!polygon.path && typeof Path2D !== 'undefined') {const path = new Path2D(); polygon.rings.forEach(ring => {ring.forEach((p, i) => i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)); path.closePath();}); polygon.path = path;}
    return polygon.path;
  }
  protected renderPlot(ctx: CanvasRenderingContext2D, rect: Rect): void {
    const scale = this.scale(rect), origin = this.worldToScreen({x: 0, y: 0}, rect), topLeft = this.screenToWorld({x: rect.left, y: rect.top}, rect), bottomRight = this.screenToWorld({x: rect.left + rect.width, y: rect.top + rect.height}, rect);
    const visible = {minX: topLeft.x, maxX: bottomRight.x, minY: topLeft.y, maxY: bottomRight.y};
    const gradient = this.regionFill instanceof LinearGradientFill ? canvasGradient(ctx, this.regionFill, rect) : undefined;
    ctx.save(); ctx.beginPath(); ctx.rect(rect.left, rect.top, rect.width, rect.height); ctx.clip();
    for (const region of this.regions) {
      const value = this.values.get(region.key), paletteColor = value === undefined ? undefined : this.palette?.getColor(value), color = paletteColor ?? this.regionFill.getColor?.();
      const selected = this.selectedRegion?.key === region.key, hovered = this.hovered?.data === region;
      const paint = gradient && value === undefined && !selected && !hovered ? gradient : color ? (selected ? color.getLighter().getLighter() : hovered ? color.getLighter() : color).toCSS() : fillCSS(this.regionFill);
      const components: Array<{polygon: ProjectedMapPolygon; shift: number}> = [];
      for (const polygon of region.polygons) for (const shift of this.worldCopies(polygon.bounds, visible)) {
        components.push({polygon, shift}); const path = this.path(polygon);
        ctx.save(); ctx.translate(origin.x + shift * scale, origin.y); ctx.scale(scale, scale); ctx.fillStyle = paint;
        if (!path) {ctx.beginPath(); polygon.rings.forEach(ring => {ring.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();});}
        if (gradient && paint === gradient) {
          // Gradient coordinates are screen pixels. Clip in geographic coordinates,
          // then undo only the map transform before painting the shared gradient.
          ctx.save(); if (path) ctx.clip(path, 'evenodd'); else ctx.clip('evenodd');
          ctx.scale(1 / scale, 1 / scale); ctx.translate(-origin.x - shift * scale, -origin.y);
          ctx.fillStyle = gradient; ctx.fillRect(rect.left, rect.top, rect.width, rect.height); ctx.restore();
        } else if (path) ctx.fill(path, 'evenodd'); else ctx.fill('evenodd');
        const stroke = this.regionStroke;
        if (applyLine(ctx, stroke)) {ctx.lineWidth = (selected ? Math.max(2, stroke.getThickness()) : stroke.getThickness()) / scale; if (stroke instanceof DashedLine) ctx.setLineDash(stroke.pattern.map(value => value * stroke.patternScale / scale)); if (path) ctx.stroke(path); else ctx.stroke();}
        ctx.restore();
      }
      if (components.length) this.hits.push({data: region, label: region.label, contains: point => {
        if (!insideRect(rect, point)) return false; const world = this.screenToWorld(point, rect);
        return components.some(({polygon, shift}) => world.x - shift >= polygon.bounds.minX && world.x - shift <= polygon.bounds.maxX && world.y >= polygon.bounds.minY && world.y <= polygon.bounds.maxY && pointInMapPolygon({x: world.x - shift, y: world.y}, polygon.rings));
      }, activate: () => {this.selectedRegion = this.selected === region ? region : undefined; this.events.emit('regionclick', {chart: this, key: region.key, feature: cloneJSON(region.feature), value, selected: !!this.selectedRegion} satisfies MapRegionClick);}});
    }
    for (const series of this.overlays) if (series.visible && !series.disposed) this.drawOverlay(ctx, series, rect, visible);
    ctx.restore();
  }
  private drawOverlay(ctx: CanvasRenderingContext2D, series: MapOverlay, rect: Rect, visible: MapBounds): void {
    const data = series.projected(this.projection); if (!data.points.length) return;
    if (series.kind === 'points') {
      data.points.forEach((point, index) => {
        const sample = data.samples[index], record = sample.source as Record<string, any>, size = Number.isFinite(record.size) ? Math.max(0, record.size) : series.pointSize;
        if (!size) return; const bounds = {minX: point.x, maxX: point.x, minY: point.y, maxY: point.y};
        for (const shift of this.worldCopies(bounds, visible)) {
          const screen = this.worldToScreen({x: point.x + shift, y: point.y}, rect), radius = size / 2;
          ctx.beginPath(); ctx.arc(screen.x, screen.y, radius, 0, TAU); ctx.fillStyle = record.color instanceof Color ? record.color.toCSS() : typeof record.color === 'string' ? record.color : fillCSS(series.fill); ctx.fill(); if (applyLine(ctx, series.stroke)) ctx.stroke();
          this.hits.push({data: sample, label: `${record.name ?? series.name}${record.value === undefined ? '' : '\n' + record.value}\n${sample.position[0].toFixed(4)}, ${sample.position[1].toFixed(4)}`, contains: p => insideRect(rect, p) && Math.hypot(p.x - screen.x, p.y - screen.y) <= Math.max(5, radius), activate: () => this.events.emit('overlayclick', {chart: this, series, index, point: cloneJSON(sample.source)})});
        }
      });
    } else if (data.points.length > 1 && applyLine(ctx, series.stroke)) {
      const bounds = boundsOf(data.points);
      for (const shift of this.worldCopies(bounds, visible)) {
        const points = data.points.map(point => this.worldToScreen({x: point.x + shift, y: point.y}, rect)); ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.stroke();
        this.hits.push({data: series, label: series.name || 'Route', contains: point => insideRect(rect, point) && points.some((end, i) => i > 0 && distanceToSegment(point, points[i - 1], end) <= Math.max(4, series.stroke.getThickness() / 2)), activate: () => this.events.emit('overlayclick', {chart: this, series})});
      }
    }
  }
  override dispose(): this {if (!this.disposed) {this.mapCleanup.forEach(fn => fn()); [...this.overlays].forEach(series => series.dispose()); this.regions = []; this.geoJSON = {type: 'FeatureCollection', features: []}; this.values.clear(); this.selectedRegion = undefined; this.selected = undefined; this.hovered = undefined; this.hits = [];} return super.dispose();}
}

function distanceToSegment(p: UIPoint, a: UIPoint, b: UIPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y, squared = dx * dx + dy * dy, t = squared ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / squared)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
