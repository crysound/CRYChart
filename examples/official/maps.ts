import {ColorHEX, ColorRGBA, FontSettings, LUT, PalettedFill, SolidFill, SolidLine, transparentFill} from '../../src/core/styles.js';
import {DataSetXY} from '../../src/core/data.js';
import {LinearGradientFill} from '../../src/gradients.js';
import {MapChart, type GeoJSONFeatureCollection, type GeoJSONFeature, type GeoPosition} from '../../src/map.js';
import type {OfficialEntry, OfficialMountContext, OfficialMounted} from './types.js';
import worldJSON from '../data/world-countries.json';
import statesJSON from '../data/us-contiguous-states.json';
import populationJSON from '../data/world-bank-population.json';
import covidJSON from '../data/covid-history.json';
import zonesJSON from '../data/nordic-bidding-zones.json';
import routeJSON from '../data/dublin-air-view-route.json';
import roadsJSON from '../data/dublin-road-segments.json';

export const mapWorld = worldJSON as unknown as GeoJSONFeatureCollection;
export const mapStates = statesJSON as unknown as GeoJSONFeatureCollection;
export const mapZones = zonesJSON as unknown as GeoJSONFeatureCollection;
const population = populationJSON as {population2018: Record<string, number>; growth1961to2019: Record<string, Record<string, number>>};
export type CovidRow = [number, number | null, number | null, number | null, number | null];
export interface CovidCountry {name: string; continent: string; population: number | null; rows: CovidRow[];}
export const mapCovid = covidJSON as unknown as {dates: string[]; metrics: string[]; countries: Record<string, CovidCountry>};
export type AirMeasurement = [number, number, number, number];
export const mapAirRoute = routeJSON.rows as AirMeasurement[];
export const mapRoads = roadsJSON as Array<{name: string; class: string; points: [number, number][]}>;
const cream = '#f2f2c6', yellow = '#ffff45', red = '#ee3528', green = '#18f238';
const fill = (color: string) => new SolidFill({color: ColorHEX(color)});
const stroke = (color: string, thickness = 1) => new SolidLine({fillStyle: fill(color), thickness});
const background = 'radial-gradient(ellipse at 60% 30%,#2d2e2f 0%,#141515 64%,#050606 100%)';
const boundsByContinent: Record<string, {west: number; south: number; east: number; north: number}> = {
  Europe: {west: -26, south: 34, east: 46, north: 72}, 'North America': {west: -169, south: 7, east: -45, north: 77}, 'South America': {west: -88, south: -57, east: -32, north: 14},
  Africa: {west: -22, south: -36, east: 55, north: 38}, Asia: {west: 27, south: -12, east: 153, north: 76}, Oceania: {west: 110, south: -50, east: 180, north: 5},
};
const sourceGap = "本库场景的功能、交互和资源占用需在目标运行环境验证。";
const visualGap = "本库场景的功能、交互和资源占用需在目标运行环境验证。";
const dateText = (index: number) => {const [year, month, day] = mapCovid.dates[Math.max(0, Math.min(mapCovid.dates.length - 1, index))].split('-'); return `${Number(day)}.${Number(month)}.${year}`;};

export function populationGrowth(year: number, continent?: string): Record<string, number> {
  const allowed = new Set(mapWorld.features.filter(feature => !continent || feature.properties?.continent === continent).map(feature => String(feature.id)));
  return Object.fromEntries(Object.entries(population.growth1961to2019).filter(([code, values]) => allowed.has(code) && Number.isFinite(values[year])).map(([code, values]) => [code, values[year]]));
}
/** Latest reported metric at or before a date. Missing hospital/ICU values are not fabricated. */
export function covidMetric(code: string, index: number, metric: 0 | 1 | 2 | 3, maxAge = metric === 0 ? 45 : 7): number | undefined {
  const rows = mapCovid.countries[code]?.rows; if (!rows?.length) return undefined;
  let lo = 0, hi = rows.length; while (lo < hi) {const mid = (lo + hi) >>> 1; if (rows[mid][0] <= index) lo = mid + 1; else hi = mid;}
  for (let i = lo - 1; i >= 0 && index - rows[i][0] <= maxAge; i--) {const value = rows[i][metric + 1]; if (value !== null && Number.isFinite(value)) return value;}
  return undefined;
}
export function covidValues(index: number): Record<string, number> {return Object.fromEntries(mapWorld.features.map(feature => {const code = String(feature.id); return [code, covidMetric(code, index, 0)] as const;}).filter((entry): entry is readonly [string, number] => entry[1] !== undefined));}
export function covidHistory(code: string, metric: 0 | 1 | 2 | 3, start: number, end: number, actual = false): Array<{x: number; y: number}> {
  const country = mapCovid.countries[code], multiplier = !actual || !country?.population ? 1 : country.population / (metric === 0 ? 100 : 1e6);
  return Array.from({length: Math.max(0, end - start + 1)}, (_, offset) => {const index = start + offset, value = covidMetric(code, index, metric, metric === 0 ? 45 : 0); return {x: index, y: value === undefined ? NaN : value * multiplier};});
}
export function routeDistance(a: AirMeasurement, b: AirMeasurement): number {
  const rad = Math.PI / 180, lat = (b[2] - a[2]) * rad, lon = (b[1] - a[1]) * rad;
  const q = Math.sin(lat / 2) ** 2 + Math.cos(a[2] * rad) * Math.cos(b[2] * rad) * Math.sin(lon / 2) ** 2;
  return 6_371_008.8 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, q))));
}
export function airStatistics(rows: readonly AirMeasurement[]) {
  let sum = 0, peak = -Infinity, duration = 0, exposure = 0, distance = 0;
  rows.forEach((row, index) => {sum += row[3]; peak = Math.max(peak, row[3]); if (!index) return; const previous = rows[index - 1], delta = row[0] - previous[0]; if (delta > 0 && delta <= 3) {duration += delta; if (previous[3] > 15) exposure += delta; distance += routeDistance(previous, row);}});
  return {samples: rows.length, mean: rows.length ? sum / rows.length : 0, peak: rows.length ? peak : 0, observedSeconds: duration, exposureSeconds: exposure, exposurePercent: duration ? 100 * exposure / duration : 0, distanceMeters: distance};
}
export function temperatureFrame(target: Float32Array, columns: number, rows: number, time: number): Float32Array {
  if (target.length !== columns * rows) throw new RangeError('Temperature target dimensions do not match');
  const sinX = new Float32Array(columns), waveX = new Float32Array(columns), cosY = new Float32Array(rows);
  for (let x = 0; x < columns; x++) {sinX[x] = Math.sin(x / columns * 6.5 + time * .55); waveX[x] = Math.cos(x / columns * 13 - time * .21);}
  for (let y = 0; y < rows; y++) cosY[y] = Math.cos(y / rows * 4.2 + time * .13);
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {const noise = ((Math.imul(x + 1, 73856093) ^ Math.imul(y + 7, 19349663)) >>> 0) / 4294967296; target[y * columns + x] = Math.max(0, Math.min(100, 76 - y / rows * 40 + sinX[x] * 18 + cosY[y] * 12 + waveX[x] * cosY[y] * 6 + noise * 7));}
  return target;
}

