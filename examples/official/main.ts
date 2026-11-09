import { cryChart, ColorRGBA, SolidFill, SolidLine, Themes } from '../../src/index';
import { random } from '../signals';
import { configureDates, dateLabel, day, legend, rangeHandles, sharedCursor, xNavigation, type Trace } from './controls';
import { hierarchyEntries } from './hierarchy';
import type { OfficialEntry } from './types';
import { xyEntries } from './xy';
import { advancedXYEntries } from './xy-advanced';
import { heatmapEntries } from './heatmaps';
import { spatialEntries } from './spatial';
import { businessEntries } from './business';
import { strokeEntries } from './strokes';
import { paletteEntries } from './palettes';
import { parallelEntries } from './parallel';
import { mapEntries } from './maps';
import { temporalEntries } from './temporal';
import { precisionEntries } from './precision';
import { interpolationEntries } from './interpolation';
import { polarHeatmapEntries } from './polar-heatmaps';
import { advanced3dEntries } from './advanced3d';
import { spectrogramEntries } from './spectrograms';
import { statisticsEntries } from './statistics';
import { categoricalEntries } from './categorical';
import { interactionEntries } from './interactions';
import { advanced3dExtraEntries } from './advanced3d-extra';
import { dashboardEntries } from './dashboards';
import { largeLinkedXYEntries } from './xy-large-linked';
import { additionalXYEntries } from './additional-xy';
import { additionalSurfaceEntries } from './additional-surfaces';
import { additionalGaugeEntries } from './additional-gauges';
import { annotationImageEntries } from './annotation-images';
import { additionalDashboardEntries } from './additional-dashboards';
import { radioEntries } from './radio';

const definitions: OfficialEntry[] = [
  { id: 'crychart-example-0000-lineSeries', title: '基础双折线 · 0000', description: '两条价格序列、日期横轴、固定价格纵轴、底部图例与共享 X 游标。滚轮缩放 X，左键拖框选择 X 区间。', observed: ["两条价格序列、日期横轴、固定价格纵轴、底部图例与共享 X 游标。滚轮缩放 X，左键拖框选择 X 区间。"], gaps: ["本库场景的功能、交互和资源占用需在目标运行环境验证。"] },
  { id: 'crychart-example-0010-multiChannelLineProgressive', title: '十通道实时监测 · 0010', description: '十个通道各按 1,000 Hz 持续追加。横轴表示每通道采样点数量；纵轴以 Channel 1–10 标出各通道。', observed: ["十个通道各按 1,000 Hz 持续追加。横轴表示每通道采样点数量；纵轴以 Channel 1–10 标出各通道。"], gaps: ["波形由独立公式生成，不复制原始信号。","本库场景的功能、交互和资源占用需在目标运行环境验证。"] },
  { id: 'crychart-example-0550-zoomBandChart', title: '主图与缩放带 · 0550', description: '上方显示三条曲线与散点；下方展示完整日期概览。窗口两侧可分别拉伸，中部可整体移动，主图缩放同步到概览。', observed: ["上方显示三条曲线与散点；下方展示完整日期概览。窗口两侧可分别拉伸，中部可整体移动，主图缩放同步到概览。"], gaps: ["日期范围与样本由独立确定性数据定义。","本库场景的功能、交互和资源占用需在目标运行环境验证。","主图可见范围的 Y 自动适配和光标取值规则需进一步逐点核验。"] },
  ...hierarchyEntries,
  ...xyEntries,
  ...advancedXYEntries,
  ...heatmapEntries,
  ...spatialEntries,
  ...businessEntries,
  ...strokeEntries,
  ...paletteEntries,
  ...parallelEntries,
  ...mapEntries,
  ...temporalEntries,
  ...precisionEntries,
  ...interpolationEntries,
  ...polarHeatmapEntries,
  ...advanced3dEntries,
  ...spectrogramEntries,
  ...statisticsEntries,
  ...categoricalEntries,
  ...interactionEntries,
  ...advanced3dExtraEntries,
  ...dashboardEntries,
  ...largeLinkedXYEntries,
  ...additionalXYEntries,
  ...additionalSurfaceEntries,
  ...additionalGaugeEntries,
  ...annotationImageEntries,
  ...additionalDashboardEntries,
  ...radioEntries,
];
definitions.sort((a,b) => a.id.localeCompare(b.id));

