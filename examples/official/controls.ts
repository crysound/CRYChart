export interface Trace { name: string; color: string; points: { x: number; y: number }[]; series: any; unit?: string; pointCount?: number; pointAt?: (index: number) => { x: number; y: number }; pointLabel?: (point: { x: number; y: number }) => string; markerShape?: 'circle' | 'square' | 'star' | 'triangle-down'; }
export const day = 86400000;
export const dateLabel = (value: number) => {
  const date = new Date(value);
  return `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()} ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}:00`;
};

export function configureDates(chart: any) {
  const axis = chart.getDefaultAxisX();
  axis.setTickStrategy('datetime', (strategy: any) => strategy
    .setMajorTickPlacement(({ interval: { start, end } }: { interval: { start: number; end: number } }) => {
      const steps = [3600000, 10800000, 21600000, 43200000, day, 2 * day, 3 * day, 7 * day, 14 * day, 30 * day, 60 * day, 90 * day, 120 * day, 180 * day, 365 * day];
      const step = steps.find(value => (end - start) / value <= 10) ?? steps[steps.length - 1];
      const result = [];
      for (let value = Math.ceil(start / step) * step; value <= end; value += step) result.push({ position: value });
      return result;
    })
    .setFormattingFunction((value: number) => {
      const date = new Date(value), span = axis.getInterval().end - axis.getInterval().start;
      if (span < day * 3) return `${date.getUTCDate()}日 ${String(date.getUTCHours()).padStart(2, '0')}:00`;
      if (span < day * 180) return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
      return `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}`;
    }));
}

/** Input behavior reconstructed from visible observations, with no vendor implementation used. */
export function xNavigation(chart: any, reset: () => void, onManual: () => void = () => {}, dragY = false) {
  chart.setUserInteractions(false);
  const overlay = chart.overlay as HTMLCanvasElement, root = chart.root as HTMLElement;
  const region = document.createElement('div'); region.className = 'box-selection'; root.append(region);
  const controller = new AbortController(), options = { capture: true, signal: controller.signal };
  let drag: { x: number; y: number; interval: { start: number; end: number }; vertical: { start: number; end: number }; pan: boolean } | undefined;
  const x = (event: MouseEvent) => Math.max(chart.plot.left, Math.min(chart.plot.left + chart.plot.width, event.clientX - overlay.getBoundingClientRect().left));
  const y = (event: MouseEvent) => Math.max(chart.plot.top, Math.min(chart.plot.top + chart.plot.height, event.clientY - overlay.getBoundingClientRect().top));
  overlay.addEventListener('pointerdown', event => {
    const position = x(event);
    drag = { x: position, y: y(event), interval: chart.getDefaultAxisX().getInterval(), vertical: chart.getDefaultAxisY().getInterval(), pan: event.button !== 0 };
    overlay.setPointerCapture(event.pointerId); event.stopImmediatePropagation(); event.preventDefault();
    if (!drag.pan) { region.hidden = false; region.style.top = `${dragY ? drag.y : chart.plot.top}px`; region.style.height = `${dragY ? 0 : chart.plot.height}px`; region.style.left = `${position}px`; region.style.width = '0px'; }
  }, options);
  overlay.addEventListener('pointermove', event => {
    if (!drag) return;
    const position = x(event), span = drag.interval.end - drag.interval.start;
    if (drag.pan) { const shift = (drag.x - position) / chart.plot.width * span; chart.getDefaultAxisX().setInterval({ start: drag.interval.start + shift, end: drag.interval.end + shift }); if (dragY) {const shiftY = (y(event) - drag.y) / chart.plot.height * (drag.vertical.end - drag.vertical.start); chart.getDefaultAxisY().setInterval({start: drag.vertical.start + shiftY,end: drag.vertical.end + shiftY});} onManual(); }
    else { region.style.left = `${Math.min(drag.x, position)}px`; region.style.width = `${Math.abs(drag.x - position)}px`; if (dragY) {region.style.top = `${Math.min(drag.y,y(event))}px`;region.style.height = `${Math.abs(drag.y-y(event))}px`;} }
    event.stopImmediatePropagation();
  }, options);
  overlay.addEventListener('pointerup', event => {
    if (!drag) return;
    const position = x(event);
    if (!drag.pan && Math.abs(position - drag.x) > 5) {
      const span = drag.interval.end - drag.interval.start;
      chart.getDefaultAxisX().setInterval({ start: drag.interval.start + (Math.min(position, drag.x) - chart.plot.left) / chart.plot.width * span, end: drag.interval.start + (Math.max(position, drag.x) - chart.plot.left) / chart.plot.width * span }); onManual();
      if (dragY && Math.abs(y(event)-drag.y)>5) {const spanY=drag.vertical.end-drag.vertical.start;chart.getDefaultAxisY().setInterval({start:drag.vertical.end-(Math.max(y(event),drag.y)-chart.plot.top)/chart.plot.height*spanY,end:drag.vertical.end-(Math.min(y(event),drag.y)-chart.plot.top)/chart.plot.height*spanY});}
    }
    drag = undefined; region.hidden = true; if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId); event.stopImmediatePropagation();
  }, options);
  overlay.addEventListener('pointercancel', () => { drag = undefined; region.hidden = true; }, options);
  overlay.addEventListener('wheel', event => {
    event.preventDefault(); event.stopImmediatePropagation();
    const axis = chart.getDefaultAxisX(), interval = axis.getInterval(), fraction = (x(event) - chart.plot.left) / chart.plot.width, anchor = interval.start + fraction * (interval.end - interval.start), scale = Math.exp(Math.max(-1, Math.min(1, event.deltaY * 0.001)));
    axis.setInterval({ start: anchor + (interval.start - anchor) * scale, end: anchor + (interval.end - anchor) * scale }); onManual();
  }, { ...options, passive: false });
  overlay.addEventListener('dblclick', event => { event.stopImmediatePropagation(); reset(); }, options);
  overlay.addEventListener('contextmenu', event => event.preventDefault(), options);
  region.hidden = true;
  return () => { controller.abort(); region.remove(); };
}

