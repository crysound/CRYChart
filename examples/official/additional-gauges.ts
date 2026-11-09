import type {OfficialEntry, OfficialMountContext, OfficialMounted} from './types.js';
import type {Trace} from './controls.js';
import {ColorHEX, SolidFill, SolidLine, LUT, FontSettings} from '../../src/core/styles.js';
import {Gauge} from '../../src/specialty.js';
import {linearGaugeSample} from './additional-surfaces-data.js';

const colors = ['#f0ee4b', '#e6b746', '#e99a67', '#d986a8'];
const fill = (color: string) => new SolidFill({color: ColorHEX(color)});
function panel(parent: HTMLElement, css: string) {const div = document.createElement('div'); div.style.cssText = css; parent.append(div); return div;}
function button(parent: HTMLElement, text: string, id: string, action: () => void) {const item = document.createElement('button'); item.textContent = text; item.dataset.control = id; item.style.cssText = 'padding:5px 9px;color:#eff1d4;background:#19232a;border:1px solid #789'; item.onclick = action; parent.append(item); return item;}
function mountTemperature(context: OfficialMountContext): OfficialMounted {
  const root = panel(context.host, 'position:relative;flex:1;min-height:0;height:100%;background:radial-gradient(#24474b,#10191d)');
  const gauge: Gauge = context.engine.Gauge({container: root, theme: context.theme});
  gauge.setTitle('Temperature').setTitleAlignment('center').setTitleFont(new FontSettings({size: 18})).setInterval({start: -20, end: 20}).setArc(140, 260).setArcThickness(.11).setArcColor(ColorHEX('#39d6e8')).setProgressVisible(false).setTickValues([-20, -10, 0, 10, 20]).setBands([
    {start: -20, end: -10, color: ColorHEX('#b941e7')}, {start: -10, end: 0, color: ColorHEX('#38d7eb')}, {start: 0, end: 10, color: ColorHEX('#ffe24d')}, {start: 10, end: 20, color: ColorHEX('#ff5245')},
  ]).setUnitLabel('°C').setValueFormatter(value => value.toFixed(2)).setValueFontSize(45).setValue(0);
  const controls = panel(root, 'position:absolute;left:12px;bottom:12px;display:flex;gap:8px;align-items:center;color:#e8ead7');
  const input = document.createElement('input'); input.type = 'range'; input.min = '-20'; input.max = '20'; input.step = '.01'; input.value = '0'; input.ariaLabel = 'Temperature'; input.dataset.control = 'temperature-value'; controls.append(input);
  let running = false, temperature = 0; const pause = button(controls, 'Start temperature signal', 'temperature-stream', () => {running = !running; pause.textContent = running ? 'Pause temperature signal' : 'Start temperature signal';});
  input.oninput = () => {running = false; pause.textContent = 'Start temperature signal'; gauge.setValue(Number(input.value));};
  const token = gauge.on('valuechange', (_chart, value: number) => {temperature = value; input.value = String(value);});
  return {charts: [gauge], update: time => {if (running) gauge.setValue(17 * Math.sin(time * .5));}, dispose: () => {gauge.off(token); root.remove();}, snapshot: () => ({ready: true, rendering: 'Canvas2D gauge', orientation: gauge.getOrientation(), value: temperature, running, interval: {...gauge.interval}, ticks: [-20, -10, 0, 10, 20], bandCount: 4, dataProvenance: {kind: 'independent-synthetic', referenceScalars: ['-20..20 °C'], source: 'Original optional sinusoidal temperature input; direct user input is retained'}})};
}
function mountLinearDashboard(context: OfficialMountContext): OfficialMounted {
  const root = panel(context.host, 'position:relative;flex:1;min-height:0;width:100%;height:100%;display:grid;grid-template-columns:23% 77%;grid-template-rows:repeat(4,minmax(0,1fr));gap:1px;background:#141b21');
  const gauges: Gauge[] = [], plots: any[] = [], traces: Trace[] = [], lut = new LUT({steps: [{value: 0, color: ColorHEX('#ed4937')}, {value: 50, color: ColorHEX('#eadb37')}, {value: 100, color: ColorHEX('#2ad867')}], interpolate: true});
  for (let channel = 0; channel < 4; channel++) {
    const gh = panel(root, 'min-width:0;min-height:0;height:100%'), ph = panel(root, 'min-width:0;min-height:0;height:100%');
    const gauge: Gauge = context.engine.Gauge({container: gh, theme: context.theme});
    gauge.setPadding(4).setOrientation('vertical').setInterval({start: 0, end: 100}).setProgressVisible(false).setTickValues(channel < 2 ? [0, 33, 67, 100] : [0, 50, 100]).setBands([{start: 0, end: 33, color: ColorHEX('#e84c39')}, {start: 33, end: 67, color: ColorHEX('#eadb37')}, {start: 67, end: 100, color: ColorHEX('#33d76b')}]).setLinearLUT(channel >= 2 ? lut : undefined).setValueFormatter(value => value.toFixed(2)).setValueFontSize(16).setInteractive(false);
    const chart = context.engine.ChartXY({container: ph, theme: context.theme}); chart.setTitle(`Channel ${channel + 1}`).setTitleFont(new FontSettings({size: 12})).setPadding({left: -15, right: 0, top: -8, bottom: 0});
    chart.getDefaultAxisX().setInterval({start: -30, end: 0}).setTitle(''); chart.getDefaultAxisY().setInterval({start: 0, end: 100});
    const series = chart.addLineSeries({legend: null}).setName(`Channel ${channel + 1}`).setMaxSampleCount(600).setStrokeStyle(new SolidLine({fillStyle: fill(colors[channel]), thickness: 1.5}));
    gauges.push(gauge); plots.push(chart); traces.push({name: series.getName(), color: colors[channel], points: [], series});
  }
  let nextSample = 0, running = true, produced = 0;
  function append(count: number) {for (let c = 0; c < 4; c++) {const rows = Array.from({length: count}, (_, i) => ({x: (nextSample + i) / 20, y: linearGaugeSample(c, nextSample + i)})); traces[c].series.add(rows); traces[c].points.push(...rows); if (traces[c].points.length > 600) traces[c].points.splice(0, traces[c].points.length - 600); gauges[c].setValue(rows.at(-1)!.y); plots[c].getDefaultAxisX().setInterval({start: (nextSample + count - 1) / 20 - 30, end: (nextSample + count - 1) / 20});} nextSample += count; produced += count;}
  append(200);
  const controls = panel(root, 'position:absolute;right:12px;top:5px;z-index:4'); const pause = button(controls, 'Pause channels', 'linear-stream', () => {running = !running; pause.textContent = running ? 'Pause channels' : 'Resume channels';});
  let accumulator = 0;
  return {charts: [...gauges, ...plots], traces, update: (_elapsed, delta) => {if (!running) return; accumulator += delta * 20; const count = Math.min(600, Math.floor(accumulator)); if (count) {accumulator -= count; append(count);}}, dispose: () => root.remove(), snapshot: () => ({ready: true, channels: 4, orientation: 'vertical', running, nextSample, produced, inputRateHz: 20, retainedMaximum: 600, gaugeValues: gauges.map(g => g.getValue()), samples: traces.map(t => t.series.getSampleCount()), latestSamples: traces.map(t => t.points.at(-1)?.y), paletteModes: ['bands', 'bands', 'continuous', 'continuous'], dataProvenance: {kind: 'independent-synthetic', source: 'Original deterministic 20 Hz signals; independent point arrays retained for complete audit', referenceScalars: ['four linear gauges and four curves', '0..100 range']}})};
}
export const additionalGaugeEntries: OfficialEntry[] = [
  {id: 'crychart-example-1601-valueIndicatorGauge', title: '分区温度指针 · 1601', description: '−20 至 20 °C 的单指针温度表；四段颜色、直接拖动和可暂停的温度输入。', observed: ["−20 至 20 °C 的单指针温度表；四段颜色、直接拖动和可暂停的温度输入。"], gaps: ["本库场景的功能、交互和资源占用需在目标运行环境验证。"], mount: mountTemperature},
  {id: 'crychart-example-1603-gaugeDashboard2', title: '线性仪表与四通道趋势 · 1603', description: '四个竖直线性仪表与保留 30 秒的对应曲线同步；分段与连续调色板分别展示。', observed: ["四个竖直线性仪表与保留 30 秒的对应曲线同步；分段与连续调色板分别展示。"], gaps: ["本库场景的功能、交互和资源占用需在目标运行环境验证。"], mount: mountLinearDashboard},
];
