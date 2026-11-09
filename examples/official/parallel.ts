import {ColorHEX, FontSettings, LUT, SolidFill, SolidLine, transparentFill} from '../../src/core/styles';
import {formatParallelDuration, type BarChart, type DataGrid, type ParallelAxisOptions, type ParallelCoordinateChart} from '../../src/specialty';
import type {OfficialEntry, OfficialMountContext, OfficialMounted} from './types';

const cream = '#f4f4bf', yellow = '#ffff57', background = 'radial-gradient(ellipse at 65% 40%,#303132 0%,#141515 60%,#030404 100%)';
const fill = (color: string) => new SolidFill({color: ColorHEX(color)}), line = (color: string, thickness = 1) => new SolidLine({fillStyle: fill(color), thickness});
const approximateVisuals = "本库场景的功能、交互和资源占用需在目标运行环境验证。";
const independentData = "本库场景的功能、交互和资源占用需在目标运行环境验证。";
const filteringGap = "本库场景的功能、交互和资源占用需在目标运行环境验证。";
const numeric = (start: number, end: number, decimals = 1, tickCount = 6): ParallelAxisOptions => ({range: {start, end}, tickCount, format: value => Number(value).toFixed(decimals)});
function rng(seed: number): () => number {let state = seed >>> 0; return () => {state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296;};}
export const parallelFixtures = {
  simple: [{id: 1, name: 'Sample 1', A: 50, B: 100, C: 2, color: yellow}, {id: 2, name: 'Sample 2', A: 30, B: 115, C: .5, color: '#ff9c59'}, {id: 3, name: 'Sample 3', A: 35, B: 82, C: .9, color: '#d88aac'}],
  heavyDimensions: ['test_rec', 'test_prec', 'test_acc', 'test_loss', 'train_loss', 'batch_size', 'lstm_output_size', 'pool_size', 'kernel_size', 'filters', 'dropout', 'embedding_dim'],
  lookupDimensions: ['batch_size', 'channels_one', 'learning_rate', 'accuracy'],
  trainingDimensions: ['Training date', 'Miles run', 'Training duration', 'Shoe brand', 'Short or long', 'Time period'],
  fuels: ['Petrol', 'Diesel', 'Electric', 'Hybrid'], fuelColors: ['#bf67a9', '#50a4ed', '#b37aee', '#36bfa2'],
  manufacturers: ['Solaris', 'Apex Motors', 'Voltura', 'Horizon', 'Phoenix', 'Mercury Motors', 'Neo Auto', 'Turbine Works', 'Atlas'],
};
export function heavyParallelData(count = 8192): Record<string, any>[] {
  const random = rng(1701), pick = (values: number[]) => values[Math.floor(random() * values.length)];
  const rows = Array.from({length: count}, (_, id) => ({id, name: `Sample ${id}`, test_rec: .44 + .55 * random(), test_prec: .61 + .27 * random(), test_acc: .685 + .118 * random(), test_loss: .42 + .76 * random(), train_loss: .012 + .458 * random(), batch_size: pick([8, 16, 32]), lstm_output_size: pick([16, 32, 64]), pool_size: pick([2, 3, 4]), kernel_size: pick([3, 5, 7]), filters: pick([16, 32, 64]), dropout: pick([.01, .1]), embedding_dim: pick([32, 64, 128])}));
  if (rows.length) Object.assign(rows[0], {test_rec: .590, test_prec: .667, test_acc: .780, test_loss: .471, train_loss: .017, batch_size: 16, lstm_output_size: 64, pool_size: 2, kernel_size: 5, filters: 16, dropout: .01, embedding_dim: 128});
  return rows;
}
export function lookupParallelData(): Record<string, any>[] {
  const visible = [[500, 7, .089, .961], [395, 29, .096, .955], [539, 5, .083, .948], [15, 5, .093, .941], [305, 26, .099, .936], [490, 3, .044, .933], [233, 32, .074, .932], [76, 19, .056, .931], [484, 3, .008, .926], [262, 2.6, .0468, .88]];
  const random = rng(1702), generated = Array.from({length: 70}, () => [Math.round(5 + random() * 590), 1 + random() * 31, .001 + random() * .099, .03 + Math.sqrt(random()) * .889]);
  return [...visible, ...generated].map((row, id) => ({id, name: 'Parallel Coordinate Series', ...Object.fromEntries(parallelFixtures.lookupDimensions.map((key, i) => [key, row[i]]))}));
}
export function trainingParallelData(): Record<string, any>[] {
  const random = rng(1703), brands = ['Other', 'Izumi', 'Adidas', 'Mizuno', 'Brooks', 'New Balance'], start = Date.UTC(2018, 0, 1), end = Date.UTC(2023, 0, 1);
  const rows = Array.from({length: 320}, (_, id) => {const date = new Date(start + random() * (end - start)), miles = .4 + random() * 22.6, duration = (30 + random() * 170) * 60000; return {id, name: `Training ${id + 1}`, 'Training date': date, 'Miles run': miles, 'Training duration': duration, 'Shoe brand': brands[Math.floor(random() * brands.length)], 'Short or long': miles < 5 ? '< 5 miles' : '> 5 miles', 'Time period': date.getTime() < Date.UTC(2020, 0, 1) ? 'Before 2020' : 'After 2020'};});
  Object.assign(rows[0], {'Training date': new Date(Date.UTC(2021, 3, 8, 21, 46, 13)), 'Miles run': 13.4, 'Training duration': 92 * 60000, 'Shoe brand': 'Adidas', 'Short or long': '> 5 miles', 'Time period': 'After 2020'}); return rows;
}
export function streamingParallelRow(index: number): Record<string, any> {const t = index / 10; return {id: index, name: `Sample ${index}`, A: -.2 - 10.3 * (.5 + .5 * Math.sin(t * 1.2)), B: 850 + 700 * Math.sin(t * .74) + t * 45, C: 66 + 43 * Math.sin(t * 1.4 + .8) + t * 3, D: 9 + 9 * Math.sin(t * .51 + 1.2) - t * .45, E: 91 + 20 * Math.sin(t * .8 + .2) + t * 1.2};}
export interface CarRecord {id: number; name: string; Manufacturer: string; Fuel: string; Price: number; Horsepower: number; Weight: number; FuelEfficiency: number;}
export function carParallelData(): CarRecord[] {
  const random = rng(1707), rows: CarRecord[] = [];
  for (const [makerIndex, maker] of parallelFixtures.manufacturers.entries()) for (let model = 0; model < 6; model++) {const fuelIndex = (makerIndex + model) % 4, fuel = parallelFixtures.fuels[fuelIndex]; rows.push({id: rows.length, name: `${maker} Model ${model + 1} (${fuel})`, Manufacturer: maker, Fuel: fuel, Price: Math.round(22 + random() * 150), Horsepower: Math.round(120 + random() * 430), Weight: Math.round(1300 + random() * 1600), FuelEfficiency: Number((fuelIndex === 2 ? 4 + random() * 2.25 : fuelIndex === 3 ? 2.3 + random() * 1.7 : fuelIndex === 1 ? 1.9 + random() * 1.2 : 1.5 + random() * .8).toFixed(2))});}
  Object.assign(rows[24], {name: 'Phoenix Helios (Petrol)', Manufacturer: 'Phoenix', Fuel: 'Petrol', Price: 96, Horsepower: 365, Weight: 1810, FuelEfficiency: 1.61}); return rows;
}
export function parallelQuartiles(values: number[]): {min: number; lowerQuartile: number; median: number; upperQuartile: number; max: number; outliers: number[]} | undefined {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); if (!sorted.length) return undefined;
  const q = (fraction: number) => {const index = fraction * (sorted.length - 1), lo = Math.floor(index); return sorted[lo] + (sorted[Math.ceil(index)] - sorted[lo]) * (index - lo);};
  const lowerQuartile = q(.25), median = q(.5), upperQuartile = q(.75), spread = upperQuartile - lowerQuartile, lowerFence = lowerQuartile - spread * 1.5, upperFence = upperQuartile + spread * 1.5, inside = sorted.filter(value => value >= lowerFence && value <= upperFence);
  return {min: inside[0], lowerQuartile, median, upperQuartile, max: inside.at(-1)!, outliers: sorted.filter(value => value < lowerFence || value > upperFence)};
}
export function summarizeCars(rows: CarRecord[]) {
  const counts = parallelFixtures.manufacturers.map(name => ({name, fuels: parallelFixtures.fuels.map(fuel => rows.filter(row => row.Manufacturer === name && row.Fuel === fuel).length)})).sort((a, b) => b.fuels.reduce((sum, value) => sum + value, 0) - a.fuels.reduce((sum, value) => sum + value, 0));
  const averages = parallelFixtures.fuels.map(fuel => {const group = rows.filter(row => row.Fuel === fuel); return {fuel, count: group.length, price: group.length ? group.reduce((sum, row) => sum + row.Price, 0) / group.length : 0, horsepower: parallelQuartiles(group.map(row => row.Horsepower))};});
  return {counts, averages, rowCount: rows.length};
}