function frame(context: OfficialMountContext): HTMLDivElement {const host = document.createElement('div'); host.style.cssText = `display:flex;flex-direction:column;position:relative;min-height:0;min-width:0;flex:1;width:100%;height:100%;background:${background};color:${cream};font:12px sans-serif`; context.host.append(host); return host;}
function cell(parent: HTMLElement, css = ''): HTMLDivElement {const node = document.createElement('div'); node.style.cssText = `position:relative;display:flex;min-width:0;min-height:0;${css}`; parent.append(node); return node;}
function caption(parent: HTMLElement, text: string) {const node = document.createElement('div'); node.textContent = text; node.style.cssText = 'font:18px sans-serif;text-align:center;padding:9px 4px 4px;flex:none'; parent.append(node); return node;}
function attribution(parent: HTMLElement, text: string) {const node = document.createElement('div'); node.textContent = text; node.style.cssText = 'position:absolute;left:6px;bottom:3px;font:9px sans-serif;color:#c0c0ac;pointer-events:none;z-index:6;background:#090a0bb8;padding:2px 4px'; parent.append(node);}
function button(parent: HTMLElement, text: string, control: string, click: () => void) {const node = document.createElement('button'); node.textContent = text; node.dataset.control = control; node.style.cssText = 'background:#142630;border:1px solid #7695a0;color:#f4f4d2;padding:5px 9px;border-radius:3px;cursor:pointer'; node.addEventListener('click', click); parent.append(node); return node;}
function range(parent: HTMLElement, min: number, max: number, value: number, control: string, change: (value: number) => void) {const node = document.createElement('input'); node.type = 'range'; node.min = String(min); node.max = String(max); node.step = '1'; node.value = String(value); node.dataset.control = control; node.setAttribute('aria-label', control); node.style.cssText = 'flex:1;min-width:65px;accent-color:#078bff'; node.addEventListener('input', () => change(Number(node.value))); parent.append(node); return node;}
function map(context: OfficialMountContext, container: HTMLElement, title: string, data = mapWorld, projection: 'mercator' | 'equirectangular' = 'equirectangular'): MapChart {
  return context.engine.MapChart({container, theme: {...context.theme, textColor: ColorHEX(cream)}, projection}).setTitle(title).setTitleFont(new FontSettings({size: 18, weight: 400})).setTitleAlignment('center').setPadding(7).setBackgroundFillStyle(transparentFill).setGeoJSON(data).setRegionStrokeStyle(stroke('#222427', .7));
}
function xy(context: OfficialMountContext, container: HTMLElement, title: string, small = false): any {
  return context.engine.ChartXY({container, theme: context.theme}).setTitle(title).setTitleFont(new FontSettings({size: small ? 11 : 16, weight: 400})).setPadding({left: small ? -23 : -6, right: small ? -23 : -3, top: small ? -22 : -13, bottom: small ? -16 : -1}).setBackgroundFillStyle(transparentFill);
}
function dateAxis(chart: any, start: number, end: number) {chart.getDefaultAxisX().setInterval({start, end}).setTickStrategy('numeric', (strategy: any) => strategy.setMajorTickPlacement(() => Array.from({length: 5}, (_, index) => {const position = Math.round(start + (end - start) * index / 4); return {position, label: mapCovid.dates[position]?.slice(0, 7) ?? ''};})));}
function legend(parent: HTMLElement, title: string, colors: string[], values: string[], horizontal = false): HTMLDivElement {
  const host = document.createElement('div'); host.style.cssText = `display:flex;flex-direction:column;justify-content:center;gap:7px;flex:none;padding:8px;${horizontal ? 'align-items:center' : 'width:110px;align-items:center'}`;
  const label = document.createElement('div'); label.textContent = title; label.style.cssText = 'font-size:12px;text-align:center';
  const body = document.createElement('div'); body.style.cssText = `display:flex;gap:8px;${horizontal ? 'flex-direction:column' : 'align-items:stretch'}`;
  const bar = document.createElement('div'); bar.style.cssText = `border-radius:5px;background:linear-gradient(${horizontal ? 'to right' : 'to top'},${colors.join(',')});${horizontal ? 'width:190px;height:15px' : 'width:22px;height:165px'}`;
  const ticks = document.createElement('div'); ticks.style.cssText = `display:flex;justify-content:space-between;${horizontal ? 'width:190px' : 'height:165px;flex-direction:column-reverse'}`;
  for (const value of values) {const item = document.createElement('span'); item.textContent = value; ticks.append(item);} body.append(bar, ticks); host.append(label, body); parent.append(host); return host;
}
const gold = () => new LinearGradientFill({angle: 135, stops: [{offset: 0, color: ColorHEX('#ffff72')}, {offset: .52, color: ColorHEX('#eedb51')}, {offset: 1, color: ColorHEX('#e29b37')}]});
const vaccinePalette = () => new LUT({steps: [{value: 0, color: ColorHEX(red)}, {value: 50, color: ColorHEX('#f0d52a')}, {value: 100, color: ColorHEX(green)}]});
function regionSnapshot(chart: MapChart, probeCodes = ['USA', 'DEU', 'POL', 'BRA']) {return {regions: chart.getRegionCount(), view: chart.getView(), selected: chart.getSelectedRegion(), probes: probeCodes.flatMap(key => {const feature = mapWorld.features.find(feature => feature.id === key); return feature?.properties?.label ? [{key, pixel: chart.positionToScreen(feature.properties.label as GeoPosition), value: chart.getRegionValue(key)}] : [];})};}