function nearest(trace: Trace, x: number) {
  const count = trace.pointCount ?? trace.points.length, point = trace.pointAt ?? ((index: number) => trace.points[index]);
  if (!count || x < point(0).x || x > point(count - 1).x) return undefined;
  let lo = 0, hi = count - 1;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (point(mid).x < x) lo = mid + 1; else hi = mid; }
  return lo && Math.abs(point(lo - 1).x - x) <= Math.abs(point(lo).x - x) ? point(lo - 1) : point(lo);
}

export function sharedCursor(chart: any, traces: Trace[], formatX: (x: number) => string) {
  chart.setCursorMode(undefined);
  chart.getCursor().setVisible(false);
  const root = chart.root as HTMLElement, overlay = chart.overlay as HTMLCanvasElement;
  const canvas = document.createElement('canvas'); canvas.className = 'shared-cursor-canvas'; root.append(canvas);
  const table = document.createElement('div'); table.className = 'shared-cursor-table'; root.append(table); table.hidden = true;
  const controller = new AbortController(); let pointer: { x: number; y: number } | undefined;
  function draw() {
    const dpr = chart.dpr, width = Math.round(chart.width * dpr), height = Math.round(chart.height * dpr);
    if (canvas.width !== width) canvas.width = width; if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, chart.width, chart.height);
    table.hidden = true; if (!pointer) return;
    const rect = chart.plot;
    if (pointer.x < rect.left || pointer.x > rect.left + rect.width || pointer.y < rect.top || pointer.y > rect.top + rect.height) return;
    const xValue = chart.getDefaultAxisX().fractionToValue((pointer.x - rect.left) / rect.width);
    const values = traces.filter(trace => trace.series.getVisible()).map(trace => ({ trace, point: nearest(trace, xValue) })).filter(item => item.point);
    if (!values.length) return;
    const exactX = values[0].point!.x, px = rect.left + chart.getDefaultAxisX().valueToFraction(exactX) * rect.width;
    ctx.strokeStyle = '#d8dbb6a8'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(px, rect.top); ctx.lineTo(px, rect.top + rect.height); ctx.stroke();
    table.replaceChildren(); const heading = document.createElement('div'); heading.className = 'cursor-date'; heading.textContent = formatX(exactX); table.append(heading);
    ctx.font = '11px sans-serif';
    for (const { trace, point } of values) {
      const axisY = trace.series.getAxisY?.() ?? chart.getDefaultAxisY(), py = rect.top + (1 - axisY.valueToFraction(point!.y)) * rect.height;
      if (py >= rect.top && py <= rect.top + rect.height) {
        ctx.strokeStyle = '#d8dbb680'; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(rect.left, py); ctx.lineTo(rect.left + rect.width, py); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle = trace.color; ctx.strokeStyle = '#f6f6dc'; ctx.beginPath(); ctx.arc(px, py, 5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
        const text = point!.y.toFixed(trace.unit ? 2 : 1), labelWidth = ctx.measureText(text).width + 10;
        ctx.fillStyle = '#171b20'; ctx.fillRect(rect.left - labelWidth - 3, py - 9, labelWidth, 18); ctx.strokeStyle = '#d8dbb6'; ctx.strokeRect(rect.left - labelWidth - 3, py - 9, labelWidth, 18); ctx.fillStyle = '#f5f3ce'; ctx.textAlign = 'right'; ctx.fillText(text, rect.left - 8, py + 4);
      }
      const row = document.createElement('div'); row.className = 'cursor-row'; const dot = document.createElement('i'); dot.style.background = trace.color; const name = document.createElement('span'); name.textContent = trace.name; const value = document.createElement('strong'); value.textContent = trace.pointLabel?.(point!) ?? `${point!.y.toFixed(trace.unit ? 2 : 1)}${trace.unit ? ' ' + trace.unit : ''}`; row.append(dot, name, value); table.append(row);
    }
    const text = formatX(exactX), w = ctx.measureText(text).width + 12, labelX = Math.max(rect.left, Math.min(px - w / 2, rect.left + rect.width - w)); ctx.fillStyle = '#171b20'; ctx.fillRect(labelX, rect.top + rect.height + 3, w, 20); ctx.strokeStyle = '#d8dbb6'; ctx.strokeRect(labelX, rect.top + rect.height + 3, w, 20); ctx.fillStyle = '#f5f3ce'; ctx.textAlign = 'center'; ctx.fillText(text, labelX + w / 2, rect.top + rect.height + 17);
    table.hidden = false; table.style.left = `${Math.max(rect.left, Math.min(px + 18, chart.width - table.offsetWidth - 5))}px`; table.style.top = `${Math.max(rect.top, Math.min(pointer.y - table.offsetHeight / 2, rect.top + rect.height - table.offsetHeight))}px`;
  }
  overlay.addEventListener('pointermove', event => { const bounds = overlay.getBoundingClientRect(); pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }; draw(); }, { signal: controller.signal });
  overlay.addEventListener('pointerleave', () => { pointer = undefined; draw(); }, { signal: controller.signal });
  const token = chart.on('render', draw);
  return () => { chart.off('render', token); controller.abort(); canvas.remove(); table.remove(); };
}