function frame(context: OfficialMountContext) {const wrapper = document.createElement('div'); wrapper.style.cssText = `width:100%;height:100%;min-height:0;flex:1;background:${background};position:relative`; context.host.append(wrapper); return wrapper;}
function parallel(context: OfficialMountContext, host: HTMLElement, title: string): ParallelCoordinateChart {return context.engine.ParallelCoordinateChart({container: host, theme: {...context.theme, textColor: ColorHEX(cream)}}).setTitle(title).setTitleAlignment('center').setTitleFont(new FontSettings({size: 17, weight: 400})).setPadding(8).setBackgroundFillStyle(transparentFill);}
function basicAxes(chart: ParallelCoordinateChart) {chart.setAxisOptions('A', {...numeric(20, 60, 1, 8), title: 'Variable A'}).setAxisOptions('B', {...numeric(80, 120, 1, 8), title: 'Variable B'}).setAxisOptions('C', {...numeric(0, 2.5, 2, 5), title: 'Variable C'});}
function lookupAxes(chart: ParallelCoordinateChart) {chart.setAxisOptions('batch_size', numeric(0, 600, 0, 6)).setAxisOptions('channels_one', numeric(0, 32, 1, 7)).setAxisOptions('learning_rate', numeric(0, .1, 4, 10)).setAxisOptions('accuracy', numeric(0, 1, 2, 10));}
function accuracyLUT(start = 0, end = 1) {return new LUT({steps: [{value: start, color: ColorHEX('#ff0000')}, {value: (start + end) / 2, color: ColorHEX('#ffff00')}, {value: end, color: ColorHEX('#00ff00')}]});}
function snapshot(chart: ParallelCoordinateChart, extra: Record<string, unknown> = {}) {
  const domains = chart.dimensions.map(key => chart.getAxisDomain(key)!);
  const axisPixels = domains.map(domain => ({key: domain.key, low: chart.getAxisScreenPosition(domain.key, domain.start), high: chart.getAxisScreenPosition(domain.key, domain.end), mid: chart.getAxisScreenPosition(domain.key, (domain.start + domain.end) / 2)}));
  const probeValues: Record<string, number> = {B: 100, accuracy: .9, Price: 70};
  const probes = Object.fromEntries(Object.entries(probeValues).filter(([key]) => chart.dimensions.includes(key)).map(([key, value]) => [key, {value, position: chart.getAxisScreenPosition(key, value)}]));
  return {dimensions: chart.dimensions.slice(), samples: chart.getSampleCount(), filtered: chart.getFilteredCount(), filters: chart.getRangeFilters(), selectedId: chart.getSelectedRow()?.id, domains, axisPixels, probes, geometry: {...chart.renderStats}, ...extra};
}

