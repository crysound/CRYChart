import { ColorRGBA, LUT, PalettedFill, SolidFill, SolidLine, emptyLine } from '../../src/index';
import { createXY } from './helpers';
import { configureDates, dateLabel, day, legend, pointCursor, sharedCursor, xNavigation, type Trace } from './controls';
import { capacityForecast, ecgValue, parseDiamonds, stackColumns, sweptValues, symlogSegments, trackTelemetry, type Sample } from './completion-data';
import type { OfficialEntry, OfficialMountContext, OfficialMounted } from './types';

const colors = [ColorRGBA(241, 213, 71), ColorRGBA(90, 195, 219), ColorRGBA(224, 139, 103), ColorRGBA(190, 135, 204), ColorRGBA(112, 197, 133), ColorRGBA(225, 169, 190), ColorRGBA(99, 138, 217), ColorRGBA(223, 93, 126)];
const fill = (index: number, alpha = 255) => new SolidFill({ color: colors[index % colors.length].setA(alpha) });
const line = (index: number, thickness = 1.7, alpha = 255) => new SolidLine({ fillStyle: fill(index, alpha), thickness });
const provenance = { kind: 'independent-synthetic', description: 'Original deterministic example data; public example behavior is the specification, not vendor implementation.' };
const gap = "本库场景的功能、交互和资源占用需在目标运行环境验证。";
const chartXY = (context: OfficialMountContext, title: string) => {
  const result = createXY(context, title);
  result.chart.legend.setOptions({ visible: false }); result.chart.setCursorMode(undefined);
  return result;
};
function trace(chart: any, name: string, points: Sample[], index: number, kind = 'line', options: Record<string, unknown> = {}): Trace {
  const series = kind === 'area' ? chart.addAreaSeries(options).setAreaFillStyle(fill(index, 105)).setAreaBaseline(0) : kind === 'spline' ? chart.addSplineSeries(options) : chart.addLineSeries(options);
  series.setName(name).setStrokeStyle(line(index)).add(points);
  return { name, points, series, color: colors[index % colors.length].toCSS() };
}
function interactions(context: OfficialMountContext, chart: any, traces: Trace[], reset: () => void, dates = false, both = false) {
  reset();
  const cleanup = [legend(context.host, traces), sharedCursor(chart, traces, dates ? dateLabel : x => x.toPrecision(7)), xNavigation(chart, reset, () => {}, both)];
  return () => cleanup.forEach(fn => fn());
}
function control(host: HTMLElement, label: string, values: string[], change: (value: string) => void) {
  const row = document.createElement('label'), select = document.createElement('select');
  row.style.cssText = 'display:flex;gap:12px;align-items:center;padding:6px 12px;color:#eee'; row.textContent = label;
  select.setAttribute('aria-label', label); values.forEach(value => select.add(new Option(value, value))); select.onchange = () => change(select.value);
  row.append(select); host.prepend(row); return select;
}
function entry(id: string, title: string, description: string, observed: string[], mount: NonNullable<OfficialEntry['mount']>, gaps = [gap]): OfficialEntry {
  return { id: `crychart-example-${id}`, title, description, observed, gaps, mount };
}

function areaExample(context: OfficialMountContext, stacked: boolean): OfficialMounted {
  const { chart } = chartXY(context, stacked ? 'Proportion of versions over time' : 'Product version distribution');
  const count = stacked ? 480 : 330, start = Date.UTC(2017, 0, 1), columns = colors.slice(0, 5).map((_, j) => Array.from({ length: count }, (_, i) => 2 + 20 * Math.exp(-1 * ((i / count - j / 5) / .24) ** 2)));
  for (let i = 0; i < count; i++) { const sum = columns.reduce((n, column) => n + column[i], 0); columns.forEach(column => { column[i] *= 100 / sum; }); }
  const layers = stackColumns(columns).layers;
  const traces = columns.map((column, j) => {
    const points = column.map((y, i) => ({ x: start + i * day, y })), name = `Version ${j + 1}`;
    if (!stacked) return trace(chart, name, points, j, 'area');
    const series = chart.addAreaRangeSeries().setName(name).setHighFillStyle(fill(j, 210)).setStrokeStyle(line(j, .6)).add(layers[j].map((range, i) => ({ x: points[i].x, ...range })));
    return { name, color: colors[j].toCSS(), points: points.map((point, i) => ({ ...point, y: layers[j][i].high })), series, pointLabel: (point: Sample) => `${column[Math.round((point.x - start) / day)].toFixed(2)}%` };
  });
  configureDates(chart); chart.axisY.setTitle(stacked ? 'Distribution (%)' : 'Percentage');
  const dispose = interactions(context, chart, traces, () => { chart.axisX.setInterval({ start, end: start + (count - 1) * day }); chart.axisY.setInterval({ start: 0, end: stacked ? 100 : 70 }); }, true);
  return { charts: [chart], traces, dispose, snapshot: () => ({ dataProvenance: provenance, stacked, count, columns, expectedRanges: stacked ? layers : undefined, baseline: 0, totalPerSample: columns[0].map((_, i) => columns.reduce((n, c) => n + c[i], 0)) }) };
}