function mountWorld(context: OfficialMountContext): OfficialMounted {
  const wrapper = frame(context), chart = map(context, wrapper, 'MapChart').setRegionFillStyle(gold()).setViewBounds({west: -180, east: 180, south: -90, north: 84});
  attribution(wrapper, 'Natural Earth · public domain');
  return {charts: [chart], dispose: () => wrapper.remove(), snapshot: () => ({...regionSnapshot(chart, ['USA', 'DEU', 'POL', 'BRA', 'CAN', 'AUS']), geometrySource: 'Natural Earth 1:50m', dataProvenance: {kind: 'public-geographic-data', source: 'Natural Earth public domain', polygonsPreserved: true}})};
}
function mountPopulation(context: OfficialMountContext): OfficialMounted {
  const wrapper = frame(context), row = cell(wrapper, 'flex:1'), host = cell(row, 'flex:1'), chart = map(context, host, 'Population by country (2018)').setViewBounds(boundsByContinent.Europe).setRegionFillStyle(fill('#eeeeee'));
  const codes = new Set(mapWorld.features.filter(feature => feature.properties?.continent === 'Europe' && feature.id !== 'RUS').map(feature => String(feature.id)));
  const values = Object.fromEntries(Object.entries(population.population2018).filter(([code]) => codes.has(code)));
  chart.setRegionValues(values, new LUT({steps: [{value: 5e6, color: ColorHEX(green)}, {value: 53e6, color: ColorHEX('#ffff00')}, {value: 100e6, color: ColorHEX('#ff2500')}]})).setTooltipFormatter((feature, value) => `${feature.properties?.name}\nPopulation ${value === undefined ? 'no data' : (value / 1e6).toFixed(1) + ' million'}`);
  legend(row, 'Population', [green, '#ffff00', '#ff2500'], ['5 Million', '53 Million', '100 Million']); attribution(wrapper, 'Natural Earth · World Bank WDI, 2018 · CC BY 4.0');
  return {charts: [chart], dispose: () => wrapper.remove(), snapshot: () => ({...regionSnapshot(chart, ['POL', 'FRA', 'DEU']), populatedRegions: Object.keys(values).length, population2018: values, dataProvenance: {kind: 'public-historical-data', sources: ['Natural Earth', 'World Bank SP.POP.TOTL 2018'], missingPopulationColor: 'white'}})};
}
function mountPopulationTimeline(context: OfficialMountContext): OfficialMounted {
  const wrapper = frame(context); caption(wrapper, 'Population change (% / year)');
  const grid = cell(wrapper, 'flex:1;display:grid;grid-template-columns:1fr 1fr 1fr;grid-template-rows:1fr 1fr;gap:5px'), continents = ['North America', 'South America', 'Europe'];
  const maps = continents.map((continent, index) => {const panel = cell(grid, `flex-direction:column;${index === 2 ? 'grid-column:1 / 4' : ''}`), host = cell(panel, 'flex:1'); legend(panel, continent, ['#19bf62', '#7d7d7d', '#f12a2a'], ['−5%', '0%', '+5%'], true); return map(context, host, '', {type: 'FeatureCollection', features: mapWorld.features.filter(feature => feature.properties?.continent === continent)}).setViewBounds(boundsByContinent[continent]).setRegionFillStyle(fill('#777777')).setTooltipFormatter((feature, value) => `${feature.properties?.name}\n${value === undefined ? 'No data' : value.toFixed(2) + '% / year'}`);});
  const controls = cell(grid, 'grid-column:3;grid-row:1;flex-direction:column;align-items:center;justify-content:center;gap:22px'); let year = 1965, playing = true, accumulator = 0;
  const palette = new LUT({steps: [{value: -5, color: ColorHEX('#19bf62')}, {value: 0, color: ColorHEX('#777777')}, {value: 5, color: ColorHEX('#f12a2a')}]});
  const toggle = button(controls, String(year), 'population-play', () => {playing = !playing; toggle.dataset.playing = String(playing);}); toggle.style.cssText += ';font-size:28px;background:#0783c7;padding:18px 24px';
  const slider = range(controls, 1961, 2019, year, 'population-year', value => {playing = false; setYear(value);}); slider.style.cssText += ';flex:none;width:90%';
  function setYear(value: number) {year = Math.max(1961, Math.min(2019, Math.round(value))); toggle.textContent = String(year); toggle.dataset.playing = String(playing); slider.value = String(year); maps.forEach((chart, index) => chart.setRegionValues(populationGrowth(year, continents[index]), palette));}
  setYear(year); attribution(wrapper, 'Natural Earth · World Bank SP.POP.GROW, 1961–2019 · CC BY 4.0');
  return {charts: maps, update: (_time, delta) => {if (!playing) return; accumulator += delta; if (accumulator >= .8) {accumulator %= .8; setYear(year >= 2019 ? 1961 : year + 1);}}, dispose: () => wrapper.remove(), snapshot: () => ({year, playing, maps: maps.map((chart, index) => ({continent: continents[index], ...regionSnapshot(chart), valueCount: Object.keys(populationGrowth(year, continents[index])).length})), dataProvenance: {kind: 'public-historical-data', source: 'World Bank annual population growth', firstYear: 1961, lastYear: 2019}})};
}
function vaccinePoints(index: number) {return mapWorld.features.flatMap(feature => {const code = String(feature.id), percentage = covidMetric(code, index, 0), position = feature.properties?.label as [number, number] | undefined; if (!position || percentage === undefined) return []; return [{longitude: position[0], latitude: position[1], name: String(feature.properties?.name), value: `${percentage.toFixed(2)}% vaccinated`, percentage, code, size: 5 + Math.sqrt(Math.max(0, percentage)) * 2.6, color: vaccinePalette().getColor(percentage)}];});}
function mountVaccinations(context: OfficialMountContext): OfficialMounted {
  const wrapper = frame(context), title = caption(wrapper, ''), row = cell(wrapper, 'flex:1'), host = cell(row, 'flex:1'), chart = map(context, host, '').setRegionFillStyle(gold()).setViewBounds({west: -180, east: 180, south: -58, north: 84}), points = chart.addPointSeries().setName('Vaccination coverage').setStrokeStyle(stroke('#292a2b', .5));
  const worldwide = document.createElement('div'); worldwide.style.cssText = 'position:absolute;left:15px;top:8px;font-size:15px;z-index:2'; host.append(worldwide); legend(row, 'Vaccination coverage', [red, '#f0d52a', green], ['0%', '50%', '100%']);
  const controls = cell(wrapper, 'height:35px;align-items:center;padding:0 12px 17px;gap:14px'); let index = mapCovid.dates.indexOf('2021-01-27'), playing = true, accumulator = 0, pointCount = 0;
  const toggle = button(controls, 'Pause', 'vaccination-play', () => {playing = !playing; toggle.textContent = playing ? 'Pause' : 'Play';});
  const slider = range(controls, 0, mapCovid.dates.length - 1, index, 'vaccination-date', value => {playing = false; toggle.textContent = 'Play'; setDate(value);});
  function setDate(value: number) {index = Math.max(0, Math.min(mapCovid.dates.length - 1, Math.round(value))); slider.value = String(index); title.textContent = `Population vaccinated · ${dateText(index)}`; const valueGlobal = covidMetric('OWID_WRL', index, 0); worldwide.textContent = `${valueGlobal === undefined ? 'No data' : valueGlobal.toFixed(2) + '%'} of world population received at least 1 vaccine`; const data = vaccinePoints(index); pointCount = data.length; points.setData(data);}
  setDate(index); attribution(wrapper, 'Natural Earth · Our World in Data / Mathieu et al., 2021 · CC BY 4.0');
  return {charts: [chart], update: (_time, delta) => {if (!playing) return; accumulator += delta; if (accumulator > .12) {accumulator %= .12; setDate(index + 1 >= mapCovid.dates.length ? 0 : index + 1);}}, dispose: () => wrapper.remove(), snapshot: () => ({date: mapCovid.dates[index], dateIndex: index, playing, pointCount, worldVaccinated: covidMetric('OWID_WRL', index, 0), ...regionSnapshot(chart), points: points.getPoints().slice(0, 4), dataProvenance: {kind: 'public-historical-data', source: 'OWID historical vaccinations; latest prior observation within 45 days', geographicPositions: 'Natural Earth country label coordinates'}})};
}

function mountTemperature(context: OfficialMountContext): OfficialMounted {
  const wrapper = frame(context), host = cell(wrapper, 'flex:1'), chart = xy(context, host, 'Animated United States Temperature Heatmap');
  const columns = 500, rows = 400, data = new Float32Array(columns * rows), geographicBounds = {west: -126, east: -65, south: 24, north: 49};
  chart.getDefaultAxisX().setTitle('Longitude').setInterval({start: geographicBounds.west, end: geographicBounds.east}); chart.getDefaultAxisY().setTitle('Latitude').setInterval({start: geographicBounds.south, end: geographicBounds.north});
  const heat = chart.addHeatmapGridSeries({dataOrder: 'rows', columns, rows, start: {x: geographicBounds.west, y: geographicBounds.south}, step: {x: (geographicBounds.east - geographicBounds.west) / columns, y: (geographicBounds.north - geographicBounds.south) / rows}}).setName('Heatmap Grid Series');
  const borders = mapStates.features.flatMap(feature => {const geometry = feature.geometry!; const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates; return polygons.flatMap(polygon => polygon.flatMap(ring => [...ring.map(point => ({x: point[0], y: point[1]})), {x: NaN, y: NaN}]));});
  const boundaries = chart.addLineSeries().setName('Natural Earth state boundaries').setStrokeStyle(stroke('#ecefc3', .9)).setCursorEnabled(false).add(borders);
  const controls = cell(wrapper, 'height:82px;flex:none;box-sizing:border-box;align-items:center;padding:0 10px 19px;gap:12px'), label = document.createElement('label'); label.textContent = 'Heatmap transparency'; controls.append(label); let alpha = .7, time = 0, frames = 0;
  function setAlpha(value: number) {alpha = 1 - value / 100; const colors = ['#1015a0', '#15899d', '#a9aa21', '#b62606']; heat.setFillStyle(new PalettedFill({lut: new LUT({steps: colors.map((color, index) => ({value: index * 100 / 3, color: ColorHEX(color).setA(alpha * 255)})), units: 'intensity'})}));}
  const slider = range(controls, 0, 100, 30, 'temperature-transparency', setAlpha); slider.style.maxWidth = '190px';
  legend(controls, 'Heatmap Grid Series', ['#1015a0', '#15899d', '#a9aa21', '#b62606'], ['0', '33', '67', '100 intensity'], true); setAlpha(30); heat.invalidateIntensityValues(temperatureFrame(data, columns, rows, 0));
  attribution(wrapper, 'Natural Earth state geometry · original animated intensity field · equirectangular longitude/latitude');
  return {charts: [chart], update: (elapsed, delta) => {time += delta; if (time >= 1 / 30) {time %= 1 / 30; heat.invalidateIntensityValues(temperatureFrame(data, columns, rows, elapsed)); frames++;}}, dispose: () => wrapper.remove(), snapshot: () => ({columns, rows, sampleCount: data.length, frames, alpha, temperature: [data[0], data[999], data[data.length - 1]], boundarySamples: boundaries.getSampleCount(), geographicBounds, projection: 'equirectangular', registration: 'one longitude/latitude coordinate system for both grid cells and state outlines', dataProvenance: {kind: 'mixed-public-and-independent', geometry: 'Natural Earth', intensities: 'original trigonometric spatial field, not weather measurements', updateRateLimitHz: 30}})};
}