function mountSimple(context: OfficialMountContext, thresholds = false): OfficialMounted {
  const wrapper = frame(context), chart = parallel(context, wrapper, thresholds ? 'Parallel Coordinate Chart with Value thresholds' : 'Parallel Coordinate Chart');
  const data = parallelFixtures.simple.map(row => ({...row})); if (thresholds) {data[0].A = 36; data[0].C = 1.1; data[1].A = 32;}
  chart.setData(data, ['A', 'B', 'C']).setInterpolation('smooth').setStrokeThickness(1.8).setLineOpacity(1).setHoverMode(thresholds ? 'row' : 'axis'); basicAxes(chart);
  if (thresholds) chart.setThresholds('A', [{start: 50, end: 60}]).setThresholds('B', [{start: 80, end: 85}]).setThresholds('C', [{start: 0, end: .2}, {start: 1.5, end: 2.5}]);
  return {charts: [chart], dispose: () => wrapper.remove(), snapshot: () => snapshot(chart, {values: chart.getData(), thresholds: Object.fromEntries(chart.dimensions.map(key => [key, chart.getThresholds(key)])), dataProvenance: {kind: 'reference-visible-scalars', note: thresholds ? 'three visible records and red axis intervals' : 'three visible records; Sample 1/2/3 axis B tooltip confirms 100/115/82'}})};
}
function mountHeavy(context: OfficialMountContext): OfficialMounted {
  const wrapper = frame(context), chart = parallel(context, wrapper, 'Large data set Parallel Coordinate Chart'); chart.setData(heavyParallelData(), parallelFixtures.heavyDimensions).setLineColor(yellow).setLineOpacity(.018).setStrokeThickness(.6).setAxisLabelAngle(8);
  const ranges = [[.435, .995, 3], [.608, .883, 3], [.682, .803, 3], [.42, 1.18, 3], [.008, .475, 3], [8, 32, 1], [16, 64, 1], [2, 4, 2], [3, 7, 2], [16, 64, 1], [.01, .1, 4], [32, 128, 1]];
  ranges.forEach(([start, end, decimals], i) => chart.setAxisOptions(parallelFixtures.heavyDimensions[i], numeric(start, end, decimals, 5)));
  return {charts: [chart], dispose: () => wrapper.remove(), snapshot: () => snapshot(chart, {axisCount: 12, inputCount: 8192, dataProvenance: {kind: 'mixed-reference-and-independent', referenceValues: ['Sample 0 tooltip'], independentlyGenerated: ['8191 additional training records', 'candidate count 8192; official count not observed']}})};
}
function mountLUT(context: OfficialMountContext, filtering = false): OfficialMounted {
  const wrapper = frame(context); wrapper.style.display = 'flex'; wrapper.style.flexDirection = 'column'; const top = document.createElement('div'); top.style.cssText = `min-height:0;flex:${filtering ? '0 0 55%' : '1'}`; wrapper.append(top);
  const chart = parallel(context, top, filtering ? 'Double click on axis to filter' : 'Parallel Coordinate Chart with Value based coloring'); chart.setData(lookupParallelData(), parallelFixtures.lookupDimensions).setInterpolation('smooth').setLineOpacity(.85).setStrokeThickness(1.4).setColorMapping('accuracy', accuracyLUT(), {title: 'accuracy'}); lookupAxes(chart);
  let grid: DataGrid | undefined; const releases: Array<() => void> = [];
  if (filtering) {const bottom = document.createElement('div'); bottom.style.cssText = 'width:44%;min-width:330px;min-height:0;flex:1'; wrapper.append(bottom);
    grid = context.engine.DataGrid({container: bottom, theme: {...context.theme, textColor: ColorHEX(yellow)}}).setBackgroundFillStyle(transparentFill).setPadding(8).setRowHeight(27).setScrollbarVisible(true).setRowId('id');
    grid!.setColumnFormatter('batch_size', value => Number(value).toFixed(0)).setColumnFormatter('channels_one', value => Number(value).toFixed(0)).setColumnFormatter('learning_rate', value => Number(value).toFixed(3)).setColumnFormatter('accuracy', value => Number(value).toFixed(3));
    const updateGrid = () => grid!.setData(chart.getFilteredData(), parallelFixtures.lookupDimensions, {preserveSelection: true}).sortBy('accuracy', false);
    const filterToken = chart.on('filterchange', updateGrid), selectionToken = chart.on('select', () => grid!.setSelectedRow(chart.getSelectedRow())), gridToken = grid!.on('select', event => {if (typeof event.item === 'object') chart.setSelectedRow(grid!.getSelectedRow());});
    releases.push(() => chart.off(filterToken), () => chart.off(selectionToken), () => grid!.off(gridToken)); chart.setRangeSelectorsEnabled(true).setRangeFilter('accuracy', {start: .85, end: 1}); updateGrid();
  }
  return {charts: grid ? [chart, grid] : [chart], dispose: () => {releases.forEach(release => release()); wrapper.remove();}, snapshot: () => snapshot(chart, {colorKey: 'accuracy', gridRows: grid?.getRowCount(), gridFirstRows: grid?.getData().slice(0, 9), gridSelection: grid?.getSelectedRow()?.id, gridRowPixels: grid?.getData().slice(grid.scrollOffset, grid.scrollOffset + 9).map(row => ({id: row.id, position: grid!.getRowScreenPosition(row.id)})), dataProvenance: {kind: 'mixed-reference-and-independent', referenceValues: ['nine visible table records', 'one hovered LUT record'], independentlyGenerated: ['70 additional records']}})};
}
function mountCategory(context: OfficialMountContext): OfficialMounted {
  const wrapper = frame(context), chart = parallel(context, wrapper, 'Parallel Coordinate Chart Category + Date-Time Axes'); chart.setData(trainingParallelData(), parallelFixtures.trainingDimensions).setInterpolation('smooth').setLineColor(yellow).setLineOpacity(.12).setStrokeThickness(.9);
  const dateTicks = Array.from({length: 16}, (_, i) => {const year = 2018 + Math.floor(i / 3), month = i % 3 * 4; return {value: Date.UTC(year, month, 1), label: month === 0 ? `${year}年` : `${month + 1}月`};});
  chart.setAxisOptions('Training date', {type: 'datetime', range: {start: Date.UTC(2018, 0, 1), end: Date.UTC(2023, 0, 1)}, ticks: dateTicks, format: value => new Date(Number(value)).toISOString().replace('T', ' ').slice(0, 19)})
    .setAxisOptions('Miles run', numeric(0, 23, 1, 5)).setAxisOptions('Training duration', {type: 'duration', range: {start: 30 * 60000, end: 200 * 60000}, ticks: Array.from({length: 18}, (_, i) => ({value: (30 + i * 10) * 60000, label: formatParallelDuration((30 + i * 10) * 60000)}))})
    .setAxisOptions('Shoe brand', {type: 'category', categories: ['Other', 'Izumi', 'Adidas', 'Mizuno', 'Brooks', 'New Balance']}).setAxisOptions('Short or long', {type: 'category', categories: ['< 5 miles', '> 5 miles']}).setAxisOptions('Time period', {type: 'category', categories: ['Before 2020', 'After 2020']});
  return {charts: [chart], dispose: () => wrapper.remove(), snapshot: () => snapshot(chart, {dateStoragePreserved: chart.getData()[0]['Training date'] instanceof Date, durationExample: formatParallelDuration(92 * 60000), dataProvenance: {kind: 'mixed-reference-and-independent', referenceValues: ['one visible training tooltip', 'axis names and categories'], independentlyGenerated: ['319 additional records; UTC date representation']}})};
}
function mountRealTime(context: OfficialMountContext): OfficialMounted {
  const wrapper = frame(context), chart = parallel(context, wrapper, 'Real-Time Parallel Coordinate Chart'); chart.setData(Array.from({length: 30}, (_, i) => streamingParallelRow(i)), ['A', 'B', 'C', 'D', 'E']).setInterpolation('smooth').setLineColor('#ff0000').setLineOpacity(1).setStrokeThickness(1.8).setMaxSampleCount(96).setAxisOptions('A', numeric(-12, 0, 1, 12)); let nextIndex = 30, lastFrame = -1;
  return {charts: [chart], update: elapsed => {const bucket = Math.floor(elapsed * 10); if (bucket === lastFrame) return; lastFrame = bucket; const target = 30 + bucket, amount = Math.min(100, Math.max(0, target - nextIndex)); if (amount) {chart.addData(Array.from({length: amount}, (_, i) => streamingParallelRow(nextIndex + i))); nextIndex += amount;} chart.setAxisOptions('B', numeric(0, Math.max(2000, 2000 + elapsed * 70), 0, 6)).setAxisOptions('C', numeric(0, 120 + elapsed * 7, 0, 6)).setAxisOptions('D', numeric(-elapsed * 1.4, 22, 1, 5)).setAxisOptions('E', numeric(55, 120 + elapsed * 4, 0, 6));}, dispose: () => wrapper.remove(), snapshot: () => snapshot(chart, {nextIndex: chart.getNextSampleIndex(), firstRetainedId: chart.data[0]?.id, lastRetainedId: chart.data.at(-1)?.id, retainedLimit: 96, inputRateHz: 10, dataProvenance: {kind: 'independent-synthetic', note: 'five original time formulas, 10 rows/s, retention 96; official timing and retention not observed'}})};
}