function temperatureRange(context: OfficialMountContext): OfficialMounted {
  const { chart } = chartXY(context, 'Daily temperature range, April 2019'), start = Date.UTC(2019, 3, 1);
  const observed = Array.from({ length: 30 }, (_, i) => ({ x: start + i * day, low: 8 + 4 * Math.sin(i / 3), high: 19 + 5 * Math.sin(i / 3 + .3) }));
  const records = observed.map((row, i) => ({ x: row.x, low: row.low - 5 - Math.cos(i), high: row.high + 6 + Math.sin(i) }));
  const traces = [records, observed].map((rows, index) => {
    const name = index ? '2019 temperatures' : 'Temperature records range', series = chart.addAreaRangeSeries().setName(name).setHighFillStyle(fill(index, index ? 150 : 65)).setStrokeStyle(line(index, 1)).add(rows);
    return { name, series, color: colors[index].toCSS(), points: rows.map(row => ({ x: row.x, y: row.high })), pointLabel: (point: Sample) => { const row = rows[Math.round((point.x - start) / day)]; return `${row.low.toFixed(1)} – ${row.high.toFixed(1)} °C`; } };
  });
  configureDates(chart); chart.axisY.setTitle('Temperature (°C)');
  return { charts: [chart], traces, dispose: interactions(context, chart, traces, () => { chart.axisX.setInterval({ start, end: start + 29 * day }); chart.axisY.setInterval({ start: 0, end: 35 }); }, true), snapshot: () => ({ dataProvenance: provenance, expectedRanges: [records, observed], dates: 30 }) };
}

