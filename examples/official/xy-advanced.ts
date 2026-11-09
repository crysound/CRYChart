import { ColorRGBA, SolidFill, SolidLine, PointShape, LinearGradientFill, transparentFill } from '../../src/index';
import { covarianceEllipse, random } from '../signals';
import { configureDates, dateLabel, day, legend, pointCursor, sharedCursor, xNavigation, type Trace } from './controls';
import { createXY } from './helpers';
import type { OfficialEntry } from './types';

export const advancedXYEntries: OfficialEntry[] = [
  {
    id: 'crychart-example-0006-pointClusters', title: '工资点簇与边界 · 0006',
    description: '两个城市的工资样本用圆点和倒三角区分；每个样本组都有根据实际范围计算的同色矩形边界。',
    observed: ["两个城市的工资样本用圆点和倒三角区分；每个样本组都有根据实际范围计算的同色矩形边界。"],
    gaps: ["日期与工资样本来自独立随机分布，边界会随这些数据变化。","本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context) {
      const { chart } = createXY(context, 'Salary differences between Kuopio and Helsinki'), start = Date.UTC(2022, 2, 1), rng = random(10006);
      const specifications = [
        { name: 'Kuopio', color: ColorRGBA(235, 238, 82), shape: PointShape.Circle, markerShape: 'circle', offset: 0, width: 24, low: 2600, high: 5900, count: 220 },
        { name: 'Helsinki', color: ColorRGBA(232, 139, 174), shape: PointShape.Triangle, markerShape: 'triangle-down', offset: 6, width: 23, low: 2150, high: 3900, count: 230 },
      ] as const;
      const bounds: Array<{name:string;xMin:number;xMax:number;yMin:number;yMax:number}> = [];
      const traces = specifications.map(specification => {
        const points = Array.from({ length: specification.count }, () => {
          const dayIndex = Math.floor(rng() * (specification.width + 1)), trend = Math.min(1, dayIndex / 7 + .45), range = (specification.high - specification.low) * trend;
          return { x: start + (specification.offset + dayIndex) * day, y: specification.low + rng() * range };
        }).sort((a, b) => a.x - b.x);
        const series = chart.addPointSeries().setName(specification.name).setPointShape(specification.shape).setPointRotation(specification.markerShape === 'triangle-down' ? 180 : 0).setPointSize(10).setPointFillStyle(new SolidFill({ color: specification.color })).add(points);
        const box = { name: specification.name, xMin: Math.min(...points.map(point => point.x)), xMax: Math.max(...points.map(point => point.x)), yMin: Math.min(...points.map(point => point.y)), yMax: Math.max(...points.map(point => point.y)) }; bounds.push(box);
        const rectangle = chart.addRectangleSeries().setName(`${specification.name} range`).setFillStyle(transparentFill).setStrokeStyle(new SolidLine({ fillStyle: new SolidFill({ color: specification.color }), thickness: 1.6 }));
        rectangle.add([{ x: box.xMin, y: box.yMin, width: box.xMax - box.xMin, height: box.yMax - box.yMin }]);
        return { name: specification.name, color: specification.color.toCSS(), series, points, markerShape: specification.markerShape, unit: '€' } satisfies Trace;
      });
      configureDates(chart); chart.getDefaultAxisY().setTitle('Salary (€)');
      const reset = () => { chart.getDefaultAxisX().setInterval({ start: start - day, end: start + 30 * day }); chart.getDefaultAxisY().setInterval({ start: 1400, end: 6600 }); }; reset();
      const cleanups = [legend(context.host, traces), pointCursor(chart, traces, dateLabel), xNavigation(chart, reset)];
      return { charts: [chart], traces, dispose: () => cleanups.forEach(fn => fn()), snapshot: () => ({ clusterBounds: bounds, pointsInsideBounds: traces.every((trace, i) => trace.points.every(point => point.x >= bounds[i].xMin && point.x <= bounds[i].xMax && point.y >= bounds[i].yMin && point.y <= bounds[i].yMax)), hoverTarget: traces[0].points[80] }) };
    },
  },
  {
    id: 'crychart-example-0008-lineSeriesMicroseconds', title: '微秒电压响应 · 0008',
    description: '以微秒为单位绘制高分辨率衰减振荡，保留触发前的噪声基线；纵轴每个刻度都显示电压单位。',
    observed: ["以微秒为单位绘制高分辨率衰减振荡，保留触发前的噪声基线；纵轴每个刻度都显示电压单位。"],
    gaps: ["信号由原创阻尼正弦模型与独立噪声构成，不复制原始波形。","本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context) {
      const { chart } = createXY(context, 'High resolution voltage measurement'), color = ColorRGBA(245, 204, 96), rng = random(10008), count = 20001;
      const points = Array.from({ length: count }, (_, i) => {
        const x = -2000 + i / 2, y = (x < 0 ? 0 : 5.9 * Math.exp(-x / 1450) * Math.sin(2 * Math.PI * x / 1250)) + (rng() - .5) * .055;
        return { x, y };
      });
      const series = chart.addLineSeries().setName('Voltage').setStrokeStyle(new SolidLine({ fillStyle: new SolidFill({ color }), thickness: 2.2 })).add(points);
      chart.getDefaultAxisX().setTitle('Time').setTickStrategy('numeric', (strategy: any) => strategy.setFormattingFunction((value: number) => `${value.toFixed(value % 1 ? 1 : 0)} µs`));
      chart.getDefaultAxisY().setTitle('Voltage').setTickStrategy('numeric', (strategy: any) => strategy.setFormattingFunction((value: number) => `${value.toFixed(2)} V`));
      const reset = () => { chart.getDefaultAxisX().setInterval({ start: -2000, end: 8000 }); chart.getDefaultAxisY().setInterval({ start: -3.2, end: 4.8 }); }; reset();
      const trace: Trace = { name: 'Voltage', color: color.toCSS(), points, series, unit: 'V' }, cleanups = [sharedCursor(chart, [trace], x => `${x.toFixed(1)} µs`), xNavigation(chart, reset)];
      return { charts: [chart], traces: [trace], dispose: () => cleanups.forEach(fn => fn()), snapshot: () => ({ timeUnit: 'microseconds', sampleSpacing: .5, sampleCount: count, trigger: 0, negativeTimeSamples: 4000, inputXBounds: { start: points[0].x, end: points.at(-1)!.x } }) };
    },
  },
  {
    id: 'crychart-example-0009-severalAxisXY', title: '四边独立坐标轴 · 0009',
    description: '同一绘图区内，红色曲线绑定下方和左侧坐标轴，绿色点线绑定上方和右侧坐标轴。四个轴保持各自的数值范围。',
    observed: ["同一绘图区内，红色曲线绑定下方和左侧坐标轴，绿色点线绑定上方和右侧坐标轴。四个轴保持各自的数值范围。"],
    gaps: ["本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context) {
      const { chart } = createXY(context, 'Several Axis'), rng = random(10009), x1 = chart.getDefaultAxisX(), y1 = chart.getDefaultAxisY(), x2 = chart.addAxisX({ opposite: true }), y2 = chart.addAxisY({ opposite: true });
      chart.setPadding({ left: 6, right: 0, top: -8, bottom: 0 });
      x1.setTitle('Axis X1').setInterval({ start: 0, end: 1300 }); y1.setTitle('Axis Y1').setInterval({ start: -150, end: 100 });
      x2.setTitle('Axis X2').setInterval({ start: -60, end: 510 }); y2.setTitle('Axis Y2').setInterval({ start: -20, end: 200 });
      for (const axis of [x1, y1]) axis.setStrokeStyle(new SolidLine({ fillStyle: new SolidFill({ color: ColorRGBA(62, 73, 199) }), thickness: 1.5 }));
      for (const axis of [x2, y2]) axis.setStrokeStyle(new SolidLine({ fillStyle: new SolidFill({ color: ColorRGBA(73, 177, 54) }), thickness: 1.5 }));
      const linePoints = Array.from({ length: 260 }, (_, i) => ({ x: i * 4.8, y: 9 + 21 * Math.sin(i / 35) + (rng() - .5) * 18 }));
      const pointLinePoints = Array.from({ length: 70 }, (_, i) => ({ x: i * 5, y: 3 + 10 * Math.log1p(i / 6) + (rng() - .5) * 17 }));
      const red = ColorRGBA(213, 50, 37), green = ColorRGBA(111, 191, 65), gold = ColorRGBA(245, 205, 102);
      const line = chart.addLineSeries({ axisX: x1, axisY: y1 }).setName('Axis X1 / Y1').setStrokeStyle(new SolidLine({ fillStyle: new SolidFill({ color: red }), thickness: 1.6 })).add(linePoints);
      const pointLine = chart.addPointLineSeries({ axisX: x2, axisY: y2 }).setName('Axis X2 / Y2').setStrokeStyle(new SolidLine({ fillStyle: new SolidFill({ color: green }), thickness: 1.5 })).setPointFillStyle(new SolidFill({ color: gold })).setPointShape(PointShape.Circle).setPointSize(7).add(pointLinePoints);
      const traces: Trace[] = [{ name: 'Axis X1 / Y1', color: red.toCSS(), points: linePoints, series: line }, { name: 'Axis X2 / Y2', color: gold.toCSS(), points: pointLinePoints, series: pointLine }];
      const cleanups = [pointCursor(chart, traces, x => x.toFixed(1))];
      return { charts: [chart], traces, dispose: () => cleanups.forEach(fn => fn()), snapshot: () => ({ axes: [x1, y1, x2, y2].map(axis => ({ direction: axis.direction, opposite: axis.opposite, interval: axis.getInterval(), title: axis.getTitle() })), bindings: traces.map(trace => ({ name: trace.name, x: trace.series.getAxisX().getTitle(), y: trace.series.getAxisY().getTitle() })), hoverTarget: pointLinePoints[30] }) };
    },
  },
  {
    id: 'crychart-example-0015-confidenceEllipseXY', title: '散点与统计椭圆 · 0015',
    description: '相关二维样本与由样本协方差计算的置信椭圆叠加显示。散点保持独立，椭圆的方向和尺度由统计量确定。',
    observed: ["相关二维样本与由样本协方差计算的置信椭圆叠加显示。散点保持独立，椭圆的方向和尺度由统计量确定。"],
    gaps: ["独立二维正态样本与协方差计算，未复用原始点集。","本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context) {
      const { chart } = createXY(context, 'Scatter chart + confidence Ellipse'), rng = random(10015), color = ColorRGBA(244, 242, 151), points = [];
      for (let i = 0; i < 10000; i++) {
        const radius = Math.sqrt(-2 * Math.log(Math.max(1e-12, rng()))), angle = 2 * Math.PI * rng(), a = radius * Math.cos(angle), b = radius * Math.sin(angle);
        points.push({ x: .83 * a + .22 * b, y: .36 * a + .40 * b });
      }
      const contour = covarianceEllipse(points, Math.sqrt(-2 * Math.log(.05)), 192);
      chart.addPolygonSeries().setFillStyle(new SolidFill({ color: ColorRGBA(238, 237, 210, 25) })).setStrokeStyle(new SolidLine({ fillStyle: new SolidFill({ color: ColorRGBA(238, 237, 210, 160) }), thickness: 1.2 })).add({ points: contour });
      const series = chart.addPointSeries().setName('Samples').setPointShape(PointShape.Diamond).setPointSize(3).setPointFillStyle(new SolidFill({ color })).add(points);
      chart.getDefaultAxisX().setInterval({ start: -2.3, end: 2.3 }); chart.getDefaultAxisY().setInterval({ start: -1.6, end: 1.6 });
      for (const axis of [chart.getDefaultAxisX(), chart.getDefaultAxisY()]) axis.setTickStrategy('numeric', (strategy: any) => strategy.setFormattingFunction((value: number) => value.toFixed(2)));
      const trace: Trace = { name: 'Samples', color: color.toCSS(), points, series }, cleanup = pointCursor(chart, [trace], x => x.toFixed(3));
      return { charts: [chart], traces: [trace], dispose: cleanup, snapshot: () => ({ sampleCount: points.length, contourPoints: contour.length, probability: .95, covarianceDerived: true, independentSampleDistribution: 'correlated Gaussian' }) };
    },
  },
  {
    id: 'crychart-example-0030-logLine', title: '线性轴与对数轴 · 0030',
    description: '将 f(x)=x 与 f(x)=10^x 分别绑定到线性和对数纵轴，同一个数学函数在两种坐标变换下呈现不同的曲线形态。',
    observed: ["将 f(x)=x 与 f(x)=10^x 分别绑定到线性和对数纵轴，同一个数学函数在两种坐标变换下呈现不同的曲线形态。"],
    gaps: ["本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context) {
      const { chart } = createXY(context, 'Logarithmic Axis vs Linear Axis'); chart.getDefaultAxisY().setVisible(false);
      const logarithmic = chart.addAxisY({ type: 'logarithmic' }).setTitle('Logarithmic Y Axis').setInterval({ start: .1, end: 850 }), linear = chart.addAxisY().setTitle('Linear Y Axis').setInterval({ start: 0, end: 850 });
      chart.getDefaultAxisX().setInterval({ start: .1, end: 10 });
      const identity = Array.from({ length: 991 }, (_, i) => ({ x: .1 + i / 100, y: .1 + i / 100 })), exponential = identity.map(point => ({ x: point.x, y: 10 ** point.x }));
      const definitions = [
        { name: 'f(x) = x', axis: linear, color: ColorRGBA(231, 236, 73), points: identity },
        { name: 'f(x) = x', axis: logarithmic, color: ColorRGBA(248, 205, 98), points: identity },
        { name: 'f(x) = 10^x', axis: linear, color: ColorRGBA(242, 153, 85), points: exponential },
        { name: 'f(x) = 10^x', axis: logarithmic, color: ColorRGBA(236, 178, 171), points: exponential },
      ];
      const traces: Trace[] = definitions.map(item => ({ name: item.name, color: item.color.toCSS(), points: item.points, series: chart.addLineSeries({ axisY: item.axis }).setName(item.name).setStrokeStyle(new SolidLine({ fillStyle: new SolidFill({ color: item.color }), thickness: 3 })).add(item.points) }));
      const cleanups = [legend(context.host, traces), sharedCursor(chart, traces, x => x.toFixed(2))];
      return { charts: [chart], traces, dispose: () => cleanups.forEach(fn => fn()), snapshot: () => ({ axes: [{ title: linear.getTitle(), type: linear.type, interval: linear.getInterval() }, { title: logarithmic.getTitle(), type: logarithmic.type, interval: logarithmic.getInterval() }], bindings: definitions.map(item => ({ formula: item.name, axis: item.axis.type })), independentlyEvaluatedFunctions: true }) };
    },
  },
  {
    id: 'crychart-example-0018-refreshingLineSpectrum', title: '连续刷新的渐变频谱 · 0018',
    description: '固定长度的频谱持续刷新，两个能量峰叠加细小扰动。黄色曲线下方从强信号到 0.1 基线逐渐透明，刷新时不累计旧帧。',
    observed: ["固定长度的频谱持续刷新，两个能量峰叠加细小扰动。黄色曲线下方从强信号到 0.1 基线逐渐透明，刷新时不累计旧帧。"],
    gaps: ["本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context) {
      const { chart } = createXY(context, 'Spectrum Line Chart'), count = 1024, xValues = Float64Array.from({length:count},(_,i)=>i), yValues = new Float64Array(count), rng = random(10018), color = ColorRGBA(235,237,65);
      const series = chart.addAreaSeries().setName('Spectrum').setAreaBaseline(.1).setStrokeStyle(new SolidLine({fillStyle:new SolidFill({color}),thickness:1.6})).setAreaFillStyle(new LinearGradientFill({angle:0,stops:[{offset:0,color:ColorRGBA(235,237,65,0)},{offset:1,color:ColorRGBA(235,237,65,200)}]}));
      let updates = 0;
      const update = (elapsed:number) => {
        const first = 160+Math.sin(elapsed*.4)*9, second = 650+Math.sin(elapsed*.55)*12;
        const lobe = (x:number,center:number,width:number) => {const normalized=(x-center)/width;return Math.abs(normalized)<=1?Math.cos(normalized*Math.PI/2):0;};
        for(let i=0;i<count;i++){const envelope=Math.max(.65*lobe(i,first,240),.49*lobe(i,second,135));yValues[i]=.1+envelope*(.9+rng()*.2);}
        series.clear().addArraysXY(xValues,yValues);updates++;
      };update(0);
      chart.getDefaultAxisY().setTickStrategy('numeric',(strategy:any)=>strategy.setFormattingFunction((value:number)=>value.toFixed(3)));
      const reset=()=>{chart.getDefaultAxisX().setInterval({start:0,end:1023});chart.getDefaultAxisY().setInterval({start:.09,end:.9});};reset();
      const trace:Trace={name:'Spectrum',series,points:[],pointCount:count,pointAt:index=>({x:xValues[index],y:yValues[index]}),color:color.toCSS()},cleanups=[sharedCursor(chart,[trace],x=>String(Math.round(x))),xNavigation(chart,reset)];
      return{charts:[chart],traces:[trace],update,dispose:()=>cleanups.forEach(fn=>fn()),snapshot:()=>({updates,frameSampleCount:count,baseline:.1,gradientDirection:'up',retainsPreviousFrames:false,checkpoint:yValues[160]})};
    },
  },
];