function mountDashboard(context: OfficialMountContext): OfficialMounted {
  const wrapper = frame(context); wrapper.style.display = 'grid'; wrapper.style.gridTemplateRows = '57% 43%'; const top = document.createElement('div'), bottom = document.createElement('div'); top.style.minHeight = '0'; bottom.style.cssText = 'min-height:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px'; wrapper.append(top, bottom);
  const chart = parallel(context, top, 'Car Characteristics - Double Click on Axis to Filter'), original = carParallelData(); chart.setData(original, ['Price', 'Horsepower', 'Weight', 'FuelEfficiency']).setInterpolation('smooth').setLineOpacity(.9).setStrokeThickness(1.6).setRangeSelectorsEnabled(true).setColorMapping('FuelEfficiency', accuracyLUT(1.5, 6.25), {range: {start: 1.5, end: 6.25}, title: 'FuelEfficiency'});
  chart.setAxisOptions('Price', numeric(20, 175, 0, 5)).setAxisOptions('Horsepower', numeric(100, 550, 0, 5)).setAxisOptions('Weight', numeric(1250, 2950, 0, 4)).setAxisOptions('FuelEfficiency', numeric(1.5, 6.3, 2, 5));
  const cells = Array.from({length: 4}, () => {const cell = document.createElement('div'); cell.style.cssText = 'min-height:0;min-width:0;position:relative'; bottom.append(cell); return cell;});
  const counts: BarChart = context.engine.BarChart({container: cells[0], theme: {...context.theme, textColor: ColorHEX(cream)}}).setTitle('Models by Manufacturer').setTitleFont(new FontSettings({size: 13, weight: 400})).setTitleAlignment('center').setPadding(3).setBackgroundFillStyle(transparentFill).setHorizontal(true).setValueAxisPlacement('start').setGridVisible(false).setCornerRadius(1);
  const averages: BarChart = context.engine.BarChart({container: cells[1], theme: {...context.theme, textColor: ColorHEX(cream)}}).setTitle('Average Price per Fuel Type').setTitleFont(new FontSettings({size: 13, weight: 400})).setTitleAlignment('center').setPadding(3).setBackgroundFillStyle(transparentFill).setLabelPosition('inside').setBarLabelFormatter((row: any) => `$${Math.round(row.value)}k`).setValueFormatter((value: number) => value.toFixed(0)).setGridVisible(false).setCornerRadius(3).setLabelEffect(true);
  const scatterHost = document.createElement('div'), legend = document.createElement('div'); cells[2].style.display = 'flex'; cells[2].style.flexDirection = 'column'; scatterHost.style.cssText = 'flex:1;min-height:0'; legend.style.cssText = `font:11px sans-serif;display:flex;justify-content:center;flex-wrap:wrap;gap:8px;color:${cream};padding:4px`; cells[2].append(scatterHost, legend);
  parallelFixtures.fuels.forEach((name, i) => {const label = document.createElement('span'); label.textContent = `● ${name}`; label.style.color = parallelFixtures.fuelColors[i]; legend.append(label);});
  const scatter = context.engine.ChartXY({container: scatterHost, theme: context.theme}).setTitle('Fuel Efficiency vs Weight').setTitleFont(new FontSettings({size: 13, weight: 400})); scatter.setPadding({left: -7, right: -7, top: -8, bottom: -2}); scatter.getDefaultAxisX().setTitle('Weight (kg)').setInterval({start: 1200, end: 3000}); scatter.getDefaultAxisY().setTitle('Fuel Efficiency (km/kWh)').setInterval({start: 1.3, end: 6.5});
  const boxes = context.engine.ChartXY({container: cells[3], theme: context.theme}).setTitle('Horsepower by fuel').setTitleFont(new FontSettings({size: 13, weight: 400})); boxes.setPadding({left: -7, right: -7, top: -8, bottom: -2}); boxes.getDefaultAxisX().setInterval({start: .4, end: 4.6}).setTickStrategy('numeric', (strategy: any) => strategy.setMajorTickPlacement(() => ['Petrol', 'Dsl', 'Elec', 'Hyb'].map((label, i) => ({position: i + 1, label})))); boxes.getDefaultAxisY().setTitle('Horsepower (hp)').setInterval({start: 100, end: 560});
  const points = parallelFixtures.fuels.map((fuel, i) => scatter.addPointSeries().setName(fuel).setPointSize(6).setPointFillStyle(fill(parallelFixtures.fuelColors[i]))), boxSeries = parallelFixtures.fuels.map((fuel, i) => boxes.addBoxSeries().setName(fuel).setFillStyle(fill(parallelFixtures.fuelColors[i])).setStrokeStyle(line('#d7da39'))), outliers = boxes.addPointSeries().setPointSize(5).setPointFillStyle(fill('#e6e6d2'));
  let summary = summarizeCars([]), selectedRows: CarRecord[] = [];
  const refresh = () => {selectedRows = chart.getFilteredData() as CarRecord[]; summary = summarizeCars(selectedRows); const bars: any[] = []; summary.counts.forEach((row, index) => {let start = 0; row.fuels.forEach((value, fuelIndex) => {if (value) bars.push({category: row.name, row: index, start, value, color: parallelFixtures.fuelColors[fuelIndex]}); start += value;});});
    counts.setCategories(summary.counts.map(row => row.name)).setValueInterval({start: 0, end: Math.max(1, ...summary.counts.map(row => row.fuels.reduce((sum, value) => sum + value, 0)))}).setData(bars);
    averages.setData(summary.averages.map((row, i) => ({category: row.fuel, value: row.price, color: parallelFixtures.fuelColors[i]}))).setValueInterval({start: 0, end: Math.max(10, ...summary.averages.map(row => row.price)) * 1.12});
    outliers.clear(); parallelFixtures.fuels.forEach((fuel, i) => {const rows = selectedRows.filter(row => row.Fuel === fuel); points[i].clear().add(rows.map(row => ({x: row.Weight, y: row.FuelEfficiency}))); boxSeries[i].clear(); const stats = summary.averages[i].horsepower; if (stats) {boxSeries[i].add([{x: i + 1, width: .65, ...stats}]); outliers.add(stats.outliers.map(y => ({x: i + 1, y})));}});
  };
  const token = chart.on('filterchange', refresh); chart.setRangeFilter('Price', {start: 20, end: 100}).setRangeFilter('Horsepower', {start: 200, end: 550}); refresh();
  return {charts: [chart, counts, averages, scatter, boxes], dispose: () => {chart.off(token); wrapper.remove();}, snapshot: () => snapshot(chart, {panelCount: 5, selectedCars: selectedRows.length, manufacturerCounts: summary.counts, averages: summary.averages, scatterSamples: points.reduce((sum, series) => sum + series.getSampleCount(), 0), boxes: boxSeries.map(series => series.getSampleCount()), dataProvenance: {kind: 'mixed-reference-and-independent', referenceValues: ['nine manufacturer names', 'fuel types', 'Phoenix Helios tooltip'], independentlyGenerated: ['53 vehicle records and their resulting aggregates']}})};
}