function diamonds(context: OfficialMountContext): OfficialMounted {
  const { chart: main } = chartXY(context, '53,940 diamonds · carat / price / clarity');
  const box = document.createElement('div'); box.style.cssText = 'position:absolute;left:75px;top:48px;width:260px;height:170px;z-index:4;display:flex;border:1px solid #666;background:#101112'; main.root.append(box);
  const { chart: overview, caption } = chartXY({ ...context, host: box }, ''); caption.remove(); overview.setPadding({ left: -58, right: -14, top: -44, bottom: -45 }); overview.axisX.setVisible(false); overview.axisY.setVisible(false); overview.setUserInteractions(false);
  const selected = document.createElement('div'); selected.className = 'diamond-window'; selected.style.cssText = 'position:absolute;z-index:6;border:2px solid #eee06a;background:#e6d64e22;cursor:move;touch-action:none;box-sizing:border-box'; overview.root.append(selected);
  const abort = new AbortController(), traces: Trace[] = [], cleanups: Array<() => void> = [], bounds = { x0: 0, x1: 5.2, y0: 0, y1: 20000 };
  const lut = new LUT({ steps: colors.map((color, value) => ({ color, value })), interpolate: false });
  let ready = false, error: string | undefined, data: ReturnType<typeof parseDiamonds> = [], drag: { x: number; y: number; edges: string; a: any; b: any } | undefined;
  const setView = (a: any, b: any) => { main.axisX.setInterval(a); main.axisY.setInterval(b); };
  const reset = () => setView({ start: bounds.x0, end: bounds.x1 }, { start: bounds.y0, end: bounds.y1 }); reset();
  overview.axisX.setInterval({ start: bounds.x0, end: bounds.x1 }); overview.axisY.setInterval({ start: bounds.y0, end: bounds.y1 });
  main.axisX.setTitle('Carat'); main.axisY.setTitle('Price ($)');
  const positionWindow = () => { const a = main.axisX.getInterval(), b = main.axisY.getInterval(), p = overview.plot;
    const x = (v: number) => p.left + overview.axisX.valueToFraction(v) * p.width, y = (v: number) => p.top + (1 - overview.axisY.valueToFraction(v)) * p.height;
    selected.style.left = `${x(a.start)}px`; selected.style.top = `${y(b.end)}px`; selected.style.width = `${x(a.end) - x(a.start)}px`; selected.style.height = `${y(b.start) - y(b.end)}px`;
  };
  const tx = main.axisX.onIntervalChange(positionWindow), ty = main.axisY.onIntervalChange(positionWindow), rt = overview.on('render', positionWindow);
  cleanups.push(() => main.axisX.offIntervalChange(tx), () => main.axisY.offIntervalChange(ty), () => overview.off(rt), xNavigation(main, reset, () => {}, true));
  for (const edge of ['nw', 'ne', 'sw', 'se']) { const handle = document.createElement('div'); handle.dataset.edge = edge; handle.className = 'diamond-handle'; handle.style.cssText = `position:absolute;width:10px;height:10px;background:#eee06a;${edge.includes('n') ? 'top' : 'bottom'}:-6px;${edge.includes('w') ? 'left' : 'right'}:-6px;cursor:${edge}-resize;touch-action:none`; selected.append(handle); }
  selected.addEventListener('pointerdown', event => { drag = { x: event.clientX, y: event.clientY, edges: (event.target as HTMLElement).dataset.edge ?? '', a: main.axisX.getInterval(), b: main.axisY.getInterval() }; selected.setPointerCapture(event.pointerId); event.stopPropagation(); event.preventDefault(); }, { signal: abort.signal });
  selected.addEventListener('pointermove', event => {
    if (!drag) return; const dx = (event.clientX - drag.x) / overview.plot.width * (bounds.x1 - bounds.x0), dy = -(event.clientY - drag.y) / overview.plot.height * (bounds.y1 - bounds.y0), a = { ...drag.a }, b = { ...drag.b };
    if (!drag.edges) { const sx = Math.max(bounds.x0 - a.start, Math.min(bounds.x1 - a.end, dx)), sy = Math.max(bounds.y0 - b.start, Math.min(bounds.y1 - b.end, dy)); a.start += sx; a.end += sx; b.start += sy; b.end += sy; }
    else { if (drag.edges.includes('w')) a.start = Math.max(bounds.x0, Math.min(a.end - .01, a.start + dx)); if (drag.edges.includes('e')) a.end = Math.min(bounds.x1, Math.max(a.start + .01, a.end + dx)); if (drag.edges.includes('n')) b.end = Math.min(bounds.y1, Math.max(b.start + 30, b.end + dy)); if (drag.edges.includes('s')) b.start = Math.max(bounds.y0, Math.min(b.end - 30, b.start + dy)); }
    setView(a, b); event.stopPropagation();
  }, { signal: abort.signal });
  const end = () => { drag = undefined; }; for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) selected.addEventListener(type, end, { signal: abort.signal });
  fetch('/examples/data/diamonds.csv', { signal: abort.signal }).then(response => { if (!response.ok) throw new Error(`Diamond dataset HTTP ${response.status}`); return response.text(); }).then(csv => {
    if (abort.signal.aborted) return; data = parseDiamonds(csv); if (data.length !== 53940) throw new Error(`Unexpected diamond count ${data.length}`);
    for (const chart of [main, overview]) {
      const series = chart.addPointSeries().setName('Diamonds').setPointSize(chart === main ? 3 : 1).setIndividualPointValueEnabled(true).setPointFillStyle(new PalettedFill({ lut, lookUpProperty: 'value' })).add(data);
      if (chart === main) traces.push({ name: 'Diamonds', color: colors[0].toCSS(), series, points: data, pointLabel: p => `${p.y} USD · ${(p as typeof data[number]).clarity}` });
    }
    cleanups.push(pointCursor(main, traces, x => `${x} carat`)); ready = true; positionWindow();
  }).catch(reason => { if (!abort.signal.aborted) error = String(reason); });
  return { charts: [main, overview], traces, dispose: () => { abort.abort(); cleanups.forEach(fn => fn()); }, snapshot: () => ({ ready, error, dataProvenance: { kind: 'public-dataset', source: 'seaborn-data/diamonds.csv', records: data.length }, bounds, dragging: Boolean(drag), clarityCounts: Array.from({ length: 8 }, (_, value) => data.reduce((n, p) => n + Number(p.value === value), 0)), overviewSamples: overview.series[0]?.getSampleCount() ?? 0, view: { x: main.axisX.getInterval(), y: main.axisY.getInterval() } }) };
}

