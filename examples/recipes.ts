import { cryChart, ColorRGBA, SolidFill, SolidLine, PalettedFill, LUT, Themes } from '../src/index';
import { covarianceEllipse, ecg, fiveNumberSummary, heatField, histogram, random, spectrum, steps, waveform } from './signals';

export interface Parameters { points: number; frequency: number; amplitude: number; channels: number; theme: 'dark' | 'light'; }
export interface Demo { update?: (elapsed: number, delta: number) => void; dispose: () => void; count: () => number; }
export interface Recipe {
  id: string; title: string; category: string; description: string;
  references: string[]; features: string[]; controls?: ('points' | 'frequency' | 'amplitude' | 'channels')[];
  limitation?: string; create: (host: HTMLElement, parameters: Parameters) => Demo;
}
const colors = [ColorRGBA(55, 218, 181), ColorRGBA(252, 189, 94), ColorRGBA(117, 164, 255), ColorRGBA(246, 119, 159), ColorRGBA(185, 151, 255), ColorRGBA(97, 206, 235)];
const fill = (index = 0) => new SolidFill({ color: colors[index % colors.length] });
const stroke = (index = 0, thickness = 1.5) => new SolidLine({ fillStyle: fill(index), thickness });
const palette = () => new PalettedFill({ lut: new LUT({ steps: [
  { value: 0, color: ColorRGBA(23, 36, 75) }, { value: 0.3, color: ColorRGBA(57, 94, 170) },
  { value: 0.6, color: ColorRGBA(55, 218, 181) }, { value: 1, color: ColorRGBA(252, 214, 121) },
]}), lookUpProperty: 'value' });

function scope(host: HTMLElement, p: Parameters) {
  const engine: any = cryChart();
  const charts: any[] = [];
  Object.defineProperty(host, 'gallerySnapshot', { configurable: true, value: () => charts.map(chart => ({
    title: chart.getTitle?.() ?? chart.title, disposed: chart.isDisposed?.() ?? chart.disposed,
    x: chart.getDefaultAxisX?.()?.getInterval(), y: chart.getDefaultAxisY?.()?.getInterval(),
    yAxes: chart.axesY?.map((axis: any) => ({ title: axis.getTitle(), type: axis.type, interval: axis.getInterval() })),
    stats: chart.getRenderStats?.(),
    value: chart.getValue?.(), dataRows: Array.isArray(chart.data) ? chart.data.length : undefined,
    firstRows: Array.isArray(chart.data) ? chart.data.slice(0, 3) : undefined,
    sortKey: chart.sortKey, ascending: chart.ascending,
    series: chart.getSeries?.().map((series: any) => ({ name: series.getName?.(), kind: series.kind, sampleCount: series.getSampleCount?.(), visible: series.getVisible?.() })),
  })) });
  const options = (container: HTMLElement = host) => ({ container, theme: p.theme === 'light' ? Themes.light : Themes.darkGold });
  const make = (kind = 'ChartXY', container = host) => {
    const chart = engine[kind](options(container)); charts.push(chart); return chart;
  };
  const xy = (title: string, container = host) => {
    const chart = make('ChartXY', container); chart.setTitle(title); return chart;
  };
  return { make, xy, dispose: () => { for (const chart of charts) chart.dispose(); engine.dispose?.(); } };
}
function intervals(chart: any, x0: number, x1: number, y0: number, y1: number) {
  chart.getDefaultAxisX().setInterval({ start: x0, end: x1 });
  chart.getDefaultAxisY().setInterval({ start: y0, end: y1 });
}
function line(chart: any, name: string, color = 0, options = {}) {
  return chart.addLineSeries(options).setName(name).setStrokeStyle(stroke(color));
}
function panel(host: HTMLElement, count: number) {
  host.classList.add('chart-grid');
  host.style.gridTemplateColumns = count === 2 ? 'repeat(2,minmax(0,1fr))' : 'repeat(2,minmax(0,1fr))';
  return Array.from({ length: count }, () => { const cell = document.createElement('div'); cell.className = 'chart-cell'; host.append(cell); return cell; });
}
function staticDemo(s: ReturnType<typeof scope>, count: number): Demo { return { dispose: s.dispose, count: () => count }; }