export function pointCursor(chart: any, traces: Trace[], formatX: (x: number) => string) {
  chart.setCursorMode(undefined);
  chart.getCursor().setVisible(false);
  const root = chart.root as HTMLElement, overlay = chart.overlay as HTMLCanvasElement;
  const table = document.createElement('div'); table.className = 'shared-cursor-table'; table.hidden = true; root.append(table);
  const controller = new AbortController();
  overlay.addEventListener('pointermove', event => {
    const bounds = overlay.getBoundingClientRect(), px = event.clientX - bounds.left, py = event.clientY - bounds.top;
    let nearest: { trace: Trace; point: { x: number; y: number }; x: number; y: number } | undefined, best = 22 ** 2;
    for (const trace of traces) if (trace.series.getVisible()) for (const point of trace.points) {
      const axisX = trace.series.getAxisX?.() ?? chart.getDefaultAxisX(), axisY = trace.series.getAxisY?.() ?? chart.getDefaultAxisY();
      const x = chart.plot.left + axisX.valueToFraction(point.x) * chart.plot.width, y = chart.plot.top + (1 - axisY.valueToFraction(point.y)) * chart.plot.height;
      const distance = (px - x) ** 2 + (py - y) ** 2; if (distance < best) { best = distance; nearest = { trace, point, x, y }; }
    }
    table.hidden = !nearest; if (!nearest) return;
    const heading = document.createElement('div'); heading.className = 'cursor-date'; heading.textContent = formatX(nearest.point.x);
    const row = document.createElement('div'); row.className = 'cursor-row'; const dot = document.createElement('i'); dot.style.background = nearest.trace.color;
    const label = document.createElement('span'); label.textContent = nearest.trace.name; const value = document.createElement('strong'); value.textContent = nearest.trace.pointLabel?.(nearest.point) ?? `${nearest.point.y.toFixed(2)}${nearest.trace.unit ? ' ' + nearest.trace.unit : ''}`;
    row.append(dot, label, value); table.replaceChildren(heading, row); table.style.left = `${Math.max(chart.plot.left, Math.min(nearest.x + 18, chart.width - table.offsetWidth - 8))}px`; table.style.top = `${Math.max(chart.plot.top, nearest.y - table.offsetHeight - 12)}px`;
  }, { signal: controller.signal });
  overlay.addEventListener('pointerleave', () => { table.hidden = true; }, { signal: controller.signal });
  return () => { controller.abort(); table.remove(); };
}

export function legend(container: HTMLElement, traces: Trace[]) {
  const bar = document.createElement('div'); bar.className = 'official-legend';
  for (const trace of traces) { const button = document.createElement('button'), dot = document.createElement('i'); dot.style.background = trace.color;
    if (trace.markerShape === 'square') dot.style.borderRadius = '0';
    if (trace.markerShape === 'triangle-down') { dot.style.borderRadius = '0'; dot.style.clipPath = 'polygon(0 0,100% 0,50% 100%)'; }
    if (trace.markerShape === 'star') { dot.style.width = dot.style.height = '11px'; dot.style.borderRadius = '0'; dot.style.clipPath = 'polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 95%,50% 72%,21% 95%,32% 57%,2% 35%,39% 35%)'; }
    button.append(dot, document.createTextNode(trace.name)); button.setAttribute('aria-pressed', 'true'); button.onclick = () => { const visible = !trace.series.getVisible(); trace.series.setVisible(visible); button.setAttribute('aria-pressed', String(visible)); }; bar.append(button); }
  container.append(bar); return () => bar.remove();
}