function derived(context: OfficialMountContext): OfficialMounted {
  const { chart } = chartXY(context, 'Ferry cargo capacity · derived median, interval and SMA(7)'), model = capacityForecast(), range = chart.addAreaRangeSeries().setName('Prediction interval 10–90%').setHighFillStyle(fill(2, 80)).setStrokeStyle(emptyLine);
  const traces = ['Actual capacity', 'Median prediction', 'SMA(7)'].map((name, i) => trace(chart, name, [], [3, 2, 6][i]));
  let revision = 0, correction = false, values = model.derive();
  const redraw = () => { values = model.derive(); range.clear().add(model.rows.map((r, i) => ({ x: r.x, low: values.low[i], high: values.high[i] })));
    const columns = [model.rows.map(r => r.actual), values.median, values.sma]; traces.forEach((t, j) => { t.points.splice(0, t.points.length, ...model.rows.map((r, i) => ({ x: r.x, y: columns[j][i] }))); t.series.clear().add(t.points); }); revision++;
  }; redraw();
  const button = document.createElement('button'); button.textContent = '修正第 46 天容量 (+700)'; button.dataset.action = 'correct-source'; context.host.prepend(button);
  button.onclick = () => { model.rows[45].actual += correction ? -700 : 700; correction = !correction; button.textContent = correction ? '恢复第 46 天容量' : '修正第 46 天容量 (+700)'; redraw(); };
  configureDates(chart); chart.axisY.setTitle('Cargo capacity');
  const dispose = interactions(context, chart, traces, () => { chart.axisX.setInterval({ start: model.rows[0].x, end: model.rows.at(-1)!.x }); chart.axisY.setInterval({ start: 8000, end: 22000 }); }, true);
  return { charts: [chart], traces, dispose, snapshot: () => ({ dataProvenance: provenance, revision, correction, source: model.rows, derived: values, derivationArchitecture: 'reactive native example model' }) };
}

