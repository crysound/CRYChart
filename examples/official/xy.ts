import { ColorRGBA, SolidFill, SolidLine, PointShape } from '../../src/index';
import { random, steps } from '../signals';
import { configureDates, dateLabel, day, legend, pointCursor, sharedCursor, xNavigation, type Trace } from './controls';
import { createXY } from './helpers';
import type { OfficialEntry } from './types';

export const xyEntries: OfficialEntry[] = [
  {
    id: 'crychart-example-0001-simpleScatter', title: '产品收入散点 · 0001',
    description: '三种产品用圆形、星形、倒三角区分。日期横轴覆盖第三季度，纵轴显示收入，底部图例可控制可见性。',
    observed: ["三种产品用圆形、星形、倒三角区分。日期横轴覆盖第三季度，纵轴显示收入，底部图例可控制可见性。"],
    gaps: ["收入为独立生成的同类型数据，逐点数值不同。","本库场景的功能、交互和资源占用需在目标运行环境验证。","标记描边、光晕、次网格与背景渐变尚未对齐。"],
    mount(context) {
      const { chart } = createXY(context, 'Product Sales'), start = Date.UTC(2022, 6, 1), end = start + 89 * day, rng = random(10001);
      const specifications = [
        { name: 'Smart Phones', color: ColorRGBA(240, 239, 83), shape: PointShape.Circle, markerShape: 'circle', size: 10, high: 1920, base: 180 },
        { name: 'Laptops', color: ColorRGBA(242, 156, 93), shape: PointShape.Star, markerShape: 'star', size: 12, high: 870, base: 35 },
        { name: 'Smart TV', color: ColorRGBA(231, 139, 175), shape: PointShape.Triangle, markerShape: 'triangle-down', size: 10, high: 390, base: 0 },
      ] as const;
      const traces = specifications.map(specification => {
        const points = Array.from({ length: 90 }, (_, i) => ({ x: start + i * day, y: specification.base + (specification.high - specification.base) * (i / 89) ** 1.17 + (rng() - 0.5) * 25 }));
        const series = chart.addPointSeries().setName(specification.name).setPointShape(specification.shape).setPointRotation(specification.markerShape === 'triangle-down' ? 180 : 0).setPointSize(specification.size).setPointFillStyle(new SolidFill({ color: specification.color })).add(points);
        return { name: specification.name, color: specification.color.toCSS(), points, series, unit: '$', markerShape: specification.markerShape } satisfies Trace;
      });
      configureDates(chart); chart.getDefaultAxisY().setTitle('Revenue ($)');
      const reset = () => { chart.getDefaultAxisX().setInterval({ start, end }); chart.getDefaultAxisY().setInterval({ start: 0, end: 2000 }); }; reset();
      const cleanups = [legend(context.host, traces), pointCursor(chart, traces, dateLabel), xNavigation(chart, reset)];
      return { charts: [chart], traces, dispose: () => cleanups.forEach(fn => fn()), snapshot: () => ({ shapes: traces.map(trace => ({ name: trace.name, shape: trace.series.getPointShape(), rotation: trace.series.getPointRotation(), marker: trace.markerShape })), hoverTarget: traces[0].points[45] }) };
    },
  },
  {
    id: 'crychart-example-0003-pointLinePlot', title: '里程点线对比 · 0003',
    description: '三种车辆的耗油量用点线表达。横轴为里程，纵轴为升数；方形、圆形和倒三角同时标出实际样本。',
    observed: ["三种车辆的耗油量用点线表达。横轴为里程，纵轴为升数；方形、圆形和倒三角同时标出实际样本。"],
    gaps: ["车辆样本使用独立消费模型，不照搬示例数组。","本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context) {
      const { chart } = createXY(context, 'Car Mileage Comparison');
      chart.legend.setOptions({visible:false});
      const specifications = [
        { name: 'Sports Car', color: ColorRGBA(235, 238, 73), shape: PointShape.Square, markerShape: 'square', factor: 3.85 },
        { name: 'Family Car', color: ColorRGBA(242, 155, 88), shape: PointShape.Circle, markerShape: 'circle', factor: 11.1 },
        { name: 'Pick-up Car', color: ColorRGBA(232, 137, 175), shape: PointShape.Triangle, markerShape: 'triangle-down', factor: 8.4 },
      ] as const;
      const traces = specifications.map((specification, index) => {
        const points = Array.from({ length: 8 }, (_, i) => ({ x: i * 10 * specification.factor + (i ? Math.sin(i * 1.3 + index) * 11 : 0), y: i * 10 }));
        const series = chart.addPointLineSeries().setName(specification.name).setStrokeStyle(new SolidLine({ fillStyle: new SolidFill({ color: specification.color }), thickness: 1.8 })).setPointShape(specification.shape).setPointRotation(specification.markerShape === 'triangle-down' ? 180 : 0).setPointSize(10).setPointFillStyle(new SolidFill({ color: specification.color })).add(points);
        return { name: specification.name, color: specification.color.toCSS(), points, series, unit: 'Litre', markerShape: specification.markerShape } satisfies Trace;
      });
      chart.getDefaultAxisX().setTitle('Km'); chart.getDefaultAxisY().setTitle('Litre');
      const reset = () => { chart.getDefaultAxisX().setInterval({ start: 0, end: 1000 }); chart.getDefaultAxisY().setInterval({ start: 0, end: 100 }); }; reset();
      const cleanups = [legend(context.host, traces), pointCursor(chart, traces, x => `${x.toFixed(1)} Km`), xNavigation(chart, reset)];
      return { charts: [chart], traces, dispose: () => cleanups.forEach(fn => fn()), snapshot: () => ({ shapes: traces.map(trace => ({ name: trace.name, shape: trace.series.getPointShape(), rotation: trace.series.getPointRotation(), marker: trace.markerShape })), hoverTarget: traces[1].points[4] }) };
    },
  },
  {
    id: 'crychart-example-0004-1MillionPointsLineTrace', title: '百万点轨迹 · 0004',
    description: '一百万个有序采样形成连续随机轨迹。使用两列数值数组直接交给图表，游标按索引读取样本。',
    observed: ["一百万个有序采样形成连续随机轨迹。使用两列数值数组直接交给图表，游标按索引读取样本。"],
    gaps: ["本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context) {
      const { chart } = createXY(context, '1 Million Points Line Trace'), count = 1_000_000, xValues = new Float64Array(count), yValues = new Float64Array(count), rng = random(1000004);
      let y = 0, min = 0, max = 0;
      for (let i = 0; i < count; i++) { y += (rng() - 0.5) * 2.2 - 0.0003; xValues[i] = i; yValues[i] = y; min = Math.min(min, y); max = Math.max(max, y); }
      const color = ColorRGBA(250, 155, 85), series = chart.addLineSeries().setName('Series').setStrokeStyle(new SolidLine({ fillStyle: new SolidFill({ color }), thickness: 1.8 })).addArraysXY(xValues, yValues);
      const trace: Trace = { name: 'Series', color: color.toCSS(), series, points: [], pointCount: count, pointAt: index => ({ x: xValues[index], y: yValues[index] }) };
      const reset = () => { chart.getDefaultAxisX().setInterval({ start: 0, end: count - 1 }); chart.getDefaultAxisY().setInterval({ start: min - 15, end: max + 15 }); }; reset();
      const cleanups = [sharedCursor(chart, [trace], x => String(Math.round(x))), xNavigation(chart, reset)];
      return { charts: [chart], traces: [trace], dispose: () => cleanups.forEach(fn => fn()), snapshot: () => ({ inputCount: count, inputBytes: xValues.byteLength + yValues.byteLength, actualSamples: series.getSampleCount(), storage: 'Float64Array columns' }) };
    },
  },
  {
    id: 'crychart-example-0005-stepPlot', title: '可切换阶梯位置 · 0005',
    description: '月份记录以圆点表示，阶梯连接可在 before、middle、after 三种位置间切换；默认采用中点阶跃。',
    observed: ["月份记录以圆点表示，阶梯连接可在 before、middle、after 三种位置间切换；默认采用中点阶跃。"],
    gaps: ["月份数值为独立生成的调查样本。","本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context) {
      const { chart } = createXY(context, 'Survey Report'), color = ColorRGBA(235, 237, 74), raw = [7, 19, 27, 14, 52, 73, 46, 31, 69, 84, 95, 9].map((y, x) => ({ x, y }));
      const line = chart.addLineSeries().setName('Survey').setStrokeStyle(new SolidLine({ fillStyle: new SolidFill({ color }), thickness: 1.8 }));
      chart.addPointSeries().setName('Monthly records').setPointSize(7).setPointFillStyle(new SolidFill({ color: ColorRGBA(255, 255, 194) })).add(raw);
      let mode: 'before' | 'middle' | 'after' = 'middle';
      const setMode = (value: typeof mode) => { mode = value; line.clear().add(steps(raw, mode)); }; setMode(mode);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      chart.getDefaultAxisX().setTickStrategy('numeric', (strategy: any) => strategy.setMajorTickPlacement(() => months.map((label, position) => ({ position, label }))));
      chart.getDefaultAxisY().setTitle('Amount / Month').setTickStrategy('numeric', (strategy: any) => strategy.setFormattingFunction((value: number) => value.toFixed(1)));
      const reset = () => { chart.getDefaultAxisX().setInterval({ start: 0, end: 11 }); chart.getDefaultAxisY().setInterval({ start: 0, end: 100 }); }; reset();
      const controls = document.createElement('div'); controls.className = 'official-legend'; controls.style.color = '#f2f2d0'; const label = document.createElement('strong'); label.textContent = 'Step options'; controls.append(label);
      for (const value of ['before', 'middle', 'after'] as const) { const choice = document.createElement('label'), input = document.createElement('input'); input.type = 'radio'; input.name = 'step-mode'; input.value = value; input.checked = mode === value; input.style.accentColor = '#e2e942'; input.onchange = () => { if (input.checked) setMode(value); }; choice.append(input, document.createTextNode(value)); controls.append(choice); }
      context.host.append(controls);
      const trace: Trace = { name: 'Survey', color: color.toCSS(), series: line, points: raw }, cleanups = [sharedCursor(chart, [trace], x => months[Math.max(0, Math.min(11, Math.round(x)))]), xNavigation(chart, reset)];
      return { charts: [chart], traces: [trace], dispose: () => cleanups.forEach(fn => fn()), snapshot: () => ({ mode, originalSamples: raw.length, pathSamples: line.getSampleCount(), firstPathPoints: line.getPoints().slice(0, 4) }) };
    },
  },
];