export function rangeHandles(overview: any, main: any, bounds: { start: number; end: number }, options: { minimumWidth?: number; formatValue?: (value: number) => string } = {}) {
  const root = overview.root as HTMLElement, selection = document.createElement('div'); selection.className = 'range-selection'; selection.dataset.kind = 'move';
  const left = document.createElement('button'), right = document.createElement('button'); left.dataset.kind = 'start'; right.dataset.kind = 'end'; left.className = right.className = 'range-handle'; left.classList.add('start'); right.classList.add('end'); left.setAttribute('aria-label', '窗口左边界'); right.setAttribute('aria-label', '窗口右边界'); left.textContent = right.textContent = 'Ⅱ'; selection.append(left, right); root.append(selection);
  const shadeLeft = document.createElement('div'), shadeRight = document.createElement('div'); shadeLeft.className = shadeRight.className = 'range-shade'; root.append(shadeLeft, shadeRight);
  const controller = new AbortController(); let drag: { mode: string; x: number; interval: { start: number; end: number } } | undefined;
  const minWidth = options.minimumWidth ?? Math.max(1, (bounds.end - bounds.start) / 1000), formatValue = options.formatValue ?? dateLabel;
  const update = () => { const rect = overview.plot, interval = main.getDefaultAxisX().getInterval(), a = overview.getDefaultAxisX().valueToFraction(interval.start), b = overview.getDefaultAxisX().valueToFraction(interval.end), x0 = rect.left + a * rect.width, x1 = rect.left + b * rect.width; selection.style.cssText = `left:${x0}px;top:${rect.top}px;width:${Math.max(1, x1 - x0)}px;height:${rect.height}px`; shadeLeft.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${Math.max(0, x0 - rect.left)}px;height:${rect.height}px`; shadeRight.style.cssText = `left:${x1}px;top:${rect.top}px;width:${Math.max(0, rect.left + rect.width - x1)}px;height:${rect.height}px`; left.setAttribute('aria-valuetext', formatValue(interval.start)); right.setAttribute('aria-valuetext', formatValue(interval.end)); };
  selection.addEventListener('pointerdown', event => { const target = event.target as HTMLElement; drag = { mode: target.dataset.kind ?? 'move', x: event.clientX, interval: main.getDefaultAxisX().getInterval() }; selection.setPointerCapture(event.pointerId); event.preventDefault(); event.stopPropagation(); }, { signal: controller.signal });
  selection.addEventListener('pointermove', event => {
    if (!drag) return; const delta = (event.clientX - drag.x) / overview.plot.width * (bounds.end - bounds.start); let { start, end } = drag.interval;
    if (drag.mode === 'start') start = Math.max(bounds.start, Math.min(end - minWidth, start + delta));
    else if (drag.mode === 'end') end = Math.min(bounds.end, Math.max(start + minWidth, end + delta));
    else { const shift = Math.max(bounds.start - start, Math.min(bounds.end - end, delta)); start += shift; end += shift; }
    main.getDefaultAxisX().setInterval({ start, end }); update();
  }, { signal: controller.signal });
  selection.addEventListener('pointerup', event => { drag = undefined; if (selection.hasPointerCapture(event.pointerId)) selection.releasePointerCapture(event.pointerId); }, { signal: controller.signal });
  selection.addEventListener('pointercancel', () => { drag = undefined; }, { signal: controller.signal });
  for (const [handle, mode] of [[left, 'start'], [right, 'end']] as const) handle.addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; const interval = main.getDefaultAxisX().getInterval(), shift = (event.key === 'ArrowRight' ? 1 : -1) * (bounds.end - bounds.start) / 100; interval[mode] = mode === 'start' ? Math.max(bounds.start, Math.min(interval.end - minWidth, interval.start + shift)) : Math.min(bounds.end, Math.max(interval.start + minWidth, interval.end + shift)); main.getDefaultAxisX().setInterval(interval); event.preventDefault(); }, { signal: controller.signal });
  const render = overview.on('render', update), change = main.getDefaultAxisX().onIntervalChange(update); update();
  return () => { controller.abort(); overview.off('render', render); main.getDefaultAxisX().offIntervalChange(change); selection.remove(); shadeLeft.remove(); shadeRight.remove(); };
}