const colors = [ColorRGBA(220, 225, 66), ColorRGBA(225, 149, 58), ColorRGBA(223, 124, 62), ColorRGBA(230, 183, 179), ColorRGBA(212, 132, 160), ColorRGBA(178, 128, 184), ColorRGBA(146, 126, 177), ColorRGBA(122, 143, 185), ColorRGBA(101, 167, 169), ColorRGBA(110, 190, 132)];
const theme = { ...Themes.darkGold, backgroundFillStyle: new SolidFill({ color: ColorRGBA(16, 17, 18) }), chartTitleFillStyle: new SolidFill({ color: ColorRGBA(242, 242, 208) }) };
const root = document.querySelector<HTMLElement>('#official-stage')!, select = document.querySelector<HTMLSelectElement>('#official-example')!;
let cleanup: (() => void) | undefined, frame = 0, paused = false, last = 0, elapsed = 0;
let currentSnapshot = () => ({} as any), advance: ((time: number, delta: number) => void) | undefined;
let currentInspection = () => ({ charts: [] as any[], traces: [] as Trace[], definition: undefined as OfficialEntry | undefined });
let generation = 0, mounts = 0, disposals = 0;
let lastDisposal: Record<string, unknown> | undefined;

function disposeCurrent() {
  generation++;
  cancelAnimationFrame(frame); frame = 0;
  const dispose = cleanup; cleanup = undefined;
  try { dispose?.(); }
  finally {
    advance = undefined;
    root.replaceChildren();
    currentInspection = () => ({ charts: [], traces: [], definition: undefined });
    currentSnapshot = () => ({ referenceId: null, status: 'disposed', charts: [], traces: [], cursorRows: 0 });
  }
  return lastDisposal;
}

const lifecycle = () => ({ mounts, disposals, mounted: Boolean(cleanup), pendingOwnRAF: frame !== 0, chartCount: currentInspection().charts.filter(c => !c.isDisposed?.()).length, lastDisposal });

/** Inspect actual retained samples against the independent point arrays used to populate a trace. */
function auditData(options: { traceIndex?: number; offset?: number; chunkSize?: number } = {}) {
  const traces = currentInspection().traces;
  const traceIndex = options.traceIndex ?? 0, offset = options.offset ?? 0, chunkSize = options.chunkSize ?? 16384;
  if (![traceIndex, offset, chunkSize].every(Number.isInteger) || traceIndex < 0 || offset < 0 || chunkSize < 1 || chunkSize > 16384) throw new RangeError('Invalid bounded audit request');
  const trace = traces[traceIndex];
  if (!trace || !trace.points.length || typeof trace.series.getSample !== 'function') return { supported: false, traceIndex, reason: 'No independent point array and native sample reader; use a module-specific external oracle.' };
  const expectedCount = trace.pointCount ?? trace.points.length;
  if (!Number.isInteger(expectedCount) || expectedCount < 0 || expectedCount > trace.points.length) throw new RangeError('Invalid submitted point count for independent trace audit');
  const actualCount = trace.series.getSampleCount();
  const comparedFields = ['x', 'y', 'z', 'low', 'high', 'value'].filter(field => field in trace.points[0]);
  let mismatchCount = 0, firstMismatch: unknown;
  const end = Math.min(expectedCount, offset + chunkSize);
  for (let i = offset; i < end; i++) {
    const expected = trace.points[i], actual = trace.series.getSample(i);
    if (!actual || comparedFields.some(field => !Object.is(actual[field], (expected as any)[field]))) {
      mismatchCount++;
      firstMismatch ??= { index: i, expected, actual };
    }
  }
  return { supported: true, oracle: 'independent-input-point-array', comparedFields, traceIndex, expectedCount, actualCount, countMatches: expectedCount === actualCount, countCompared: Math.max(0, end - offset), mismatchCount, firstMismatch, nextOffset: end, done: end >= expectedCount };
}

for (const definition of definitions) { const option = document.createElement('option'); option.value = definition.id; option.textContent = definition.title; select.append(option); }