function mountCovidDashboard(context: OfficialMountContext): OfficialMounted {
  const wrapper = frame(context), toolbar = cell(wrapper, 'height:35px;align-items:center;gap:12px;padding:0 10px'), levelLabel = document.createElement('span');
  let level: 'world' | 'continent' | 'country' = 'world', continent = '', countryCode = 'DEU', currentIndex = mapCovid.dates.length - 1, actual = false, hoverCode: string | undefined;
  const back = button(toolbar, 'Zoom out', 'covid-back', () => navigateBack()); back.hidden = true; levelLabel.textContent = 'Left click to drill down at mouse location'; toolbar.append(levelLabel);
  const mapHost = cell(wrapper, 'flex:1;min-height:130px'), world = map(context, mapHost, '').setRegionFillStyle(fill('#444848')).setViewBounds({west: -180, east: 180, south: -58, north: 84}), bubbles = world.addPointSeries().setName('New daily cases').setPointFillStyle(fill('#f8f4a38a')).setStrokeStyle(stroke('#111414', .4));
  const historyHost = cell(wrapper, 'height:26%;min-height:120px'), history = xy(context, historyHost, '', true).setMouseInteractions(false), right = history.addAxisY({opposite: true}).setTitle('Vaccinated once (%)').setInterval({start: 0, end: 100});
  const globalCases = history.addLineSeries().setName('World new daily cases (7-day average)').setStrokeStyle(stroke(yellow, 1.5)).add(covidHistory('OWID_WRL', 1, 0, currentIndex, true));
  history.addLineSeries({axisY: right}).setName('World vaccinated once (%)').setStrokeStyle(stroke('#bece76', 1.5)).add(covidHistory('OWID_WRL', 0, 0, currentIndex));
  history.getDefaultAxisY().setTitle('New daily cases'); dateAxis(history, 0, currentIndex); const marker = history.getDefaultAxisX().addConstantLine().setValue(currentIndex).setStrokeStyle(stroke('#b3ddd9', 1));
  const controls = cell(wrapper, 'height:28px;align-items:center;padding:0 10px 13px;gap:9px'), date = document.createElement('span'); date.style.width = '95px'; controls.append(date);
  const slider = range(controls, 0, currentIndex, currentIndex, 'covid-date', value => setDate(value));
  const detail = cell(wrapper, 'display:none;position:absolute;inset:37px 0 19px;background:#111213;z-index:8;flex-direction:column');
  const detailTop = cell(detail, 'height:28px;align-items:center;justify-content:space-between;padding:0 10px'), detailName = document.createElement('span'); detailTop.append(detailName);
  const actualButton = button(detailTop, 'Show actual values', 'covid-actual', () => {actual = !actual; actualButton.textContent = actual ? 'Show relative values' : 'Show actual values'; refreshDetail();});
  const titles = ['Vaccination rate (at least 1 vaccine)', 'New cases (relative to population)', 'Hospital patients (relative to population)', 'Intensive care patients (relative to population)'];
  const panels = titles.map(title => {const host = cell(detail, 'flex:1;border-top:1px solid #555;min-height:75px'), chart = xy(context, host, title, true).setPadding({left: 18, right: 27, top: -22, bottom: -17}), selected = chart.addLineSeries().setName('Selected country').setStrokeStyle(stroke(yellow, 1.5)), global = chart.addLineSeries().setName('World average').setStrokeStyle(stroke('#c5c44077', 1.2)); return {host, chart, selected, global};});
  const popup = cell(mapHost, 'display:none;position:absolute;right:8px;top:14px;width:310px;height:190px;z-index:7;pointer-events:none;background:#151719f5;border:1px solid #a6a792;border-radius:5px;flex-direction:column');
  const popupName = document.createElement('div'); popupName.style.cssText = 'padding:4px 8px'; popup.append(popupName);
  const popupHost = cell(popup, 'flex:1'), popupChart = xy(context, popupHost, 'Previous four weeks', true), popupAxis = popupChart.addAxisY({opposite: true}).setTitle('per million');
  const popupSeries = [popupChart.addLineSeries().setName('Vaccinated %').setStrokeStyle(stroke(yellow, 1.4)), ...['#ff9c45', '#50a9e8', '#b27adc'].map((color, metric) => popupChart.addLineSeries({axisY: popupAxis}).setName(['New cases', 'Hospital', 'ICU'][metric]).setStrokeStyle(stroke(color, 1.1)))];
  popupChart.getDefaultAxisY().setTitle('Vaccinated %').setInterval({start: 0, end: 100});
  function refreshPopup(code: string) {
    hoverCode = code; popup.style.display = 'flex'; const record = mapCovid.countries[code]; popupName.textContent = `${record?.name ?? code} · ${dateText(currentIndex)}`;
    const start = Math.max(0, currentIndex - 27); popupSeries.forEach((series, metric) => series.clear().add(covidHistory(code, metric as 0 | 1 | 2 | 3, start, currentIndex)));
    dateAxis(popupChart, start, Math.max(start + 1, currentIndex));
  }
  function refreshDetail() {
    detailName.textContent = mapCovid.countries[countryCode]?.name ?? countryCode;
    panels.forEach((panel, metric) => {
      panel.selected.setName(detailName.textContent).clear().add(covidHistory(countryCode, metric as 0 | 1 | 2 | 3, 0, currentIndex, actual));
      panel.global.clear().add(covidHistory('OWID_WRL', metric as 0 | 1 | 2 | 3, 0, currentIndex, actual));
      panel.chart.getDefaultAxisY().setTitle('');
      panel.chart.setTitle(actual ? ['People vaccinated', 'New cases (7-day average)', 'Hospital patients', 'Intensive care patients'][metric] : titles[metric]);
      if (!actual && metric === 0) panel.chart.getDefaultAxisY().setInterval({start: 0, end: 100}); else panel.chart.getDefaultAxisY().setScrollStrategy('fitting');
      dateAxis(panel.chart, 0, Math.max(1, currentIndex));
    });
  }
  function setDate(value: number) {
    currentIndex = Math.max(0, Math.min(mapCovid.dates.length - 1, Math.round(value))); slider.value = String(currentIndex); date.textContent = dateText(currentIndex); marker.setValue(currentIndex);
    world.setTitle(`CoVID vaccinations & new cases | ${dateText(currentIndex)}`).setRegionValues(covidValues(currentIndex), vaccinePalette());
    bubbles.setData(mapWorld.features.flatMap(feature => {const code = String(feature.id), value = covidMetric(code, currentIndex, 1), label = feature.properties?.label as [number, number]; return value === undefined || !label || value <= 0 ? [] : [{longitude: label[0], latitude: label[1], name: String(feature.properties?.name), value: `${value.toFixed(1)} new cases / million (7-day avg)`, code, size: Math.min(35, 2 + Math.sqrt(value) * .48)}];}));
    if (hoverCode) refreshPopup(hoverCode); if (level === 'country') refreshDetail();
  }
  function pickCountry(code: string) {
    const feature = mapWorld.features.find(feature => feature.id === code); if (!feature || !mapCovid.countries[code]) return;
    countryCode = code; popup.style.display = 'none'; hoverCode = undefined;
    if (level === 'world') {continent = String(feature.properties?.continent); level = 'continent'; const bounds = boundsByContinent[continent]; if (bounds) world.setViewBounds(bounds); levelLabel.textContent = `${continent} · click a country for full history`;}
    else {level = 'country'; detail.style.display = 'flex'; for (const host of [mapHost, historyHost, controls]) host.style.visibility = 'hidden'; levelLabel.textContent = `${mapCovid.countries[code].name} · double click to zoom out`; refreshDetail();}
    back.hidden = false;
  }
  function navigateBack() {
    if (level === 'country') {level = 'continent'; detail.style.display = 'none'; for (const host of [mapHost, historyHost, controls]) host.style.visibility = 'visible'; levelLabel.textContent = `${continent} · click a country for full history`;}
    else {level = 'world'; continent = ''; world.setViewBounds({west: -180, east: 180, south: -58, north: 84}); back.hidden = true; levelLabel.textContent = 'Left click to drill down at mouse location';}
  }
  const regionToken = world.onRegionClick(event => pickCountry(event.key));
  const bubbleToken = world.on('overlayclick', event => {if (event.point?.code) pickCountry(event.point.code);});
  const hoverToken = world.on('pointermove', event => {if (level === 'country') return; const picked = world.getRegionAt(event.position); const code = picked?.key ?? event.item?.source?.code; if (code && mapCovid.countries[code] && code !== hoverCode) refreshPopup(code); else if (!code) {popup.style.display = 'none'; hoverCode = undefined;}});
  const events = new AbortController(); wrapper.addEventListener('dblclick', event => {if ((event.target as HTMLElement).tagName === 'BUTTON') return; navigateBack();}, {signal: events.signal});
  world.canvas?.addEventListener('pointerleave', () => {popup.style.display = 'none'; hoverCode = undefined;}, {signal: events.signal});
  const scrub = (event: PointerEvent) => {if (event.type !== 'pointerdown' && !event.buttons) return; const box = history.overlay.getBoundingClientRect(), fraction = (event.clientX - box.left - history.plot.left) / history.plot.width; setDate(Math.round(Math.max(0, Math.min(1, fraction)) * (mapCovid.dates.length - 1)));};
  history.overlay?.addEventListener('pointerdown', scrub, {signal: events.signal}); history.overlay?.addEventListener('pointermove', scrub, {signal: events.signal}); setDate(currentIndex);
  attribution(wrapper, 'Natural Earth · Our World in Data · missing health metrics remain missing');
  return {charts: [world, history, ...panels.map(panel => panel.chart), popupChart], dispose: () => {world.off(regionToken); world.off(bubbleToken); world.off(hoverToken); events.abort(); wrapper.remove();}, snapshot: () => ({dateIndex: currentIndex, date: mapCovid.dates[currentIndex], level, continent, country: countryCode, actual, hoverCode, popupVisible: popup.style.display !== 'none', caseHistorySamples: globalCases.getSampleCount(), detailSamples: panels.map(panel => panel.selected.getSampleCount()), values: [0, 1, 2, 3].map(metric => covidMetric(countryCode, currentIndex, metric as 0 | 1 | 2 | 3)), ...regionSnapshot(world), dataProvenance: {kind: 'public-historical-data', source: 'OWID daily historical records; cases are 7-day-smoothed per million', missingDataPolicy: 'null stays absent; no interpolation of hospital/ICU gaps'}})};
}

