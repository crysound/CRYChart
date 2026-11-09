import { ColorRGBA, LUT, PalettedFill, SolidFill, SolidLine, emptyLine } from '../../src/index';
import { marchingSquares, type ContourSegment } from '../contours';
import { createXY } from './helpers';
import type { OfficialEntry } from './types';

export const heatmapEntries: OfficialEntry[] = [
  {
    id: 'crychart-example-0800-heatmapGrid', title: '百万网格与等值线 · 0800',
    description: '一百万个温度样本形成规则网格。0、25、50、75 四档离散颜色与带数值标签的等值线表达同一温度场，右侧显示摄氏度色标。',
    observed: ["一百万个温度样本形成规则网格。0、25、50、75 四档离散颜色与带数值标签的等值线表达同一温度场，右侧显示摄氏度色标。"],
    gaps: ["本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context) {
      const wrapper = document.createElement('div'); wrapper.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) 145px;flex:1;min-height:0'; context.host.append(wrapper);
      const chartHost = document.createElement('div'); chartHost.style.cssText = 'display:flex;min-width:0;min-height:0'; wrapper.append(chartHost);
      const { chart } = createXY({ ...context, host: chartHost }, 'Heatmap Grid Series 1000x1000 (1.0 million data points)'); chart.setPadding({ left: -12, right: 0, top: -18, bottom: 0 });
      const side = document.createElement('div'); side.style.cssText = 'display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:14px;color:#f3f3d2;font:12px sans-serif;padding:0 7px'; wrapper.append(side);
      const label = document.createElement('span'); label.textContent = '● Heatmap Grid Series'; label.style.whiteSpace = 'nowrap'; side.append(label);
      const scale = document.createElement('div'); scale.style.cssText = 'display:flex;gap:12px;margin-left:15px';
      const swatches = document.createElement('div'); swatches.style.cssText = 'display:flex;flex-direction:column;width:25px;height:140px;border-radius:5px;overflow:hidden';
      for (const color of ['#ff0000','#ff8500','#ffcc00','#ffff00']) { const block = document.createElement('span'); block.style.cssText = `display:block;background:${color};flex:1`; swatches.append(block); }
      const numbers = document.createElement('div'); numbers.style.cssText = 'display:flex;flex-direction:column;justify-content:space-between;padding-top:26px';
      for (const value of ['75.0','50.0','25.0','0.0']) { const item = document.createElement('span'); item.textContent = value; numbers.append(item); } scale.append(swatches,numbers); side.append(scale);
      const units = document.createElement('span'); units.textContent = '°C'; units.style.marginLeft = '51px'; side.append(units);
      const size = 1000, data = new Float32Array(size * size), rows = Array.from({ length: size }, (_, y) => data.subarray(y * size,(y + 1) * size));
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const dx = x - 500, dy = y - 500, radius = Math.hypot(dx,dy), angle = Math.atan2(dy,dx);
        rows[y][x] = Math.max(0, Math.min(100, 48 + 29 * Math.cos(radius / 57 + .19 * Math.sin(angle * 3)) * Math.exp(-radius / 1600) + 21 * Math.exp(-((x - 290) ** 2 + (y - 720) ** 2) / 8500) - 21 * Math.exp(-((x - 180) ** 2 + (y - 550) ** 2) / 7000)));
      }
      const lut = new LUT({ steps: [{value:0,color:ColorRGBA(255,255,0)},{value:25,color:ColorRGBA(255,204,0)},{value:50,color:ColorRGBA(255,133,0)},{value:75,color:ColorRGBA(255,0,0)}], interpolate: false, units: '°C' });
      const heat = chart.addHeatmapGridSeries({dataOrder: 'rows',  columns:size, rows:size, start:{x:0,y:0}, step:{x:1,y:1} }).setFillStyle(new PalettedFill({lut})).setWireframeStyle(emptyLine); heat.invalidateIntensityValues(rows);
      const contours = [25,50,75].map(level => {
        const segments = marchingSquares(rows,level,4), points = segments.flatMap(segment => [segment.start,segment.end,{x:NaN,y:NaN}]);
        const series = chart.addLineSeries().setName(`${level.toFixed(1)} °C contour`).setStrokeStyle(new SolidLine({fillStyle:new SolidFill({color:ColorRGBA(65,64,12,190)}),thickness:.9})).setCursorEnabled(false).add(points);
        return {level,segments,series};
      });
      chart.getDefaultAxisX().setInterval({start:0,end:1000}); chart.getDefaultAxisY().setInterval({start:0,end:1000}); chart.getCursor().setVisible(false);
      const labels = document.createElement('canvas'); labels.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3'; chart.root.append(labels);
      const labelPoints: Array<{level:number;segment:ContourSegment}> = [];
      for (const contour of contours) { const distance = Math.max(1,Math.floor(contour.segments.length / (contour.level === 75 ? 3 : 8))); for (let i = Math.floor(distance / 2); i < contour.segments.length; i += distance) labelPoints.push({level:contour.level,segment:contour.segments[i]}); }
      const drawLabels = () => {
        const width = Math.round(chart.width * chart.dpr), height = Math.round(chart.height * chart.dpr); if (labels.width !== width) labels.width = width; if (labels.height !== height) labels.height = height;
        const ctx = labels.getContext('2d')!; ctx.setTransform(chart.dpr,0,0,chart.dpr,0,0); ctx.clearRect(0,0,chart.width,chart.height); ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 2.4; ctx.strokeStyle = '#66653ecc'; ctx.fillStyle = '#fffbd0';
        for (const {level,segment} of labelPoints) {
          const x = (segment.start.x + segment.end.x) / 2, y = (segment.start.y + segment.end.y) / 2, px = chart.plot.left + chart.getDefaultAxisX().valueToFraction(x) * chart.plot.width, py = chart.plot.top + (1 - chart.getDefaultAxisY().valueToFraction(y)) * chart.plot.height;
          if (px < chart.plot.left + 12 || px > chart.plot.left + chart.plot.width - 12 || py < chart.plot.top + 9 || py > chart.plot.top + chart.plot.height - 9) continue;
          const xAxis = chart.getDefaultAxisX(), yAxis = chart.getDefaultAxisY();
          let angle = Math.atan2(-(yAxis.valueToFraction(segment.end.y) - yAxis.valueToFraction(segment.start.y)) * chart.plot.height, (xAxis.valueToFraction(segment.end.x) - xAxis.valueToFraction(segment.start.x)) * chart.plot.width); if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
          ctx.save(); ctx.translate(px,py); ctx.rotate(angle); ctx.strokeText(level.toFixed(1),0,0); ctx.fillText(level.toFixed(1),0,0); ctx.restore();
        }
      };
      const token = chart.on('render',drawLabels); drawLabels();
      const tooltip = document.createElement('div'); tooltip.className = 'shared-cursor-table'; tooltip.hidden = true; chart.root.append(tooltip); const controller = new AbortController();
      chart.overlay.addEventListener('pointermove',(event:PointerEvent) => {
        const bounds = chart.overlay.getBoundingClientRect(), px = event.clientX - bounds.left, py = event.clientY - bounds.top, x = Math.floor(chart.getDefaultAxisX().fractionToValue((px-chart.plot.left)/chart.plot.width)), y = Math.floor(chart.getDefaultAxisY().fractionToValue(1-(py-chart.plot.top)/chart.plot.height));
        tooltip.hidden = x < 0 || x >= size || y < 0 || y >= size; if (tooltip.hidden) return; const row = document.createElement('div'); row.className = 'cursor-row'; row.textContent = `(${x}, ${y})  ${rows[y][x].toFixed(2)} °C`; tooltip.replaceChildren(row); tooltip.style.left = `${Math.min(px+15,chart.width-tooltip.offsetWidth-8)}px`; tooltip.style.top = `${Math.max(chart.plot.top,py-tooltip.offsetHeight-12)}px`;
      },{signal:controller.signal});
      chart.overlay.addEventListener('pointerleave',() => {tooltip.hidden=true;},{signal:controller.signal});
      return {charts:[chart],dispose:() => {controller.abort();chart.off('render',token);labels.remove();tooltip.remove();wrapper.remove();},snapshot:() => ({columns:size,rows:size,samples:size*size,inputBytes:data.byteLength,discreteThresholds:[0,25,50,75],contours:contours.map(contour => ({level:contour.level,segments:contour.segments.length})),contourLabels:labelPoints.length,fieldOrigin:'independent radial field',temperatureAtCenter:rows[500][500]})};
    },
  },
];