export const parallelEntries: OfficialEntry[] = [
  {id: 'crychart-example-1700-parallelCoordChartSimple', title: '三维平滑平行坐标 · 1700', description: '三条记录跨 A/B/C 三个独立数值轴；轴附近显示该维度各样本的值。', observed: ["三条记录跨 A/B/C 三个独立数值轴；轴附近显示该维度各样本的值。"], gaps: ["悬停命中容差和提示框排版仍待完整核对。"], mount: context => mountSimple(context)},
  {id: 'crychart-example-1701-parallelCoordChartHeavyDataSet', title: '大型训练数据平行坐标 · 1701', description: '12 维训练记录，包含连续指标和离散超参数；8192 条原始记录全部保留，可高亮查看单条。', observed: ["12 维训练记录，包含连续指标和离散超参数；8192 条原始记录全部保留，可高亮查看单条。"], gaps: ["本库场景的功能、交互和资源占用需在目标运行环境验证。"], mount: mountHeavy},
  {id: 'crychart-example-1702-parallelCoordChartLUT', title: '准确率颜色映射 · 1702', description: '四维曲线按 accuracy 从红到黄到绿着色；右侧色标与单条高亮联动。', observed: ["四维曲线按 accuracy 从红到黄到绿着色；右侧色标与单条高亮联动。"], gaps: ["精确 LUT 插值与边界配置未读取；使用独立的三色线性映射。"], mount: context => mountLUT(context)},
  {id: 'crychart-example-1703-parallelCoordChartCategoryAxis', title: '日期、时长与分类混合轴 · 1703', description: '训练日期、距离、时长、鞋品牌和两项分类共六轴，原始日期与字符串保留。', observed: ["训练日期、距离、时长、鞋品牌和两项分类共六轴，原始日期与字符串保留。"], gaps: ["本库场景的功能、交互和资源占用需在目标运行环境验证。"], mount: mountCategory},
  {id: 'crychart-example-1704-parallelCoordChartThresholds', title: '各维度阈值区间 · 1704', description: 'A、B、C 轴以红色显示各自阈值区间；保留三条记录的实际值与高亮提示。', observed: ["A、B、C 轴以红色显示各自阈值区间；保留三条记录的实际值与高亮提示。"], gaps: ["C 最低红区边界由可见刻度和几何估计，未读取原配置。","本库场景的功能、交互和资源占用需在目标运行环境验证。"], mount: context => mountSimple(context, true)},
  {id: 'crychart-example-1705-parallelCoordChartRangeSelectors', title: '轴区间筛选与数据表 · 1705', description: 'accuracy 初始范围 .85–1；拖动筛选范围会实际更新表格，表格选行与曲线选择同步。', observed: ["accuracy 初始范围 .85–1；拖动筛选范围会实际更新表格，表格选行与曲线选择同步。"], gaps: ["本库场景的功能、交互和资源占用需在目标运行环境验证。"], mount: context => mountLUT(context, true)},
  {id: 'crychart-example-1706-parallelCoordChartRealTime', title: '五维流式平行坐标 · 1706', description: '红色五维记录持续追加，保留最近 96 条，B–E 轴随时间扩展。', observed: ["红色五维记录持续追加，保留最近 96 条，B–E 轴随时间扩展。"], gaps: ["本库场景的功能、交互和资源占用需在目标运行环境验证。"], mount: mountRealTime},
  {id: 'crychart-example-1707-parallelCoordChartDashboard', title: '汽车特征筛选仪表盘 · 1707', description: '上方四维价格/马力/重量/能效筛选，实际驱动下方品牌计数、燃料均价、重量散点和马力箱图。', observed: ["上方四维价格/马力/重量/能效筛选，实际驱动下方品牌计数、燃料均价、重量散点和马力箱图。"], gaps: ["本库场景的功能、交互和资源占用需在目标运行环境验证。"], mount: mountDashboard},
];