export const energySources = [
  {name: 'Biomass', color: '#419f3e', renewable: true}, {name: 'Energy Storage', color: '#e3135b', renewable: false}, {name: 'Hydro Pumped Storage', color: '#006a63', renewable: false},
  {name: 'Hydro Run-Of-River And Poundage', color: '#00b89b', renewable: true}, {name: 'Hydro Water Reservoir', color: '#008c8d', renewable: true}, {name: 'Nuclear', color: '#ff4a0a', renewable: false},
  {name: 'Other', color: '#8a9b9c', renewable: false}, {name: 'Other Renewable', color: '#92c738', renewable: true}, {name: 'Solar', color: '#ffd000', renewable: true},
  {name: 'Waste', color: '#8c37bd', renewable: false}, {name: 'Wind Offshore', color: '#159bf1', renewable: true}, {name: 'Wind Onshore', color: '#00c5db', renewable: true}, {name: 'Fossil Fuels', color: '#525dbb', renewable: false},
];
/** Scalars transcribed from the visible sidebar, not an underlying vendor data payload. */
export const energyZoneFacts = [
  {code: 'FI', volume: 309, renewable: 52, price: 128, center: [27, 64]}, {code: 'SE3', volume: 252, renewable: 25, price: 122, center: [15, 59.4]}, {code: 'NO2', volume: 221, renewable: 100, price: 91, center: [7, 58.7]},
  {code: 'SE2', volume: 185, renewable: 98, price: 109, center: [17, 63.2]}, {code: 'NO5', volume: 133, renewable: 100, price: 95, center: [5.9, 61.1]}, {code: 'DK1', volume: 106, renewable: 84, price: 90, center: [9, 56.1]},
  {code: 'NO4', volume: 104, renewable: 97, price: 34, center: [18, 68]}, {code: 'SE1', volume: 101, renewable: 100, price: 100, center: [21, 67]}, {code: 'NO3', volume: 100, renewable: 100, price: 116, center: [10.2, 64]},
  {code: 'NO1', volume: 58, renewable: 99, price: 125, center: [10.3, 60.8]}, {code: 'DK2', volume: 31, renewable: 77, price: 114, center: [12, 55.5]}, {code: 'LV', volume: 26, renewable: 21, price: 233, center: [25, 57]},
  {code: 'LT', volume: 24, renewable: 22, price: 233, center: [24, 55.3]}, {code: 'SE4', volume: 23, renewable: 68, price: 134, center: [14.5, 56.6]}, {code: 'EE', volume: 19, renewable: 19, price: 223, center: [26, 58.7]},
] as const;
export function energyProfile(code: string) {
  const zoneIndex = energyZoneFacts.findIndex(zone => zone.code === code), zone = energyZoneFacts[zoneIndex]; if (!zone) throw new RangeError('Unknown bidding zone');
  const weights = energySources.map((source, index) => {
    if (source.renewable) return code.startsWith('NO') ? index === 3 ? 3 : index === 4 ? 7 : .03 : code.startsWith('DK') ? index === 11 ? 6 : index === 10 ? 3 : .15 : index === 3 || index === 11 ? 2 : index === 4 ? 3 : .3;
    return code.startsWith('SE') || code === 'FI' ? index === 5 ? 7 : .2 : index === 12 ? 7 : .2;
  });
  const renewableWeight = weights.reduce((sum, value, i) => sum + (energySources[i].renewable ? value : 0), 0), otherWeight = weights.reduce((sum, value, i) => sum + (energySources[i].renewable ? 0 : value), 0);
  const generation = weights.map((weight, sourceIndex) => {
    const shapes = Array.from({length: 24}, (_, hour) => sourceIndex === 8 ? Math.max(.01, Math.sin((hour - 7) / 12 * Math.PI)) : 1 + .13 * Math.sin(hour / 24 * Math.PI * 2 + zoneIndex * .37) + .06 * Math.cos(hour / 4 + sourceIndex));
    const total = shapes.reduce((sum, value) => sum + value, 0), renewable = energySources[sourceIndex].renewable, energy = zone.volume * 1000 * (renewable ? zone.renewable / 100 : 1 - zone.renewable / 100) * weight / (renewable ? renewableWeight : otherWeight);
    return shapes.map(value => value / total * energy);
  });
  const priceShape = Array.from({length: 24}, (_, hour) => .75 + .76 * Math.exp(-(((hour - 11 - zoneIndex % 4) / 4) ** 2)) + .15 * Math.exp(-(((hour - 18) / 2.6) ** 2))), meanPriceShape = priceShape.reduce((sum, value) => sum + value, 0) / 24;
  return {code, generation, prices: priceShape.map(value => zone.price * value / meanPriceShape)};
}
export function energyTotals(profile: ReturnType<typeof energyProfile>, active: readonly boolean[]) {return Array.from({length: 24}, (_, hour) => profile.generation.reduce((sum, values, index) => sum + (active[index] ? values[hour] : 0), 0));}
function mountNordic(context: OfficialMountContext): OfficialMounted {
  const wrapper = frame(context), body = cell(wrapper, 'flex:1;display:grid;grid-template-columns:minmax(0,1fr) 195px;grid-template-rows:65% 35%'), mapHost = cell(body, 'overflow:hidden'), mapChart = map(context, mapHost, 'Nord Pool Day-Ahead Market View · 12 Jan 2026', mapZones, 'mercator').setRegionFillStyle(fill('#9a9b477f')).setRegionStrokeStyle(stroke('#e4e763', 1.4)).setViewBounds({west: 0, south: 53, east: 34, north: 72});
  const detailHost = cell(body, 'grid-column:1;grid-row:2;border-top:1px solid #555'), detail = xy(context, detailHost, 'Bidding Zone: NO1'), priceAxis = detail.addAxisY({opposite: true}).setTitle('Price (€/MWh)'); detail.getDefaultAxisX().setTitle('Time').setInterval({start: 0, end: 24}).setTickStrategy('numeric', (strategy: any) => strategy.setMajorTickPlacement(() => Array.from({length: 12}, (_, i) => ({position: i * 2 + .5, label: String(i * 2).padStart(2, '0')})))); detail.getDefaultAxisY().setTitle('Generation (MW)');
  const stacks = energySources.map(source => detail.addRectangleSeries().setName(source.name).setFillStyle(fill(source.color)).setStrokeStyle(stroke(source.color, .2))), price = detail.addLineSeries({axisY: priceAxis}).setName('Day-ahead Price (€/MWh)').setStrokeStyle(stroke('#ff1212', 3));
  const sidebar = cell(body, 'grid-column:2;grid-row:1 / 3;flex-direction:column;border-left:1px solid #555;padding:7px 5px;overflow:auto;font-size:11px'), heading = document.createElement('div'); heading.textContent = 'Zone · Vol(GWh) · %Ren · Price'; heading.style.cssText = 'font-weight:bold;padding:6px 0;border-bottom:1px solid #666'; sidebar.append(heading);
  const active = energySources.map(() => true), profiles = new Map(energyZoneFacts.map(zone => [zone.code as string, energyProfile(zone.code)])); let selected = 'NO1';
  const miniatures: Array<{code: string; button: HTMLButtonElement; canvas: HTMLCanvasElement; anchor: [number, number]}> = [], rows = new Map<string, HTMLButtonElement>();
  for (const zone of energyZoneFacts) {
    const row = button(sidebar, `${zone.code}  ${zone.volume}  ${zone.renewable}%  ${zone.price} €`, `zone-${zone.code}`, () => select(zone.code)); row.style.cssText = 'display:block;text-align:left;padding:6px 3px;border:0;background:transparent;white-space:pre;color:#eee;cursor:pointer'; row.dataset.zone = zone.code; rows.set(zone.code, row);
    const mini = document.createElement('button'); mini.dataset.miniZone = zone.code; mini.setAttribute('aria-label', `${zone.code} hourly generation and price`); mini.style.cssText = 'position:absolute;width:78px;height:48px;padding:0;background:#141515df;border:1px solid #555;color:#eee;z-index:3;cursor:pointer';
    const label = document.createElement('div'); label.textContent = zone.code; label.style.cssText = 'height:13px;font:10px sans-serif'; const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:74px;height:30px;display:block'; mini.append(label, canvas); mapHost.append(mini); mini.addEventListener('click', () => select(zone.code));
    miniatures.push({code: zone.code, button: mini, canvas, anchor: [...zone.center] as [number, number]});
  }
  const explanation = document.createElement('div'); explanation.style.cssText = 'line-height:1.5;margin-top:10px;font-size:10px;border-top:1px solid #555;padding-top:8px'; explanation.textContent = '% Ren: renewable generation share. Red line: day-ahead price. Visible sidebar scalars are reference facts; hourly generation and prices are original synthetic profiles.'; sidebar.append(explanation);
  const filters = cell(wrapper, 'padding:7px 5px 18px;gap:4px;justify-content:center;flex-wrap:wrap;flex:none'), buttons = energySources.map((source, i) => {const node = button(filters, source.name, `energy-${i}`, () => {active[i] = !active[i]; refresh();}); node.style.cssText += `;font-size:10px;padding:3px 5px;border-color:${source.color};color:${source.color}`; return node;});
  const all = button(filters, 'Hide All', 'energy-all', () => {const next = !active.some(Boolean); active.fill(next); refresh();});
  function drawMini(mini: typeof miniatures[number]) {
    const dpr = Math.max(1, globalThis.devicePixelRatio || 1), width = 74, height = 30; mini.canvas.width = width * dpr; mini.canvas.height = height * dpr; const ctx = mini.canvas.getContext('2d'); if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height); const profile = profiles.get(mini.code)!, totals = energyTotals(profile, active), maximum = Math.max(1, ...totals), maxPrice = Math.max(1, ...profile.prices);
    for (let hour = 0; hour < 24; hour++) {let y = height - 1; for (let source = 0; source < energySources.length; source++) {if (!active[source]) continue; const h = profile.generation[source][hour] / maximum * (height - 3); ctx.fillStyle = energySources[source].color; ctx.fillRect(hour / 24 * width, y - h, width / 24, h); y -= h;}}
    ctx.beginPath(); profile.prices.forEach((value, hour) => {const x = (hour + .5) / 24 * width, y = height - 1 - value / maxPrice * (height - 4); if (hour) ctx.lineTo(x, y); else ctx.moveTo(x, y);}); ctx.strokeStyle = '#ff1515'; ctx.lineWidth = 1.6; ctx.stroke();
  }
  function layoutMini() {
    const boxes = miniatures.map(mini => {const p = mapChart.positionToScreen(mini.anchor); return {mini, x: Math.max(1, Math.min(mapChart.width - 79, p.x - 39)), y: Math.max(47, Math.min(mapChart.height - 49, p.y - 24))};});
    for (let step = 0; step < 30; step++) for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const left = boxes[a], right = boxes[b], dx = right.x - left.x, dy = right.y - left.y;
      if (Math.abs(dx) < 81 && Math.abs(dy) < 50) {const delta = (50 - Math.abs(dy)) / 2 + .1, sign = dy < 0 ? -1 : 1; left.y = Math.max(47, Math.min(mapChart.height - 49, left.y - delta * sign)); right.y = Math.max(47, Math.min(mapChart.height - 49, right.y + delta * sign)); if (step > 15) {left.x = Math.max(1, left.x - 2); right.x = Math.min(mapChart.width - 79, right.x + 2);}}
    }
    boxes.forEach(box => {box.mini.button.style.left = `${box.x}px`; box.mini.button.style.top = `${box.y}px`;});
  }
  function select(code: string) {if (!profiles.has(code)) return; selected = code; mapChart.setSelectedRegion(code); detail.setTitle(`Bidding Zone: ${code}`); rows.forEach((row, key) => {row.style.background = key === code ? '#3d3f40' : 'transparent'; row.style.fontWeight = key === code ? 'bold' : 'normal';}); miniatures.forEach(mini => {mini.button.style.border = mini.code === code ? '2px solid #ffff66' : '1px solid #555';}); refresh();}
  function refresh() {
    const profile = profiles.get(selected)!, bottoms = new Float64Array(24); stacks.forEach((series, source) => {series.clear(); if (!active[source]) return; series.add(profile.generation[source].map((value, hour) => {const row = {x: hour, y: bottoms[hour], width: .98, height: value}; bottoms[hour] += value; return row;}));});
    price.clear().add(profile.prices.map((y, hour) => ({x: hour + .5, y}))); detail.getDefaultAxisY().setInterval({start: 0, end: Math.max(1, ...bottoms) * 1.08}); priceAxis.setInterval({start: 0, end: Math.max(...profile.prices) * 1.2});
    miniatures.forEach(drawMini); buttons.forEach((button, i) => {button.style.opacity = active[i] ? '1' : '.3'; button.dataset.active = String(active[i]);}); all.textContent = active.some(Boolean) ? 'Hide All' : 'Show All';
  }
  const viewToken = mapChart.on('viewchange', layoutMini), clickToken = mapChart.onRegionClick(event => select(event.key)); const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(layoutMini); resize?.observe(mapHost); select(selected); layoutMini();
  attribution(wrapper, 'EnergieID / NVE / Natural Earth geography · independently generated hourly profiles');
  return {charts: [mapChart, detail], dispose: () => {resize?.disconnect(); mapChart.off(viewToken); mapChart.off(clickToken); wrapper.remove();}, snapshot: () => ({selectedZone: selected, zones: mapChart.getRegionCount(), miniChartCount: miniatures.length, activeSources: energySources.filter((_, i) => active[i]).map(source => source.name), activeGeneration: energyTotals(profiles.get(selected)!, active), priceSamples: price.getSampleCount(), stackSamples: stacks.map(series => series.getSampleCount()), miniPixels: miniatures.map(mini => ({code: mini.code, x: parseFloat(mini.button.style.left) + 39, y: parseFloat(mini.button.style.top) + 24})), dataProvenance: {kind: 'mixed-reference-and-independent', referenceValues: '15 sidebar volume/renewable share/price scalars', geometry: 'EnergieID entsoe-py real Nordic bidding polygons', independentlyGenerated: '24-hour energy mix and price shapes normalized to displayed scalar facts'}})};
}