function mount(id: string) {
  const definition = id ? definitions.find(item => item.id === id) : definitions[0];
  if (!definition) throw new RangeError(`Unknown official example: ${id}`);
  disposeCurrent(); root.className = ''; paused = false; last = 0; elapsed = 0; advance = undefined;
  const mountGeneration = generation; mounts++;
  select.value = definition.id;
  document.querySelector('#official-title')!.textContent = definition.title; document.querySelector('#official-description')!.textContent = definition.description;
  const link = document.querySelector<HTMLAnchorElement>('#official-source')!; link.href = `/examples/index.html#reference=${definition.id}`;
  for (const [target, values] of [['#observed-behavior', definition.observed.length ? definition.observed : ["本库场景的功能、交互和资源占用需在目标运行环境验证。"]], ['#open-differences', definition.gaps]] as const) { const list = document.querySelector(target)!; list.replaceChildren(...values.map(value => { const item = document.createElement('li'); item.textContent = value; return item; })); }
  const chartEngine: any = cryChart(), charts: any[] = [], disposers: (() => void)[] = [];
  let traces: Trace[] = [];
  let activeCharts = () => charts;
  let extraSnapshot: (() => Record<string, unknown>) | undefined;
  cleanup = () => {
    const ownedBefore = chartEngine.getChartCount(), mountedCharts = [...activeCharts()], errors: unknown[] = [];
    for (const dispose of disposers) try { dispose(); } catch (error) { errors.push(error); }
    try { chartEngine.dispose(); } catch (error) { errors.push(error); }
    disposals++;
    lastDisposal = { referenceId: definition.id, ownedBefore, ownedAfter: chartEngine.getChartCount(), contextDisposed: chartEngine.isDisposed(), chartsDisposed: mountedCharts.every(c => c.isDisposed?.()), errors: errors.map(String) };
    if (errors.length) throw new AggregateError(errors, 'Official example cleanup failed');
  };
  const chart = (host: HTMLElement, title = '', overview = false) => {
    const c = chartEngine.ChartXY({ container: host, theme }); charts.push(c); c.setPadding({ left: 6, right: -15, top: overview ? -18 : title ? -18 : -44, bottom: -12 });
    c.getDefaultAxisY().setTitleFillStyle(new SolidFill({ color: ColorRGBA(227, 230, 145) }));
    for (const axis of [c.getDefaultAxisX(), c.getDefaultAxisY()]) axis.setTickStrategy('numeric', (strategy: any) => strategy.setMajorTickStyle((style: any) => style.setLabelFillStyle(new SolidFill({ color: ColorRGBA(237, 237, 213) }))));
    if (title) { const caption = document.createElement('div'); caption.className = 'plot-caption'; caption.textContent = title; c.root.append(caption); }
    return c;
  };
  const addTrace = (c: any, name: string, points: Trace['points'], index: number, type = 'line', unit?: string): Trace => {
    const color = colors[index % colors.length], series = type === 'points' ? c.addPointSeries().setPointSize(3).setPointFillStyle(new SolidFill({ color })) : c.addLineSeries().setStrokeStyle(new SolidLine({ fillStyle: new SolidFill({ color }), thickness: 1.6 }));
    series.setName(name).add(points); return { name, points, series, color: color.toCSS(), unit };
  };
  const frameWithLegend = () => { const host = document.createElement('div'); host.className = 'official-main-chart'; root.append(host); return host; };

  if (definition.id === 'crychart-example-0000-lineSeries') {
    const c = chart(frameWithLegend(), 'Diesel and Gasoline Price Comparison'), start = Date.UTC(2022, 0, 1), end = start + 28 * day;
    const levels = Array.from({ length: 29 }, (_, i) => 1.35 + Math.round(Math.sin(i / 3.5) * 4) * 0.08 + (i >= 5 && i < 10 ? 0.25 : 0));
    traces.push(addTrace(c, 'Diesel', levels.map((value, i) => ({ x: start + i * day, y: value })), 0, 'line', '$/litre'));
    traces.push(addTrace(c, 'Gasoline', levels.map((value, i) => ({ x: start + i * day, y: value + 0.26 + Math.round(Math.cos(i / 2.7) * 3) * 0.07 })), 4, 'line', '$/litre'));
    configureDates(c); c.getDefaultAxisY().setTitle('Price ($/litre)').setTickStrategy('numeric', (strategy: any) => strategy.setFormattingFunction((value: number) => value.toFixed(2)));
    const reset = () => { c.getDefaultAxisX().setInterval({ start, end }); c.getDefaultAxisY().setInterval({ start: 0, end: 3 }); }; reset();
    disposers.push(legend(root, traces), sharedCursor(c, traces, dateLabel), xNavigation(c, reset));
  } else if (definition.id === 'crychart-example-0010-multiChannelLineProgressive') {
    const c = chart(frameWithLegend(), 'Multi-channel real-time monitoring (10 chs, 1000 Hz)'), sampleRate = 1000, visibleSamples = 25000;
    c.legend.setOptions({visible:false});
    c.setPadding({ left: 50, right: -15, top: -18, bottom: 6 });
    for (let i = 0; i < 10; i++) { const trace = addTrace(c, `Channel ${i + 1}`, [], i); trace.series.setMaxSampleCount(100000); trace.pointCount = 0; trace.pointAt = index => trace.series.getSample(index); traces.push(trace); }
    c.getDefaultAxisX().setTitle('Data points per channel'); c.getDefaultAxisY().setTickStrategy('numeric', (strategy: any) => strategy.setMajorTickPlacement(() => Array.from({ length: 10 }, (_, i) => ({ position: 10 - i, label: `Channel ${i + 1}` }))));
    const channelLabel = document.createElement('span'); channelLabel.textContent = '< Channels >'; channelLabel.style.cssText = 'position:absolute;top:50%;left:9px;transform:translate(-35%,-50%) rotate(-90deg);color:#e3e691;font-size:13px;pointer-events:none'; c.root.append(channelLabel);
    c.getDefaultAxisY().setInterval({ start: 0.5, end: 11 }); c.getDefaultAxisX().setInterval({ start: -visibleSamples, end: 1000 });
    let sample = 0, following = true, frames = 0, lastMeter = 0;
    const frequencies = [2.8, 3.7, 5.2, 1.9, 0.11, 0.16, 0.7, 1.2, 2.1, 2.6];
    advance = (time) => {
      const target = Math.floor(time * sampleRate), end = Math.min(target, sample + 250);
      if (end > sample) {
        traces.forEach((trace, channel) => {
          const batch = Array.from({ length: end - sample }, (_, j) => { const x = sample + j, t = x / sampleRate; return { x, y: 10 - channel + 0.38 * Math.sin(2 * Math.PI * frequencies[channel] * t + channel * 0.4) + 0.05 * Math.sin(2 * Math.PI * frequencies[channel] * 2.8 * t) }; });
          trace.series.add(batch); trace.pointCount = trace.series.getSampleCount();
        }); sample = end;
        if (following) c.getDefaultAxisX().setInterval({ start: sample - visibleSamples, end: sample + 1000 });
      }
      frames++;
      if (time - lastMeter >= 0.5) { c.root.querySelector('.plot-caption').textContent = `Multi-channel real-time monitoring (10 chs, 1000 Hz) (FPS: ${(frames / (time - lastMeter)).toFixed(1)})`; lastMeter = time; frames = 0; }
    };
    extraSnapshot = () => ({ sampleRate, sampleIndex: sample, historyCapacity: 100000, cursorData: 'native bounded series buffer', duplicatedHistoryObjects: 0 });
    disposers.push(legend(root, traces), sharedCursor(c, traces, value => String(Math.round(value))), xNavigation(c, () => { following = true; c.getDefaultAxisX().setInterval({ start: sample - visibleSamples, end: sample + 1000 }); }, () => { following = false; }));
  } else if (definition.id === 'crychart-example-0550-zoomBandChart') {
    root.classList.add('zoom-layout'); const mainHost = document.createElement('div'), overviewHost = document.createElement('div'); mainHost.className = 'zoom-main'; overviewHost.className = 'zoom-overview'; root.append(mainHost, overviewHost);
    const c = chart(mainHost), overview = chart(overviewHost, 'Zoom Band Chart', true), start = Date.UTC(2001, 0, 1), count = 1000, end = start + (count - 1) * day, rng = random(5550);
    const offsets = [7, 1, -8];
    for (let k = 0; k < 3; k++) { let value = offsets[k]; const points = Array.from({ length: count }, (_, i) => { value += (rng() - 0.5) * 1.3 + (offsets[k] - value) * 0.008; return { x: start + i * day, y: value }; }); traces.push(addTrace(c, `Line ${k}`, points, k)); addTrace(overview, `Line ${k}`, points, k); }
    const scatter = Array.from({ length: count }, (_, i) => ({ x: start + i * day, y: 7 + 4 * Math.sin(i / 25) + (rng() - 0.5) * 9 })); traces.push(addTrace(c, 'Series', scatter, 3, 'points')); addTrace(overview, 'Series', scatter, 3, 'points');
    configureDates(c); configureDates(overview); overview.getDefaultAxisX().setInterval({ start, end }); overview.getDefaultAxisY().setInterval({ start: -16, end: 16 }).setVisible(false); overview.setUserInteractions(false);
    const fitVisible = () => { const interval = c.getDefaultAxisX().getInterval(); let min = Infinity, max = -Infinity; for (const trace of traces) for (const point of trace.points) if (point.x >= interval.start && point.x <= interval.end) { min = Math.min(min, point.y); max = Math.max(max, point.y); } if (Number.isFinite(min) && max > min) c.getDefaultAxisY().setInterval({ start: min - 1, end: max + 1 }); };
    const reset = () => { c.getDefaultAxisX().setInterval({ start: end - 180 * day, end }); fitVisible(); }; reset();
    const fitToken = c.getDefaultAxisX().onIntervalChange(fitVisible); disposers.push(() => c.getDefaultAxisX().offIntervalChange(fitToken));
    disposers.push(rangeHandles(overview, c, { start, end }), sharedCursor(c, traces, dateLabel), xNavigation(c, reset));
  } else if (definition.mount) {
    const mounted = definition.mount({ host: root, engine: chartEngine, theme }); activeCharts = () => mounted.charts; traces = mounted.traces ?? []; advance = mounted.update; extraSnapshot = mounted.snapshot; if (mounted.dispose) disposers.push(mounted.dispose);
  } else {
    const pending = document.createElement('div'); pending.style.cssText = 'padding:55px 40px;color:#c4cbb8;line-height:2'; pending.textContent = "本库场景的功能、交互和资源占用需在目标运行环境验证。"; root.append(pending);
  }

  for (const c of activeCharts()) for (const axis of [...(c.axesX ?? []), ...(c.axesY ?? [])]) {
    axis.tickStrategy.getMajorTickStyle().setLabelFillStyle(new SolidFill({ color: ColorRGBA(237, 237, 213) }));
    axis.setTitleFillStyle(new SolidFill({ color: ColorRGBA(237, 237, 187) }));
  }

  currentSnapshot = () => {
    const moduleDetails = extraSnapshot?.();
    const dataKind = (moduleDetails?.dataProvenance as {kind?:string}|undefined)?.kind;
    return { referenceId: definition.id, mountedId: definition.id, status: activeCharts().length ? 'native-scenario-ready' : 'native-scenario-pending', independentSyntheticData: moduleDetails?.referenceValues !== true && (!dataKind || (dataKind.startsWith('independent-') || dataKind==='deterministic-synthetic-data')), elapsed, paused, traces: traces.map(trace => ({ name: trace.name, samples: trace.series.getSampleCount(), visible: trace.series.getVisible() })), charts: activeCharts().map(c => ({ kind: c.constructor.name, disposed: Boolean(c.isDisposed?.()), x: c.getDefaultAxisX?.()?.getInterval(), y: c.getDefaultAxisY?.()?.getInterval(), z: c.getDefaultAxisZ?.()?.getInterval(), axes: [...(c.axesX ?? []), ...(c.axesY ?? []), ...(c.axesZ ?? [])].map((axis: any) => ({ direction:axis.direction,opposite:axis.opposite,type:axis.type,title:axis.getTitle(),visible:axis.getVisible(),interval:axis.getInterval() })), plot: c.plot, stats: c.getRenderStats?.(), camera: c.getCameraLocation?.() })), cursorRows: root.querySelectorAll('.shared-cursor-table:not([hidden]) .cursor-row').length, moduleDetails };
  };
  currentInspection = () => ({ charts: activeCharts(), traces, definition });
  (window as any).__CRY_OFFICIAL__ = { contractVersion: 1, snapshot: () => currentSnapshot(), inspect: () => currentInspection(), mount, dispose: disposeCurrent, lifecycle, auditData, definitions: definitions.map(item => ({ id: item.id, observed: ["CRYChart 原生绘图与交互场景。"], gaps: item.gaps })) };
  const pause = document.querySelector<HTMLButtonElement>('#official-pause')!; pause.disabled = !advance; pause.textContent = advance ? '暂停' : '静态';
  const tick = (now: number) => { frame = 0; if (mountGeneration !== generation || chartEngine.isDisposed()) return; const delta = last ? (now - last) / 1000 : 0; last = now; if (!paused) { elapsed += delta; advance?.(elapsed, delta); } if (mountGeneration === generation && !chartEngine.isDisposed()) frame = requestAnimationFrame(tick); }; frame = requestAnimationFrame(tick);
}

select.onchange = () => { location.hash = select.value; };
document.querySelector<HTMLButtonElement>('#official-reset')!.onclick = () => mount(select.value);
document.querySelector<HTMLButtonElement>('#official-pause')!.onclick = event => { paused = !paused; (event.target as HTMLButtonElement).textContent = paused ? '继续' : '暂停'; last = 0; };
window.addEventListener('hashchange', () => mount(location.hash.slice(1))); window.addEventListener('beforeunload', disposeCurrent);
mount(location.hash.slice(1));