export const additionalXYEntries: OfficialEntry[] = [
  entry('0002-styledSplines', '样条曲线样式 · 0002', '平滑样条、独立颜色和线宽；图例切换与数据游标。', ['SplineSeries supports solid line styles, immutable style objects and style mutators.'], context => {
    const { chart } = chartXY(context, 'Styled spline series'), widths = [1, 3, 5], traces = widths.map((width, j) => { const t = trace(chart, `Spline ${j + 1}`, Array.from({ length: 31 }, (_, i) => ({ x: i, y: 10 * j + 4 * Math.sin(i / 2 + j) + Math.cos(i * 1.7) })), j, 'spline'); t.series.setStrokeStyle((old: SolidLine) => old.setThickness(width)); return t; });
    return { charts: [chart], traces, dispose: interactions(context, chart, traces, () => { chart.axisX.setInterval({ start: 0, end: 30 }); chart.axisY.setInterval({ start: -6, end: 27 }); }), snapshot: () => ({ dataProvenance: provenance, widths: traces.map(t => t.series.getStrokeStyle().getThickness()), samples: 31, interpolation: 'spline' }) };
  }),
  entry('0014-highPrecisionAxis', '高精度坐标轴 · 0014', '在不同数值原点上验证微小间隔；保留原始双精度样本，缩放与游标直接使用实际坐标。', ['Public high-precision documentation gives start-dependent minimum intervals, including 1 ms at a UNIX epoch.'], context => {
    const { chart } = chartXY(context, 'High precision coordinates'), t = trace(chart, 'Precision samples', [], 0), origins = [0, 100, 10000, 1e6, Date.UTC(2026, 10, 3)], spans = [1e-12, 1e-10, 1e-8, 1e-6, 1]; let scenario = 4;
    const reset = () => { const origin = origins[scenario], span = spans[scenario]; t.points.splice(0, t.points.length, ...Array.from({ length: 21 }, (_, i) => ({ x: origin + span * i / 20, y: Math.sin(i * .6) }))); t.series.clear().add(t.points); chart.axisX.setInterval({ start: origin, end: origin + span }); chart.axisY.setInterval({ start: -1.2, end: 1.2 }); };
    const select = control(context.host, '数值原点', origins.map(String), value => { scenario = origins.indexOf(Number(value)); reset(); }); select.value = String(origins[scenario]);
    chart.axisX.setTickStrategy('numeric', (s: any) => s.setFormattingFunction((v: number) => scenario === 4 ? `+${(v - origins[scenario]).toFixed(3)} ms` : v.toPrecision(16)));
    return { charts: [chart], traces: [t], dispose: interactions(context, chart, [t], reset), snapshot: () => ({ dataProvenance: provenance, scenario, origin: origins[scenario], minimumSpan: spans[scenario], uniqueCoordinates: new Set(t.points.map(p => p.x)).size, samples: t.points.length, referenceRuntime: 'Documentation observed; runtime rendering requires separate reference evidence.' }) };
  }),
  entry('0023-decayingLineChart', '轨迹随时间衰减 · 0023', '连续采集新波形，旧波形透明度按年龄递减，并复用固定数量序列。', ['Multiple line series form a history trail with continuously decreasing opacity.'], context => {
    const { chart } = chartXY(context, 'Decaying signal history'), count = 12, traces = Array.from({ length: count }, (_, i) => trace(chart, `Frame ${i + 1}`, [], 1)); let current = -1, time = 0;
    const update = (elapsed: number) => { time = elapsed; const frame = Math.floor(elapsed * 12); if (frame !== current) { current = frame; traces.forEach((t, age) => { const phase = frame - age; t.points.splice(0, t.points.length, ...Array.from({ length: 400 }, (_, i) => ({ x: i / 4, y: Math.sin(i / 25 + phase / 5) * Math.exp(-1 * ((i - 200) / 170) ** 2) }))); t.series.clear().add(t.points); }); }
      traces.forEach((t, age) => t.series.setStrokeStyle(line(1, age ? 1 : 2, Math.round(255 * Math.exp(-(age + elapsed * 12 - frame) / 3.5)))));
    }; update(0);
    return { charts: [chart], traces, update, dispose: interactions(context, chart, traces, () => { chart.axisX.setInterval({ start: 0, end: 100 }); chart.axisY.setInterval({ start: -1.2, end: 1.2 }); }), snapshot: () => ({ dataProvenance: provenance, frame: current, time, alpha: traces.map(t => t.series.getStrokeStyle().getFillStyle().getColor().getA()), capacity: count }) };
  }),
  entry('0026-temperatureAnomalyChart', '温度异常与二氧化碳 · 0026', '1880–2020 年双纵轴趋势，图内动画图标随渲染更新并参与导出。', ['Two Y axes visualize temperature anomaly and atmospheric CO₂; animated thundercloud icon inside the chart.'], context => {
    const { chart } = chartXY(context, 'Temperature anomaly and atmospheric CO₂ (1880–2020)'), co2 = Array.from({ length: 141 }, (_, i) => ({ x: Date.UTC(1880 + i, 0, 1), y: 285 + .0029 * i ** 2 + .000027 * i ** 3 })), anomaly = co2.map((p, i) => ({ x: p.x, y: -.35 + .000055 * i ** 2 + .12 * Math.sin(i / 3) }));
    const right = chart.addAxisY({ opposite: true }).setTitle('Temperature anomaly (°C)').setInterval({ start: -.7, end: 1.1 }); chart.axisY.setTitle('CO₂ (ppm)');
    const traces = [trace(chart, 'CO₂ (ppm)', co2, 0), trace(chart, 'Temperature anomaly (°C)', anomaly, 2, 'line', { axisY: right })];
    const source = document.createElement('canvas'); source.width = 100; source.height = 85; const sprite = source.getContext('2d')!; let animationFrame = 0, time = 0;
    const draw = () => { const c = chart.overlay.getContext('2d')!; sprite.clearRect(0, 0, 100, 85); sprite.fillStyle = '#c5d2dc'; for (const [x, y, r] of [[30, 30, 18], [50, 21, 21], [72, 32, 17]]) { sprite.beginPath(); sprite.arc(x, y, r, 0, 7); sprite.fill(); } sprite.fillRect(25, 28, 54, 22); sprite.strokeStyle = animationFrame % 8 < 4 ? '#ffe55c' : '#697279'; sprite.lineWidth = 5; sprite.beginPath(); sprite.moveTo(53, 48); sprite.lineTo(43, 65); sprite.lineTo(58, 61); sprite.lineTo(48, 80); sprite.stroke(); c.save(); c.setTransform(chart.dpr, 0, 0, chart.dpr, 0, 0); c.drawImage(source, chart.plot.left + chart.plot.width * .14, chart.plot.top + 15); c.restore(); };
    const token = chart.on('render', draw); configureDates(chart);
    chart.axisX.setTickStrategy('datetime', (s: any) => s.setMajorTickPlacement(({ interval: { start, end } }: { interval: { start: number; end: number } }) => {
      const required = (end - start) / (day * 365.2425 * 8), step = [1, 2, 5, 10, 20, 50, 100, 200, 500].find(value => value >= required) ?? 1000, ticks = [];
      for (let year = Math.ceil(new Date(start).getUTCFullYear() / step) * step; Date.UTC(year, 0, 1) <= end && ticks.length < 12; year += step) if (Date.UTC(year, 0, 1) >= start) ticks.push({ position: Date.UTC(year, 0, 1), label: String(year) });
      if (ticks.length < 2) { const span = end - start; return Array.from({ length: 5 }, (_, index) => ({ position: start + index / 4 * span, label: new Date(start + index / 4 * span).toISOString().slice(0, 10) })); }
      return ticks;
    }));
    const dispose = interactions(context, chart, traces, () => { chart.axisX.setInterval({ start: co2[0].x, end: co2.at(-1)!.x }); chart.axisY.setInterval({ start: 270, end: 430 }); right.setInterval({ start: -.7, end: 1.1 }); }, true);
    return { charts: [chart], traces, update: elapsed => { time = elapsed; const next = Math.floor(time * 10); if (next !== animationFrame) { animationFrame = next; chart.invalidate(); } }, dispose: () => { chart.off(token); dispose(); }, snapshot: () => ({ dataProvenance: provenance, years: [1880, 2020], animationFrame, imageSource: 'original animated Canvas2D sprite', bindings: traces.map(t => t.series.getAxisY().getTitle()) }) };
  }, [gap, '动画使用原创 Canvas 图源；不宣称已支持通用 ImageFill 的 MP4 输入接口。']),
  entry('0031-logBars', '对数分组柱状图 · 0031', '按季度比较三类产品销售额；真实对数坐标、分组柱、货币刻度与图例。', ['Grouped bars use a positive logarithmic Y scale and currency labels.'], context => {
    const { chart } = chartXY(context, 'Quarterly product revenue'), axis = chart.addAxisY({ type: 'logarithmic' }).setTitle('Revenue (€)').setInterval({ start: 1000, end: 1e6 }); chart.axisY.setVisible(false);
    const values = [[152000, 28300, 218000], [32600, 105600, 526900], [18000, 726500, 54600], [96000, 285000, 18700]], traces: Trace[] = [];
    values.forEach((column, q) => { const series = chart.addRectangleSeries({ axisY: axis }).setName(`Q${q + 1}`).setFillStyle(fill(q)).setStrokeStyle(emptyLine); column.forEach((value, product) => series.add({ x: product * 5 + q, y: 1000, width: .8, height: value - 1000 })); traces.push({ name: `Q${q + 1}`, color: colors[q].toCSS(), series, points: column.map((y, p) => ({ x: p * 5 + q + .4, y })) }); });
    chart.axisX.setTickStrategy('numeric', (s: any) => s.setMajorTickPlacement(() => ['Product A', 'Product B', 'Product C'].map((label, i) => ({ position: i * 5 + 1.9, label })))); axis.setTickStrategy('numeric', (s: any) => s.setFormattingFunction((value: number) => `€${value.toLocaleString('en-US')}`));
    return { charts: [chart], traces, dispose: interactions(context, chart, traces, () => { chart.axisX.setInterval({ start: -1, end: 15 }); axis.setInterval({ start: 1000, end: 1e6 }); }), snapshot: () => ({ dataProvenance: provenance, values, scale: axis.type, baseline: 1000, barCount: traces.reduce((n, t) => n + t.series.getSampleCount(), 0) }) };
  }),
  entry('0041-sweepingLineChartNew', '扫掠面积信号 · 0041', '游标向右采集，绕回后覆盖旧值并保留移动空隙；可暂停、缩放和查看采样。', ['A sweeping area series wraps at the right edge and clears stale data before writing.'], context => {
    const { chart } = chartXY(context, 'Sweeping signal · 1,000 samples/s'), capacity = 4000, t = trace(chart, 'Signal', [], 0, 'area'); let next = capacity, revision = -1;
    const update = (elapsed: number) => { next = capacity + Math.floor(elapsed * 1000); if (next === revision) return; revision = next; const values = sweptValues(next, capacity, i => Math.sin(i / 90) * .45 + ecgValue(i, 1000) / 1200, 80); t.points.splice(0, t.points.length, ...values.map((y, x) => ({ x, y }))); t.series.clear().add(t.points); }; update(0);
    return { charts: [chart], traces: [t], update, dispose: interactions(context, chart, [t], () => { chart.axisX.setInterval({ start: 0, end: capacity }); chart.axisY.setInterval({ start: -.9, end: 1.5 }); }), snapshot: () => ({ dataProvenance: provenance, nextSample: next, cursor: next % capacity, capacity, gap: 80, sampleRate: 1000 }) };
  }),
  entry('0052-linePaletteValue', '轨迹指标调色 · 0052', '同一赛车轨迹按速度、加速度或转向角着色，选择指标时同步更新色标和实际值。', ['Track geometry stays fixed while the selected telemetry property controls per-vertex line colors.'], context => {
    const { chart } = chartXY(context, 'Telemetry track'), samples = trackTelemetry(), t = trace(chart, 'Track', [], 0); t.series.setIndividualPointValueEnabled(true); let property = 'speed', palette: LUT;
    const ranges: Record<string, [number, number]> = { speed: [30, 50], acceleration: [-4, 4], steering: [-35, 35] }, scale = document.createElement('div'); scale.style.cssText = 'padding:4px 16px;color:#eee;background:linear-gradient(to right,#eee6,#e43a)'; context.host.append(scale);
    const redraw = () => { const [min, max] = ranges[property]; palette = new LUT({ steps: [{ value: min, color: ColorRGBA(245, 245, 240) }, { value: max, color: ColorRGBA(235, 64, 55) }] }); t.points.splice(0, t.points.length, ...samples.map(p => ({ x: p.x, y: p.y, value: p[property as 'speed'] }))); t.series.clear().setStrokeStyle(new SolidLine({ fillStyle: new PalettedFill({ lut: palette, lookUpProperty: 'value' }), thickness: 6 })).add(t.points); scale.textContent = `${property}: ${min} → ${max}`; }; redraw();
    control(context.host, '轨迹指标', Object.keys(ranges), value => { property = value; redraw(); });
    const dispose = interactions(context, chart, [t], () => { chart.axisX.setInterval({ start: -45, end: 45 }); chart.axisY.setInterval({ start: -26, end: 26 }); }, false, true);
    return { charts: [chart], traces: [t], dispose, snapshot: () => ({ dataProvenance: provenance, property, range: ranges[property], telemetry: samples, palette: palette.getSteps().map(s => ({ value: s.value, color: s.color.toCSS() })) }) };
  }),
  entry('0103-layeredAreas', '分层透明面积图 · 0103', '五个版本的使用比例以独立透明面积叠放，保留零基线和日期坐标。', ['Overlapping translucent areas compare version distributions over time.'], context => areaExample(context, false)),
  entry('0104-stackedMountains', '累计堆叠面积图 · 0104', '每个版本的下界连接前一层上界，总占比保持 100%。', ['AreaRange layers use the previous cumulative magnitude as their lower boundary.'], context => areaExample(context, true)),
  entry('0105-temperatureVariations', '每日温度范围 · 0105', '2019 年四月的日温差和历史纪录范围，图例可独立切换，两端值进入游标。', ['Two temperature ranges display low/high values simultaneously on a date axis.'], temperatureRange),
  entry('0150-ecg', '实时心电图 · 0150', '按每秒 960 个样本追加原创 PQRST 波形；限定历史容量，支持暂停和手动查看。', ['Real-time ECG runs at 960 samples per second with scrolling and progressive data cleaning.'], context => {
    const { chart } = chartXY(context, 'Electrocardiogram · 960 samples/s'), rate = 960, capacity = rate * 12, t = trace(chart, 'ECG', [], 0); t.series.setMaxSampleCount(capacity); let generated = 0, manual = false;
    const append = (target: number) => { const points: Sample[] = []; for (; generated < target; generated++) points.push({ x: generated / rate * 1000, y: ecgValue(generated) }); t.series.add(points); t.points.push(...points); if (t.points.length > capacity) t.points.splice(0, t.points.length - capacity); if (!manual) chart.axisX.setInterval({ start: Math.max(0, generated / rate * 1000 - 5000), end: Math.max(5000, generated / rate * 1000) }); };
    append(rate * 5); chart.axisY.setTitle('µV').setInterval({ start: -700, end: 1200 }); chart.axisX.setTitle('Time (ms)'); const reset = () => { manual = false; append(generated); chart.axisY.setInterval({ start: -700, end: 1200 }); };
    const cleanups = [legend(context.host, [t]), sharedCursor(chart, [t], x => `${(x / 1000).toFixed(3)} s`), xNavigation(chart, reset, () => { manual = true; })];
    return { charts: [chart], traces: [t], update: elapsed => append(rate * 5 + Math.floor(elapsed * rate)), dispose: () => cleanups.forEach(fn => fn()), snapshot: () => ({ dataProvenance: provenance, rate, capacity, generated, manual, retained: t.series.getSampleCount(), first: t.points[0], last: t.points.at(-1) }) };
  }),
  entry('1711-scatterZoomOverlay', '钻石散点与二维概览 · 1711', '完整 53,940 条钻石记录；左上角概览选择框可移动、拉伸并与主图缩放同步。', ['53,940 public diamond records use carat, price and clarity; a movable/resizable overview rectangle controls the main view.'], diamonds, ["本库场景的功能、交互和资源占用需在目标运行环境验证。"]),
  entry('1716-symLog', '正负对称对数坐标 · 1716', '正值对数、零附近线性、负值对数三段连续显示；跨阈值处插值保持连线连续。', ['Three stacked axes implement positive logarithmic, linear center and negative logarithmic regions.'], context => {
    const { chart } = chartXY(context, 'Symmetric logarithmic display'), threshold = 10, center = chart.axisY.setLength({ relative: 2 }).setInterval({ start: -threshold, end: threshold }), upper = chart.addAxisY({ type: 'logarithmic', iStack: 1 }).setLength({ relative: 5 }).setInterval({ start: threshold, end: 1e5 }), lower = chart.addAxisY({ type: 'logarithmic', iStack: -1 }).setLength({ relative: 5 }).setInterval({ start: 1e5, end: threshold });
    lower.setTickStrategy('numeric', (s: any) => s.setFormattingFunction((v: number) => `−${v}`));
    const source = Array.from({ length: 1001 }, (_, i) => ({ x: i / 100, y: Math.sin(i / 50) * (10 ** (Math.abs(Math.sin(i / 190)) * 5) - 1) })), parts = symlogSegments(source, threshold);
    const traces = [trace(chart, 'Positive', parts.positive, 1, 'line', { axisY: upper }), trace(chart, 'Linear', parts.linear, 1, 'line', { axisY: center }), trace(chart, 'Negative', parts.negative, 1, 'line', { axisY: lower })];
    const dispose = interactions(context, chart, traces, () => { chart.axisX.setInterval({ start: 0, end: 10 }); });
    return { charts: [chart], traces, dispose, snapshot: () => ({ dataProvenance: provenance, threshold, source, parts, axisTypes: [lower.type, center.type, upper.type], axes: [lower, center, upper].map(a => ({ interval: a.getInterval(), stack: a.iStack })) }) };
  }),
  entry('1720-derivedDataProperties', '预测区间与派生数据 · 1720', '从每日期望分布生成中位数和 10–90% 区间，并对实际容量计算七日均值；数据修正自动重算。', ['Actual data, median prediction, prediction interval and seven-day SMA share the date domain.'], derived),
];