function linearGauge(parent: HTMLElement, title: string, maximum: number, ticks: number[], horizontal = false) {
  const host = cell(parent, 'flex:1;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:6px;min-width:100px'), label = document.createElement('div'); label.textContent = title; label.style.cssText = 'font-size:14px;text-align:center'; host.append(label);
  const track = cell(host, `flex:none;border:1px solid #c9cbb5;border-radius:6px;box-shadow:0 0 5px #777;${horizontal ? 'width:130px;height:37px;background:linear-gradient(to right,#8c8c2a,#ffff88)' : 'width:31px;height:95px;margin-right:36px;background:linear-gradient(to top,#38ff00,#a4ff00,#ffff00,#ff8c00,#ff0000)'}`);
  const marker = document.createElement('div'); marker.style.cssText = `position:absolute;background:#222;border:1px solid #ddd;${horizontal ? 'width:3px;height:49px;top:-7px' : 'height:3px;width:43px;left:-5px'}`; track.append(marker);
  const value = document.createElement('span'); value.style.cssText = 'font-size:20px;white-space:nowrap'; host.append(value);
  ticks.forEach(tick => {const text = document.createElement('span'); text.textContent = String(tick); text.style.cssText = `position:absolute;font-size:11px;${horizontal ? `left:${tick / maximum * 100}%;top:43px;transform:translateX(-50%)` : `right:38px;bottom:${tick / maximum * 100}%;transform:translateY(50%)`}`; track.append(text);});
  return {setValue(number: number) {const fraction = Math.max(0, Math.min(1, number / maximum)); if (horizontal) marker.style.left = `calc(${fraction * 100}% - 2px)`; else marker.style.bottom = `calc(${fraction * 100}% - 2px)`; value.textContent = number.toFixed(2); host.dataset.value = String(number);}, host};
}
function mountAirRoute(context: OfficialMountContext): OfficialMounted {
  const wrapper = frame(context), main = cell(wrapper, 'flex:1;display:grid;grid-template-columns:58% 42%'), volumeHost = cell(main), geoHost = cell(main, 'padding-right:10px'), chart3D = context.engine.Chart3D({container: volumeHost, theme: context.theme}).setTitle('PM2.5 Concentration').setTitleFont(new FontSettings({size: 17, weight: 400})).setPadding({left: -25, right: -10, top: -16, bottom: -15}).setCameraLocation({azimuth: -.25, elevation: .2, zoom: 1.15});
  chart3D.getDefaultAxisX().setTitle('Longitude').setInterval({start: -6.38, end: -6.20}); chart3D.getDefaultAxisY().setTitle('PM2.5 (µg/m³)').setInterval({start: 0, end: 50}); chart3D.getDefaultAxisZ().setTitle('Latitude').setInterval({start: 53.30, end: 53.43});
  const geographic = xy(context, geoHost, 'Measurement Locations').setBackgroundFillStyle(fill('#182326')); geographic.getDefaultAxisX().setTitle('Longitude').setInterval({start: -6.38, end: -6.20}); geographic.getDefaultAxisY().setTitle('Latitude').setInterval({start: 53.30, end: 53.43});
  const roadPoints = mapRoads.flatMap(road => [...road.points.map(([x, y]) => ({x, y})), {x: NaN, y: NaN}]); geographic.addLineSeries().setName('Dublin streets · OpenStreetMap').setStrokeStyle(stroke('#7e929344', .75)).setCursorEnabled(false).add(roadPoints);
  const dataset = new DataSetXY({schema: {lon: {storage: Float64Array}, lat: {storage: Float64Array}, pm: {storage: Float32Array}, value: {storage: Float32Array}}});
  const palette = new LUT({steps: [{value: 0, color: ColorHEX('#688600')}, {value: 3, color: ColorHEX('#21ff00')}, {value: 35, color: ColorHEX('#ffff00')}, {value: 75, color: ColorHEX('#ff0000')}]});
  const series3D = chart3D.addLineSeries().setName('PM2.5 (µg/m³)').setDataSet(dataset).setDataMapping({x: 'lon', y: 'pm', z: 'lat', value: 'value'}).setStrokeStyle(new SolidLine({fillStyle: new PalettedFill({lut: palette, lookUpProperty: 'value'}), thickness: 1.5}));
  const route2D = geographic.addPointSeries().setName('GPS measurements').setDataSet(dataset).setDataMapping({x: 'lon', y: 'lat', value: 'value'}).setPointSize(3).setPointFillStyle(fill('#ff2525'));
  const colors = legend(volumeHost, 'PM2.5 (µg/m³)', ['#688600', '#21ff00', '#ffff00', '#ff0000'], ['0', '3', '35', '75']); colors.style.cssText += ';position:absolute;right:5px;top:25%;width:70px;background:#0a0a0acc;border:1px solid #ddd;border-radius:8px;font-size:10px';
  const stats = cell(wrapper, 'height:205px;flex:none;align-items:stretch'), meanGauge = linearGauge(stats, 'Average PM2.5', 35, [0, 15, 35]), peakGauge = linearGauge(stats, 'Peak PM2.5', 75, [0, 35, 75]), piePanel = cell(stats, 'flex:1;min-width:150px;flex-direction:column'), pieHost = cell(piePanel, 'flex:1');
  const pie = context.engine.Pie({container: pieHost, theme: {...context.theme, textColor: ColorHEX(cream)}}).setTitle('Exposure Breakdown').setTitleFont(new FontSettings({size: 14, weight: 400})).setTitleAlignment('center').setBackgroundFillStyle(transparentFill).setLabelPosition('inside').setLabelFormatter((_slice: unknown, relativeValue: number) => { const percentage = relativeValue * 100; return percentage >= 7 ? `${percentage.toFixed(0)}%` : ''; }).setLabelFont(new FontSettings({size: 11}));
  const pieLabels = cell(piePanel, 'height:34px;flex:none;flex-direction:column;align-items:center;font-size:10px;gap:3px'); for (const [name, color] of [['Above 15 µg/m³', '#ffff00'], ['At or below 15 µg/m³', '#2cff00']]) {const label = document.createElement('span'); label.textContent = `● ${name}`; label.style.color = color; pieLabels.append(label);}
  const above = pie.addSlice('Above 15 µg/m³', 0).setFillStyle(fill('#ffff00')), below = pie.addSlice('At or below 15 µg/m³', 100).setFillStyle(fill('#2cff00'));
  const exposureMax = Math.max(10, Math.ceil(airStatistics(mapAirRoute).exposureSeconds / 100) * 100), exposure = linearGauge(stats, 'Exposure >15 µg/m³ (s)', exposureMax, [0, exposureMax], true), info = cell(stats, 'flex-direction:column;gap:15px;justify-content:center;min-width:150px;padding:8px'), stamp = document.createElement('div'), distance = document.createElement('div'); stamp.style.cssText = distance.style.cssText = 'border:1px solid #555;border-radius:6px;padding:12px;background:#191a1b;font-size:13px'; info.append(stamp, distance);
  const controls = cell(wrapper, 'height:52px;box-sizing:border-box;flex:none;align-items:center;gap:10px;padding:0 10px 20px'); let count = 0, playing = true, accumulator = 0, statistics = airStatistics([]), breaks = 0;
  const toggle = button(controls, 'Pause', 'route-play', () => {playing = !playing; toggle.textContent = playing ? 'Pause' : 'Play';}), slider = range(controls, 1, mapAirRoute.length, 120, 'route-samples', value => {playing = false; toggle.textContent = 'Play'; appendTo(value);});
  function appendTo(target: number) {
    target = Math.max(1, Math.min(mapAirRoute.length, Math.round(target))); if (target < count) {dataset.clear(); count = 0; breaks = 0;}
    if (target === count) return;
    const lon: number[] = [], lat: number[] = [], pm: number[] = [], value: number[] = [];
    for (let i = count; i < target; i++) {const row = mapAirRoute[i]; if (i && row[0] - mapAirRoute[i - 1][0] > 3) {lon.push(NaN); lat.push(NaN); pm.push(NaN); value.push(NaN); breaks++;} lon.push(row[1]); lat.push(row[2]); pm.push(row[3]); value.push(row[3]);}
    dataset.appendSamples({lon, lat, pm, value}); count = target; slider.value = String(count); statistics = airStatistics(mapAirRoute.slice(0, count));
    meanGauge.setValue(statistics.mean); peakGauge.setValue(statistics.peak); exposure.setValue(statistics.exposureSeconds); above.setValue(statistics.exposurePercent); below.setValue(100 - statistics.exposurePercent);
    stamp.textContent = new Date(mapAirRoute[count - 1][0] * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC'); distance.textContent = `${(statistics.distanceMeters / 1000).toFixed(1)} km`;
  }
  appendTo(120); attribution(wrapper, 'Aclima & Google 2022 via Dublinked · CC BY 4.0 · street geometry © OpenStreetMap contributors, ODbL');
  return {charts: [chart3D, geographic, pie], update: (_time, delta) => {if (!playing || count >= mapAirRoute.length) return; accumulator += delta * 40; const amount = Math.floor(accumulator); if (amount) {accumulator -= amount; appendTo(count + amount);}}, dispose: () => {dataset.dispose(); wrapper.remove();}, snapshot: () => ({count, totalRecords: mapAirRoute.length, playing, statistics, datasetSamples: dataset.getSampleCount(), routeBreaks: breaks, sharedDataset: series3D.getDataSet() === route2D.getDataSet(), coordinateMapping3D: {x: 'longitude', y: 'PM2.5', z: 'latitude'}, colorLookup3D: 'value', roadSegments: mapRoads.length, roadPoints: roadPoints.length, camera: chart3D.getCameraLocation(), dataProvenance: {kind: 'public-measurement-data', source: 'Aclima & Google 2022 via Dublinked', windowUTC: '2021-05-26 08:00–08:46', omittedGaps: 'intervals above 3 seconds do not count toward exposure or route distance', basemap: 'Dublin road LineStrings derived from OSM; no raster tiles'}})};
}

export const mapEntries: OfficialEntry[] = [
  {id: 'crychart-example-1100-mapChart', title: '世界地理边界 · 1100', description: '真实世界多边形、岛屿与内洞，连续金色渐变；保留经纬度坐标和区域命中。', observed: ["真实世界多边形、岛屿与内洞，连续金色渐变；保留经纬度坐标和区域命中。"], gaps: ["场景样本用于演示；生产负载的性能与资源容量需要单独测量。"], mount: mountWorld},
  {id: 'crychart-example-1101-mapChartDynamicColor', title: '欧洲人口着色 · 1101', description: '2018 年人口总量映射欧洲国家颜色，白色表示未匹配数据，悬停显示国家与数值。', observed: ["2018 年人口总量映射欧洲国家颜色，白色表示未匹配数据，悬停显示国家与数值。"], gaps: ["本库场景的功能、交互和资源占用需在目标运行环境验证。"], mount: mountPopulation},
  {id: 'crychart-example-1102-mapChartTimeline', title: '人口变化时间线 · 1102', description: '北美、南美和欧洲三个同步地图随年份播放，也可暂停并拖动年份。', observed: ["北美、南美和欧洲三个同步地图随年份播放，也可暂停并拖动年份。"], gaps: ["本库场景的功能、交互和资源占用需在目标运行环境验证。"], mount: mountPopulationTimeline},
  {id: 'crychart-example-1103-mapChartVizXY', title: '疫苗覆盖与地理散点 · 1103', description: '真实国家位置上的可变半径彩色散点随日期播放，顶部显示世界已接种至少一剂的比例。', observed: ["真实国家位置上的可变半径彩色散点随日期播放，顶部显示世界已接种至少一剂的比例。"], gaps: ["本库场景的功能、交互和资源占用需在目标运行环境验证。"], mount: mountVaccinations},
  {id: 'crychart-example-1110-geoChartUsaTemperature', title: '美国地理温度热图 · 1110', description: '500×400 动态强度网格与真实州界共享经纬度轴，透明度滑块直接改变 GPU 热图混合。', observed: ["500×400 动态强度网格与真实州界共享经纬度轴，透明度滑块直接改变 GPU 热图混合。"], gaps: ["本库场景的功能、交互和资源占用需在目标运行环境验证。"], mount: mountTemperature},
  {id: 'crychart-example-1111-covidDrillDownDashboard', title: '疫情地图下钻仪表盘 · 1111', description: '疫苗着色与病例气泡、历史日期拖动、四周悬停趋势、洲/国家下钻和相对/实际人数切换。', observed: ["疫苗着色与病例气泡、历史日期拖动、四周悬停趋势、洲/国家下钻和相对/实际人数切换。"], gaps: ["本库场景的功能、交互和资源占用需在目标运行环境验证。"], mount: mountCovidDashboard},
  {id: 'crychart-example-1714-chartsInChart', title: '北欧电力地图中的图表 · 1714', description: '15 个真实电力分区上的小时堆叠小图、价格线、侧栏选择和能源过滤共同驱动下方明细。', observed: ["15 个真实电力分区上的小时堆叠小图、价格线、侧栏选择和能源过滤共同驱动下方明细。"], gaps: ["分区取自 EnergieID entsoe-py 公开 best-effort GeoJSON；瑞典内边界由上游手工重绘，非权威精密电网边界。","本库场景的功能、交互和资源占用需在目标运行环境验证。"], mount: mountNordic},
  {id: 'crychart-example-1715-3dLineSeriesMap', title: '都柏林真实 PM2.5 路线 · 1715', description: '同一份真实测量数据驱动三维浓度路线、地理散点、平均值/峰值/暴露时间和比例统计。', observed: ["同一份真实测量数据驱动三维浓度路线、地理散点、平均值/峰值/暴露时间和比例统计。"], gaps: ["本库场景的功能、交互和资源占用需在目标运行环境验证。","播放按每秒 40 条记录推进；测量缺口分段绘制，暴露时间不跨缺口累加。"], mount: mountAirRoute},
];