export const recipes: Recipe[] = [
  {
    id: 'range', title: '温度上下界区间', category: '面积与统计',
    description: '上下两条边界定义温度波动范围，填充仅位于边界之间，中心线表示名义温度。',
    references: ['0105-temperatureVariations'], features: ['可变上下界', '范围填充', '中心趋势'], controls: ['amplitude'],
    create(host, p) { const s = scope(host, p), c = s.xy('温度范围 / °C'), values = Array.from({ length: 1000 }, (_, i) => { const center = 30 + 6 * Math.sin(i / 160), width = p.amplitude * (2 + Math.sin(i / 80) * 0.8); return { x: i / 25, yLow: center - width, yHigh: center + width }; }); c.addRangeSeries().setName('温度范围').setFillStyle(new SolidFill({ color: ColorRGBA(55, 218, 181, 90) })).setStrokeStyle(stroke()).add(values); line(c, '中心温度', 1).add(values.map(point => ({ x: point.x, y: (point.yLow + point.yHigh) / 2 }))); intervals(c, 0, 40, 15, 45); return staticDemo(s, values.length * 2); },
  },
  {
    id: 'boxplot', title: '批次分布与异常点', category: '面积与统计',
    description: '从固定样本计算五数概括，以箱须显示四分位数和中位数，独立点标出额外异常记录。',
    references: ['0600-boxPlot'], features: ['样本分位数', '箱须几何', '异常点'],
    create(host, p) { const s = scope(host, p), c = s.xy('批次 / 测量值'), rng = random(223); const summaries = Array.from({ length: 5 }, (_, i) => ({ x: i + 1, width: 0.55, ...fiveNumberSummary(Array.from({ length: 120 }, () => 12 + i * 3 + (rng() + rng() + rng() - 1.5) * 8)) })); c.addBoxSeries().setFillStyle(new SolidFill({ color: ColorRGBA(55, 218, 181, 100) })).setStrokeStyle(stroke(0, 2)).add(summaries); c.addPointSeries().setPointFillStyle(fill(1)).setPointSize(7).add([{ x: 1, y: 25 }, { x: 3, y: 4 }, { x: 5, y: 38 }]); intervals(c, 0.3, 5.7, 0, 42); return staticDemo(s, 603); },
  },
  {
    id: 'span', title: '工序起止范围', category: '业务图表',
    description: '每个矩形从工序开始时刻延伸到结束时刻，比较并行工序及其重叠关系。',
    references: ['0303-spanChart'], features: ['范围柱', '非零起点', '重叠任务'],
    create(host, p) { const s = scope(host, p), c = s.xy('时间 / 分钟 · 工序'); const tasks = [{ x: 0, y: 1, width: 6, height: 0.6 }, { x: 4, y: 2, width: 9, height: 0.6 }, { x: 8, y: 3, width: 5, height: 0.6 }, { x: 11, y: 4, width: 7, height: 0.6 }, { x: 16, y: 5, width: 4, height: 0.6 }]; tasks.forEach((task, i) => c.addRectangleSeries().setFillStyle(fill(i)).setStrokeStyle(stroke(i)).add([task])); intervals(c, -1, 22, 0, 6); return staticDemo(s, tasks.length); },
  },
  {
    id: 'mosaic', title: '类别构成矩形图', category: '面积与统计',
    description: '列宽对应各批次的总样本数，列内矩形高度对应条件比例，因此面积表达联合数量。',
    references: ['0304-mosaicChart'], features: ['联合数量', '宽高双重编码', '条件比例'],
    create(host, p) { const s = scope(host, p), c = s.xy('批次样本份额 / 分类比例'), counts = [[30, 15, 5], [20, 30, 10], [10, 20, 40]], total = counts.flat().reduce((a, b) => a + b, 0); let x = 0; counts.forEach(group => { const sum = group.reduce((a, b) => a + b, 0), width = sum / total; let y = 0; group.forEach((count, i) => { const height = count / sum; c.addRectangleSeries().setFillStyle(fill(i)).setStrokeStyle(new SolidLine({ fillStyle: new SolidFill({ color: ColorRGBA(16, 25, 35) }), thickness: 2 })).add([{ x, y, width, height }]); y += height; }); x += width; }); intervals(c, 0, 1, 0, 1); return staticDemo(s, 9); },
  },
  {
    id: 'violin', title: '概率密度与箱须', category: '面积与统计',
    description: '对独立生成的三组数据做高斯核密度估计，左右对称轮廓与对应箱须展示同一分布。',
    references: ['0601-boxPlotAndViolin'], features: ['核密度估计', '闭合多边形', '分位数叠加'],
    create(host, p) { const s = scope(host, p), c = s.xy('分布形状 / 测量值'), rng = random(231); for (let k = 0; k < 3; k++) { const samples = Array.from({ length: 256 }, () => (rng() + rng() + rng() - 1.5) * (1 + k * 0.3) + (k === 2 && rng() > 0.5 ? 2 : 0)); const grid = Array.from({ length: 101 }, (_, i) => { const y = -4 + i * 0.1, density = samples.reduce((sum, value) => sum + Math.exp(-0.5 * ((y - value) / 0.3) ** 2), 0) / (samples.length * 0.3 * Math.sqrt(2 * Math.PI)); return { x: k + 1 + density * 0.8, y }; }); const points = [...grid, ...[...grid].reverse().map(point => ({ x: 2 * (k + 1) - point.x, y: point.y }))]; c.addPolygonSeries().setFillStyle(new SolidFill({ color: colors[k].setA(100) })).setStrokeStyle(stroke(k)).add({ points }); c.addBoxSeries().setFillStyle(new SolidFill({ color: ColorRGBA(255, 255, 255, 50) })).setStrokeStyle(stroke(1, 2)).add([{ x: k + 1, width: 0.12, ...fiveNumberSummary(samples) }]); } intervals(c, 0.4, 3.6, -4, 6); return staticDemo(s, 768); },
  },
  {
    id: 'annotations', title: '可编辑时序标注', category: '二维曲线',
    description: '添加标注后拖动标签改变它的时间位置；标注锚点沿曲线移动，点击标签上的 × 删除。',
    references: ['0045-timeSeriesAnnotations'], features: ['添加标注', '沿时间拖动', '独立删除'],
    create(host, p) {
      const s = scope(host, p), c = s.xy('测量记录与人工标注'), data = waveform(1200, 100, 0.4); line(c, '测量值').add(data); intervals(c, 0, 12, -1.5, 1.5);
      const markers: { node: HTMLDivElement; time: number; id: number }[] = []; let next = 1;
      const valueAt = (time: number) => Math.sin(2 * Math.PI * 0.4 * time) + 0.22 * Math.sin(2 * Math.PI * 1.2 * time);
      const place = () => markers.forEach(marker => { const point = c.translatePoint({ x: marker.time, y: valueAt(marker.time) }, c.coordsAxis, c.coordsPixel); marker.node.style.left = `${point.x}px`; marker.node.style.top = `${point.y}px`; marker.node.dataset.time = String(marker.time); marker.node.firstChild!.textContent = `标注 ${marker.id} · ${marker.time.toFixed(2)} s `; });
      const add = () => {
        const node = document.createElement('div'); node.className = 'annotation-marker'; node.style.cssText = 'position:absolute;transform:translate(-50%,-120%);z-index:4;padding:6px 7px;border:1px solid #fcbd5e;background:#2d281ef2;color:#f9d494;border-radius:5px;font:11px sans-serif;cursor:grab;white-space:nowrap;touch-action:none';
        const text = document.createElement('span'), remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.style.cssText = 'border:0;background:transparent;color:inherit;padding:0 2px;cursor:pointer'; node.append(text, remove);
        const marker = { node, time: 2 + ((next - 1) * 2.5) % 8, id: next++ }; remove.setAttribute('aria-label', `删除标注 ${marker.id}`); markers.push(marker); c.root.append(node); place();
        remove.onclick = event => { event.stopPropagation(); const at = markers.indexOf(marker); if (at >= 0) markers.splice(at, 1); node.remove(); };
        let dragging = false;
        node.onpointerdown = event => { if (event.target === remove) return; dragging = true; event.stopPropagation(); event.preventDefault(); node.setPointerCapture(event.pointerId); };
        node.onpointermove = event => { if (!dragging) return; const rect = c.root.getBoundingClientRect(), point = c.translatePoint({ x: event.clientX - rect.left, y: event.clientY - rect.top }, c.coordsPixel, c.coordsAxis); marker.time = Math.max(0, Math.min(12, point.x)); place(); };
        node.onpointerup = event => { dragging = false; if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId); };
        node.onpointercancel = () => { dragging = false; };
      };
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button'; button.textContent = '添加标注'; button.style.cssText = 'position:absolute;right:20px;top:9px;z-index:4'; button.onclick = add; c.root.append(button); add();
      const token = c.on('render', place);
      return { dispose: () => { c.off('render', token); s.dispose(); }, count: () => data.length + markers.length };
    },
  },
  {
    id: 'step', title: '阶梯插值的三个位置', category: '二维曲线',
    description: '相同采样分别在前端、中点和后端发生阶跃。三条线错开排列，便于比较转换位置。',
    references: ['0005-stepPlot'], features: ['前端阶梯', '中点阶梯', '后端阶梯'],
    create(host, p) { const s = scope(host, p), c = s.xy('阶跃位置比较'), values = [1, 3, 2, 4, 1, 2]; (['before', 'middle', 'after'] as const).forEach((placement, k) => line(c, placement, k).add(steps(values.map((y, x) => ({ x, y: y + k * 5 })), placement))); intervals(c, -0.2, 5.2, 0, 15); return staticDemo(s, 38); },
  },
  {
    id: 'point-line', title: '带采样标记的折线', category: '二维曲线',
    description: '每个原始采样点以圆点标出，连续线段显示相邻记录的趋势，便于辨认稀疏测量。',
    references: ['0003-pointLinePlot'], features: ['原始采样点', '相邻点连线'], controls: ['amplitude'],
    create(host, p) { const s = scope(host, p), c = s.xy('稀疏测量 · s'), data = waveform(35, 10, 0.6, p.amplitude); line(c, '趋势').add(data); c.addPointSeries().setPointFillStyle(fill(1)).setPointSize(7).add(data); intervals(c, 0, 3.5, -1.5 * p.amplitude, 1.5 * p.amplitude); return staticDemo(s, data.length * 2); },
  },
  {
    id: 'logarithmic', title: '跨数量级的增长曲线', category: '二维曲线',
    description: '对数纵轴呈现多个数量级的数值，指数增长在此坐标中成为直线。',
    references: ['0030-logLine'], features: ['对数纵轴', '指数数据'],
    create(host, p) { const s = scope(host, p), c = s.xy('指数增长 · 对数轴'), log = c.addAxisY({ type: 'logarithmic', opposite: true }); c.getDefaultAxisY().setVisible(false); log.setInterval({ start: 1, end: 10000 }); line(c, '指数曲线', 0, { axisY: log }).add(Array.from({ length: 401 }, (_, i) => ({ x: i / 40, y: 10 ** (i / 100) }))); c.getDefaultAxisX().setInterval({ start: 0, end: 10 }); return staticDemo(s, 401); },
  },
  {
    id: 'microseconds', title: '大原点上的微秒采样', category: '二维曲线',
    description: 'X 值带有十亿秒原点，刻度显示相对于原点的微秒偏移，检查大数值下的局部细节。',
    references: ['0008-lineSeriesMicroseconds', '0014-highPrecisionAxis'], features: ['大数值原点', '微秒刻度', '局部精度'],
    create(host, p) { const s = scope(host, p), c = s.xy('相对原点的时间 / μs'), origin = 1e9, data = Array.from({ length: 1001 }, (_, i) => ({ x: origin + i * 1e-6, y: Math.sin(i * 0.02) })); line(c, '微秒采样').add(data); c.getDefaultAxisX().setTickStrategy('numeric', (strategy: any) => strategy.setFormattingFunction((v: number) => `${Math.round((v - origin) * 1e6)} μs`)); intervals(c, origin, origin + 0.001, -1.3, 1.3); return staticDemo(s, data.length); },
  },
  {
    id: 'datetime', title: '带日期原点的时间轴', category: '二维曲线',
    description: '使用固定日期原点，将相对毫秒值转换为时钟刻度。数据不受本机当前日期影响。',
    references: ['0020-dateTimeAxis', '0021-dateTimeAxisOrigin'], features: ['日期原点', '时钟刻度'],
    create(host, p) { const s = scope(host, p), c = s.xy('设备记录 · UTC'); c.getDefaultAxisX().setTickStrategy('datetime', (strategy: any) => strategy.setDateOrigin(Date.UTC(2026, 0, 1, 8))); line(c, '温度').add(Array.from({ length: 601 }, (_, i) => ({ x: i * 1000, y: 40 + 8 * Math.sin(i / 47) }))); intervals(c, 0, 600000, 25, 55); return staticDemo(s, 601); },
  },
  {
    id: 'bands', title: '工作窗口与告警阈值', category: '二维曲线',
    description: '半透明区间带标出关注的时间段，常量参考线标出测量值的告警阈值。',
    references: ['0701-bandsConstantlines', '0036-dashedThresholds'], features: ['时间区间带', '阈值参考线'], controls: ['amplitude'], limitation: '参考例的虚线样式与参考线拖动尚待验证。',
    create(host, p) { const s = scope(host, p), c = s.xy('关注窗口 / 告警阈值'); line(c, '测量值').add(waveform(1200, 100, 0.4, p.amplitude)); c.getDefaultAxisX().addBand().setStart(4).setEnd(7).setFillStyle(new SolidFill({ color: ColorRGBA(117, 164, 255, 40) })); c.getDefaultAxisY().addConstantLine().setValue(0.8).setText('告警阈值').setStrokeStyle(stroke(1)); intervals(c, 0, 12, -p.amplitude * 1.5, p.amplitude * 1.5); return staticDemo(s, 1200); },
  },
  {
    id: 'data-gaps', title: '缺失数据不跨段连接', category: '二维曲线',
    description: '两段采样中断以 NaN 明确表达；缺失区间应保持断开，不推测不存在的趋势。',
    references: ['0053-dataGaps'], features: ['缺失值', '分段折线'], limitation: '参考例的面积缺口与缩放概览联动仍待验证。',
    create(host, p) { const s = scope(host, p), c = s.xy('断续采集 · s'); const data = waveform(1200, 100, 0.6).map((point, i) => ({ x: point.x, y: (i >= 300 && i <= 420) || (i >= 800 && i <= 900) ? NaN : point.y })); line(c, '断续采样', 0, { includesNaN: true }).add(data); intervals(c, 0, 12, -1.5, 1.5); return staticDemo(s, data.length); },
  },
  {
    id: 'ellipse', title: '协方差椭圆', category: '面积与统计',
    description: '从散点直接计算样本均值与协方差，再用特征值形成椭圆。幅值参数控制马氏距离半径。',
    references: ['0015-confidenceEllipseXY'], features: ['协方差计算', '相关散点', '椭圆轮廓'], controls: ['amplitude'],
    create(host, p) { const s = scope(host, p), c = s.xy('二维测量的协方差'), rng = random(103); const data = Array.from({ length: 1200 }, () => { const radius = Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))), angle = rng() * 2 * Math.PI, u = radius * Math.cos(angle), v = radius * Math.sin(angle); return { x: 2 * u + 0.5 * v, y: u + 0.8 * v }; }); c.addPointSeries().setPointSize(3).setPointFillStyle(new SolidFill({ color: ColorRGBA(55, 218, 181, 110) })).add(data); line(c, '协方差椭圆', 1).add(covarianceEllipse(data, 2 * p.amplitude)); intervals(c, -8, 8, -5, 5); return staticDemo(s, data.length + 181); },
  },
  {
    id: 'zoom-band', title: '概览窗口与细节联动', category: '二维曲线',
    description: '拖动下方位置滑块，在概览曲线中选择时间窗口。上方主图跟随选择显示局部细节。',
    references: ['0550-zoomBandChart', '0043-customTimeSelectionInteraction'], features: ['概览与细节', '窗口选择', '坐标轴联动'], limitation: '当前用位置滑块选择固定宽度窗口，不支持拉伸窗口边界。',
    create(host, p) {
      const s = scope(host, p), cells = panel(host, 2); host.style.gridTemplateColumns = '1fr'; host.style.gridTemplateRows = '3fr 1fr';
      const main = s.xy('选中窗口 · s', cells[0]), overview = s.xy('全量概览 · s', cells[1]), data = waveform(12000, 100, 0.8);
      line(main, '细节').add(data); line(overview, '概览', 1).add(data); intervals(main, 0, 12, -1.5, 1.5); intervals(overview, 0, 120, -1.5, 1.5);
      const band = overview.getDefaultAxisX().addBand().setStart(0).setEnd(12);
      const range = document.createElement('input'); range.type = 'range'; range.min = '0'; range.max = '108'; range.step = '0.2'; range.value = '0'; range.setAttribute('aria-label', '概览窗口位置'); range.style.cssText = 'position:absolute;bottom:4px;left:18%;width:74%;z-index:5;accent-color:#37dab5'; cells[1].append(range);
      range.oninput = () => { const start = Number(range.value); main.getDefaultAxisX().setInterval({ start, end: start + 12 }); band.setStart(start).setEnd(start + 12); range.setAttribute('aria-valuetext', `${start.toFixed(1)} 至 ${(start + 12).toFixed(1)} 秒`); };
      return staticDemo(s, data.length * 2);
    },
  },
  {
    id: 'waveform', title: '谐波波形', category: '二维曲线',
    description: '调节基频与幅值，观察基波和三次谐波形成的测量信号。拖动平移，滚轮缩放，双击复位。',
    references: ['0000-lineSeries', '0048-simpleTimeSeriesChart'], features: ['连续折线', '拖动与缩放', '动态参数'], controls: ['frequency', 'amplitude', 'points'],
    create(host, p) {
      const s = scope(host, p), c = s.xy('合成信号 · 时间 / s');
      const n = Math.min(p.points, 65536), rate = Math.max(2048, n);
      line(c, '传感器 A').add(waveform(n, rate, p.frequency, p.amplitude)); c.addLegendBox().add(c);
      intervals(c, 0, n / rate, -p.amplitude * 1.5, p.amplitude * 1.5);
      return staticDemo(s, n);
    },
  },
  {
    id: 'spectrum', title: '波形与 FFT 频谱', category: '频域分析',
    description: '从同一组时域采样独立计算单边 FFT 幅值谱。基频与三次谐波在相应频率出现峰值。',
    references: ['0018-refreshingLineSpectrum', '0039-audioVisualization'], features: ['FFT', '双图布局', '幅值归一化'], controls: ['frequency', 'amplitude'], limitation: '使用合成采样；未包含音频文件播放与浏览器音频输入。',
    create(host, p) {
      const s = scope(host, p), cells = panel(host, 2), a = s.xy('时域 · s', cells[0]), b = s.xy('单边幅值谱 · Hz', cells[1]);
      const data = waveform(2048, 2048, p.frequency, p.amplitude);
      line(a, '时域').add(data); line(b, 'FFT', 1).add(spectrum(data.map(v => v.y), 2048));
      intervals(a, 0, 0.2, -p.amplitude * 1.5, p.amplitude * 1.5); intervals(b, 0, 400, 0, p.amplitude * 1.2);
      return staticDemo(s, data.length + 1025);
    },
  },
  {
    id: 'stream', title: '多通道实时采集', category: '实时监测',
    description: '每通道按每秒 1,000 个样本持续追加，使用有界历史窗口；暂停后保留当前画面。',
    references: ['0010-multiChannelLineProgressive', '0501-dashboard5chs1000pps', '0504-dashboard2chs1000pps'], features: ['每通道 1,000 点 / 秒', '有界历史', '多通道'], controls: ['channels', 'frequency'],
    create(host, p) {
      const s = scope(host, p), c = s.xy('实时采集 · 最近 10 秒'), channels = p.channels;
      const traces = Array.from({ length: channels }, (_, i) => line(c, `CH ${i + 1}`, i).setMaxSampleCount(12000));
      c.addLegendBox().add(c);
      intervals(c, 0, 10, -1.5, channels * 2.5);
      let sample = 0;
      return { dispose: s.dispose, count: () => Math.min(sample, 12000) * channels, update(elapsed) {
        const target = Math.floor(elapsed * 1000), end = Math.min(target, sample + 500);
        if (end <= sample) return;
        traces.forEach((trace, channel) => trace.add(Array.from({ length: end - sample }, (_, j) => {
          const x = (sample + j) / 1000;
          return { x, y: channel * 2.5 + Math.sin(2 * Math.PI * (p.frequency / 8 + channel * 0.25) * x) };
        })));
        sample = end;
        c.getDefaultAxisX().setInterval({ start: Math.max(0, sample / 1000 - 10), end: Math.max(10, sample / 1000) });
      } };
    },
  },
  {
    id: 'multi-axis', title: '温度与振动双纵轴', category: '二维曲线',
    description: '温度和振动共享时间坐标，使用独立量纲与范围的纵轴。',
    references: ['0009-severalAxisXY', '0042-multiAxisLayout', '0028-multiChannelLineProgressiveOwnAxes'], features: ['独立纵轴', '共享时间范围', '多量纲'], controls: ['amplitude'],
    create(host, p) {
      const s = scope(host, p), c = s.xy('温度 °C / 振动 mm·s⁻¹'), second = c.addAxisY({ opposite: true });
      c.getDefaultAxisY().setTitle('温度 °C'); second.setTitle('振动 mm/s').setInterval({ start: -3, end: 3 });
      line(c, '温度').add(Array.from({ length: 1200 }, (_, i) => ({ x: i / 20, y: 45 + 7 * Math.sin(i / 180) })));
      line(c, '振动', 1, { axisY: second }).add(waveform(1200, 20, 0.4, p.amplitude));
      intervals(c, 0, 60, 30, 65); return staticDemo(s, 2400);
    },
  },
  {
    id: 'ecg', title: '心电节律监测', category: '实时监测',
    description: '由独立数学脉冲模型生成 P、QRS、T 波，按 500 Hz 追加到固定时窗。仅用于绘图演示。',
    references: ['0150-ecg', '0033-sweepingLineDashboard'], features: ['500 Hz 采样', '合成 ECG', '实时滚动'], controls: ['amplitude'], limitation: '当前使用滚动窗口；参考例的扫屏回绕与完整医学仪表板仍待实现。',
    create(host, p) {
      const s = scope(host, p), c = s.xy('合成心电 · 72 BPM'), trace = line(c, 'ECG').setMaxSampleCount(5000);
      intervals(c, 0, 8, -0.5 * p.amplitude, 1.4 * p.amplitude); let sample = 4000;
      trace.add(Array.from({ length: sample }, (_, i) => ({ x: i / 500, y: ecg(i / 500) * p.amplitude })));
      return { dispose: s.dispose, count: () => Math.min(sample, 5000), update(elapsed) {
        const end = Math.min(4000 + Math.floor(elapsed * 500), sample + 250);
        if (end <= sample) return;
        trace.add(Array.from({ length: end - sample }, (_, i) => ({ x: (sample + i) / 500, y: ecg((sample + i) / 500) * p.amplitude })));
        sample = end; c.getDefaultAxisX().setInterval({ start: Math.max(0, sample / 500 - 8), end: Math.max(8, sample / 500) });
      } };
    },
  },
  {
    id: 'million', title: '百万采样浏览', category: '性能实验',
    description: '生成有序采样数组，观察静态加载及缩放。这里的数据规模可调，性能结论由独立基准测试给出。',
    references: ['0004-1MillionPointsLineTrace', '0017-largeLineChartXY'], features: ['TypedArray 输入', '大数据量', '缩放浏览'], controls: ['points'],
    create(host, p) {
      const s = scope(host, p), c = s.xy(`${p.points.toLocaleString()} 个有序采样`), xValues = new Float64Array(p.points), yValues = new Float64Array(p.points);
      for (let i = 0; i < p.points; i++) { xValues[i] = i; yValues[i] = Math.sin(i * 0.002) + Math.sin(i * 0.000037) * 0.6 + (i % 8191 === 0 ? 2 : 0); }
      line(c, '原始采样').addArraysXY(xValues, yValues); intervals(c, 0, p.points, -2, 4);
      return staticDemo(s, p.points);
    },
  },
  {
    id: 'scatter', title: '散点簇分布', category: '散点与轨迹',
    description: '四组固定种子的高斯样本。颜色区分簇，点位置保留测量噪声。',
    references: ['0001-simpleScatter', '0006-pointClusters', '0016-largeScatterChartXY'], features: ['确定性数据', '四组散点', '高斯分布'], controls: ['points'],
    create(host, p) {
      const s = scope(host, p), c = s.xy('四组测量分布'), rng = random(47), count = Math.floor(p.points / 4);
      for (let k = 0; k < 4; k++) {
        const points = Array.from({ length: count }, () => { const radius = Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))), angle = 2 * Math.PI * rng(); return { x: (k % 2) * 5 + radius * Math.cos(angle), y: Math.floor(k / 2) * 5 + radius * Math.sin(angle) }; });
        c.addPointSeries().setName(`簇 ${k + 1}`).setPointSize(3).setPointFillStyle(fill(k)).add(points);
      }
      intervals(c, -4, 9, -4, 9); return staticDemo(s, count * 4);
    },
  },
  {
    id: 'trajectory', title: '双频运动轨迹', category: '散点与轨迹',
    description: '两个不同相位的周期信号构成闭合轨迹；独立的移动点标记当前位置。',
    references: ['0003-pointLinePlot', '0052-linePaletteValue'], features: ['参数曲线', '移动标记', '相位控制'], controls: ['frequency'], limitation: '本例不包含参考例的逐点任意值调色板。',
    create(host, p) {
      const s = scope(host, p), c = s.xy('轨迹 · X / Y'), marker = c.addPointSeries().setPointSize(12).setPointFillStyle(fill(1));
      const n = 2400, ratio = 2 + Math.round(p.frequency / 32), path = (t: number) => ({ x: Math.sin(t), y: Math.sin(ratio * t + 0.5) * 0.8 });
      line(c, '轨迹').add(Array.from({ length: n }, (_, i) => path(i * Math.PI * 2 / (n - 1))));
      intervals(c, -1.2, 1.2, -1, 1);
      return { dispose: s.dispose, count: () => n + 1, update(t) { marker.clear().add([path(t)]); } };
    },
  },
  {
    id: 'area', title: '负载面积趋势', category: '面积与统计',
    description: '用面积表达随时间变化的非负负载，折线叠加显示容量参考。',
    references: ['0103-layeredAreas'], features: ['面积填充', '容量参考'], controls: ['amplitude'],
    create(host, p) {
      const s = scope(host, p), c = s.xy('负载 / kW'), data = Array.from({ length: 800 }, (_, i) => ({ x: i / 20, y: 20 + p.amplitude * (4 * Math.sin(i / 60) + 2 * Math.sin(i / 17)) }));
      c.addAreaSeries().setName('负载').setAreaFillStyle(new SolidFill({ color: ColorRGBA(55, 218, 181, 95) })).add(data);
      line(c, '容量', 1).add([{ x: 0, y: 30 }, { x: 40, y: 30 }]); intervals(c, 0, 40, 0, 35);
      return staticDemo(s, data.length + 2);
    },
  },
  {
    id: 'heatmap', title: '二维温度场', category: '热图与频谱图',
    description: '规则网格上的连续热场，以同一颜色表呈现不同强度。支持暂停与缩放。',
    references: ['0800-heatmapGrid', '0807-heatmapGridPixelInterpolation'], features: ['96 × 64 网格', '连续更新', '色标映射'], limitation: '插值方式以当前渲染后端的实际设置为准。',
    create(host, p) {
      const s = scope(host, p), c = s.xy('温度场 · 相对强度'), h = c.addHeatmapGridSeries({dataOrder: 'rows',  columns: 96, rows: 64, start: { x: 0, y: 0 }, step: { x: 1, y: 1 } }).setFillStyle(palette());
      h.invalidateIntensityValues(heatField(96, 64)); intervals(c, 0, 96, 0, 64);
      let last = -1;
      return { dispose: s.dispose, count: () => 96 * 64, update(t) { if (t - last < 0.08) return; last = t; h.invalidateIntensityValues(heatField(96, 64, t * 0.8)); } };
    },
  },
  {
    id: 'waterfall', title: '滚动频谱瀑布', category: '热图与频谱图',
    description: '扫频信号形成时频轨迹，每次移动一列并追加新的强度切片。',
    references: ['0802-spectrogram', '0803-scrollingHeatmap', '1708-scrollingHeatmapAggregation'], features: ['时频矩阵', '固定内存窗口', '连续扫频'], limitation: '此原创例更新完整有界矩阵；尚未验证参考例的聚合与增量上传性能。',
    create(host, p) {
      const s = scope(host, p), c = s.xy('时间切片 / 频率'), columns = 192, rows = 96;
      const matrix = Array.from({ length: rows }, () => new Array(columns).fill(0));
      const h = c.addHeatmapGridSeries({dataOrder: 'rows',  columns, rows, start: { x: 0, y: 0 }, step: { x: 1, y: 4 } }).setFillStyle(palette());
      intervals(c, 0, columns, 0, rows * 4); h.invalidateIntensityValues(matrix); let last = -1;
      return { dispose: s.dispose, count: () => columns * rows, update(t) {
        if (t - last < 0.04) return; last = t; const center = 28 + 18 * Math.sin(t * 0.7);
        matrix.forEach((row, y) => { row.copyWithin(0, 1); row[columns - 1] = Math.exp(-(((y - center) / 3) ** 2)) * 0.9 + 0.3 * Math.exp(-(((y - center * 1.8) / 4) ** 2)); });
        h.invalidateIntensityValues(matrix);
      } };
    },
  },
  {
    id: 'bars', title: '产线产量比较', category: '业务图表',
    description: '独立类别的产量柱状图。幅值参数调整同一批次的计量比例。',
    references: ['0300-verticalBars'], features: ['类别柱', '数值标签'], controls: ['amplitude'],
    create(host, p) { const s = scope(host, p), c = s.make('BarChart'); c.setTitle('产线产量 / 件'); c.addData(['A', 'B', 'C', 'D', 'E', 'F'].map((category, i) => ({ category: `产线 ${category}`, value: Math.round((80 + 42 * Math.sin(i + 0.4)) * p.amplitude) }))); return staticDemo(s, 6); },
  },
  {
    id: 'histogram', title: '测量误差直方图', category: '面积与统计',
    description: '对固定种子的随机测量误差进行分箱，柱高表示落入区间的样本数量。',
    references: ['1402-histogram'], features: ['分箱统计', '可复现样本', '边界包含'], controls: ['points'],
    create(host, p) { const s = scope(host, p), c = s.make('BarChart'), rng = random(19), data = Array.from({ length: p.points }, () => (rng() + rng() + rng() + rng() - 2) * 2); c.setTitle('误差分布 / 样本数'); c.addData(histogram(data, 20, -4, 4)); return staticDemo(s, data.length); },
  },
  {
    id: 'pie', title: '能源结构占比', category: '业务图表',
    description: '用扇区面积显示四种能源的组成比例。所有数据均为本地合成值。',
    references: ['0450-pieChart'], features: ['占比扇区', '分类标签'],
    create(host, p) { const s = scope(host, p), c = s.make('Pie'); c.setTitle('能源结构'); [['风能', 34], ['太阳能', 27], ['水能', 23], ['其他', 16]].forEach(([name, value]) => c.addSlice(name, value)); return staticDemo(s, 4); },
  },
  {
    id: 'donut', title: '设备状态环形图', category: '业务图表',
    description: '环形扇区展示不同设备状态的占比，悬停查看数值，点击选中对应扇区。',
    references: ['0451-donutChart'], features: ['环形扇区', '悬停数值', '扇区选择'],
    create(host, p) { const s = scope(host, p), c = s.make('Pie'); c.setTitle('设备状态').setInnerRadius(62); [['运行', 48], ['待机', 17], ['维护', 8], ['离线', 4]].forEach(([name, value]) => c.addSlice(name, value)); return staticDemo(s, 4); },
  },
  {
    id: 'horizontal-bars', title: '工序时长水平比较', category: '业务图表',
    description: '将工序名称沿纵向排列，以水平柱长度比较耗时。悬停查看每个工序的值。',
    references: ['0301-horizontalBars'], features: ['水平数值方向', '类别标签', '悬停值'],
    create(host, p) { const s = scope(host, p), c = s.make('BarChart'); c.setTitle('工序耗时 / 秒').setHorizontal(true).addData([{ category: '装夹', value: 28 }, { category: '定位', value: 13 }, { category: '粗加工', value: 78 }, { category: '精加工', value: 56 }, { category: '检测', value: 32 }]); return staticDemo(s, 5); },
  },
  {
    id: 'gauge', title: '设备负载仪表', category: '业务图表',
    description: '连续变化的设备负载显示在仪表中；暂停可检查当前指针位置。',
    references: ['1600-basicGauge', '1602-gaugeDashboard'], features: ['实时数值', '仪表指针'],
    create(host, p) { const s = scope(host, p), c = s.make('Gauge'); c.setTitle('设备负载 / %').setValue(52); return { dispose: s.dispose, count: () => 1, update(t) { c.setValue(52 + 34 * Math.sin(t * 0.6)); } }; },
  },
  {
    id: 'spider', title: '工况指标雷达', category: '业务图表',
    description: '六项归一化指标沿放射坐标排布，对比两个独立工况。',
    references: ['0400-spiderStatic'], features: ['多指标', '工况对比', '雷达轮廓'],
    create(host, p) { const s = scope(host, p), c = s.make('Spider'); c.setTitle('工况指标'); const names = ['稳定性', '效率', '响应', '精度', '可靠性', '利用率']; [0, 1].forEach(k => c.addSeries().setName(`工况 ${k + 1}`).addPoints(names.map((name, i) => ({ name, value: 0.5 + 0.35 * Math.sin(i * 1.2 + k) })))); return staticDemo(s, 12); },
  },
  {
    id: 'treemap', title: '部门预算树图', category: '层级与多维',
    description: '用矩形面积展示各业务部门的预算分配。节点面积对应数值大小。',
    references: ['1504-TreeMap'], features: ['矩形面积编码', '分类标签'], limitation: '下钻、动态布局动画和层级路径仍待单独验证。',
    create(host, p) { const s = scope(host, p), c = s.make('TreeMapChart'); c.setTitle('年度预算 / 万元'); c.setData([{ name: '研发', value: 430 }, { name: '制造', value: 310 }, { name: '运营', value: 170 }, { name: '市场', value: 130 }, { name: '服务', value: 95 }, { name: '基础设施', value: 75 }]); return staticDemo(s, 6); },
  },
  {
    id: 'treemap-drilldown', title: '预算层级下钻', category: '层级与多维',
    description: '点击部门矩形查看内部预算，使用顶部返回区域或 Escape 回到上一层。',
    references: ['1505-TreeMapDrilldown'], features: ['层级下钻', '返回路径', '键盘返回'],
    create(host, p) { const s = scope(host, p), c = s.make('TreeMapChart'); c.setTitle('部门与项目预算').setData([{ name: '研发', value: 500, children: [{ name: '算法', value: 220 }, { name: '系统', value: 170 }, { name: '测试', value: 110 }] }, { name: '制造', value: 340, children: [{ name: '工装', value: 190 }, { name: '物料', value: 150 }] }, { name: '服务', value: 160, children: [{ name: '现场', value: 90 }, { name: '支持', value: 70 }] }]); return staticDemo(s, 10); },
  },
  {
    id: 'parallel', title: '多维工况剖面', category: '层级与多维',
    description: '多条记录穿过温度、压力、转速和效率四个平行坐标轴。',
    references: ['1700-parallelCoordChartSimple', '1701-parallelCoordChartHeavyDataSet'], features: ['平行坐标', '四维记录'], controls: ['points'], limitation: '维度筛选、混合类型轴与联动表格仍待实现。',
    create(host, p) { const s = scope(host, p), c = s.make('ParallelCoordinateChart'), rng = random(83), n = Math.min(p.points, 512); c.setTitle('多维工况'); c.setData(Array.from({ length: n }, () => ({ 温度: 20 + rng() * 60, 压力: 2 + rng() * 6, 转速: 1000 + rng() * 2000, 效率: 50 + rng() * 45 })), ['温度', '压力', '转速', '效率']); return staticDemo(s, n); },
  },
  {
    id: 'grid', title: '实时设备数据表', category: '层级与多维',
    description: '设备运行指标每半秒刷新，表格保留文本和数值的明确对应。',
    references: ['1301-dataGridMonitoring'], features: ['数值刷新', '多设备指标'],
    create(host, p) { const s = scope(host, p), c = s.make('DataGrid'); c.setTitle('设备监测'); let last = -1; const update = (t: number) => { if (t - last < 0.5) return; last = t; c.setData(Array.from({ length: 12 }, (_, i) => ({ 设备: `设备 ${String(i + 1).padStart(2, '0')}`, 温度: Number((46 + 12 * Math.sin(i + t * 0.2)).toFixed(1)), 转速: Math.round(1600 + 250 * Math.cos(i + t * 0.5)), 状态: i === 4 ? '维护' : '运行' }))); }; update(0); return { dispose: s.dispose, count: () => 12, update }; },
  },
  {
    id: 'polar', title: '方向灵敏度', category: '极坐标与三维',
    description: '以角度和幅度绘制心形方向响应，呈现角度域内的周期测量。',
    references: ['1001-polarMicrophoneSensitivity'], features: ['角度域', '极坐标折线', '闭合方向响应'],
    create(host, p) { const s = scope(host, p), c = s.make('Polar'); c.setTitle('方向灵敏度'); c.addLineSeries().setName('心形响应').setStrokeStyle(stroke()).add(Array.from({ length: 721 }, (_, i) => ({ angle: i / 2, amplitude: 0.5 + 0.5 * Math.cos(i / 2 * Math.PI / 180) }))); return staticDemo(s, 721); },
  },
  {
    id: 'line3d', title: '三维螺旋轨迹', category: '极坐标与三维',
    description: '空间折线呈现具有高度变化的运动轨迹。拖动调整观察方向。',
    references: ['0901-3dLineSeries'], features: ['空间轨迹', '三维相机'], controls: ['points'],
    create(host, p) { const s = scope(host, p), c = s.make('Chart3D'), n = Math.min(p.points, 32768); c.setTitle('空间螺旋'); c.addLineSeries().setStrokeStyle(stroke()).add(Array.from({ length: n }, (_, i) => { const t = i / (n - 1) * 8 * Math.PI; return { x: Math.cos(t), y: Math.sin(t), z: t / Math.PI }; })); intervals(c, -1.3, 1.3, -1.3, 1.3); c.getDefaultAxisZ().setInterval({ start: 0, end: 8 }); return staticDemo(s, n); },
  },
  {
    id: 'scatter3d', title: '三维点云', category: '极坐标与三维',
    description: '固定种子的点云呈现带噪声的环面，所有几何均由本地公式生成。',
    references: ['0900-3dScatter', '0910-3dLiDARPark'], features: ['点云', '确定性几何', '空间浏览'], controls: ['points'], limitation: '不使用园区扫描资产；真实 LiDAR 流与百万点性能尚需独立验收。',
    create(host, p) { const s = scope(host, p), c = s.make('Chart3D'), rng = random(97), n = Math.min(p.points, 262144); c.setTitle('环面点云'); c.addPointSeries().setPointFillStyle(fill()).setPointSize(2).add(Array.from({ length: n }, () => { const u = rng() * Math.PI * 2, v = rng() * Math.PI * 2, radius = 2 + 0.7 * Math.cos(v); return { x: radius * Math.cos(u), y: radius * Math.sin(u), z: 0.7 * Math.sin(v) }; })); intervals(c, -3, 3, -3, 3); c.getDefaultAxisZ().setInterval({ start: -1, end: 1 }); return staticDemo(s, n); },
  },
  {
    id: 'surface3d', title: '三维响应曲面', category: '极坐标与三维',
    description: '规则网格中的高度值定义响应曲面，观察二维参数的联合影响。',
    references: ['0912-surfaceGrid'], features: ['规则曲面', '二维采样', '高度编码'], limitation: '曲面颜色、分块更新和散点三角化不包含在本例中。',
    create(host, p) { const s = scope(host, p), c = s.make('Chart3D'); c.setTitle('响应曲面'); const data = heatField(48, 48); c.addSurfaceGridSeries({ columns: 48, rows: 48 }).invalidateHeightMap(data); intervals(c, 0, 48, 0, 1); c.getDefaultAxisZ().setInterval({ start: 0, end: 48 }); return staticDemo(s, 48 * 48); },
  },
];
