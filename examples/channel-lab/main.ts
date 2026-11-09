import {
  ChartXY,
  cryChart,
  DataSetXY,
  ColorRGBA,
  SolidFill,
  SolidLine,
  AutoCursorModes,
  Themes,
  type Axis,
  type PointLineAreaSeries,
} from "../../src/index";
import { installGpuMeter, getGpuBufferStats } from "./gpu-meter";
installGpuMeter();

const rate = 48000,
  step = 1000 / rate,
  initialCount = rate,
  stage = document.querySelector<HTMLElement>("#stage")!;
const engine=cryChart();
const element = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id)! as T;
const frames = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
const mib = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MiB`,
  format = (n: number) => n.toLocaleString("en-US");
type Channel = {
  id: number;
  data: DataSetXY;
  axis?: Axis;
  series?: PointLineAreaSeries;
  color: ReturnType<typeof ColorRGBA>;
  identity:number;
  source:{start:number;count:number;raw:string;render:string};
};
// Diagnostic fingerprint of every source byte. Two 32-bit accumulators are
// retained, not the source arrays. This is an integrity check, not cryptography.
function fingerprint(slices:readonly ArrayBufferView[]){let fnv=2166136261,sum=0,bytes=0;for(const slice of slices){const view=new Uint8Array(slice.buffer,slice.byteOffset,slice.byteLength);for(let i=0;i<view.length;i++){fnv=Math.imul(fnv^view[i],16777619);sum=(sum+Math.imul(view[i]+1,++bytes))>>>0;}}return`${bytes}:${(fnv>>>0).toString(16).padStart(8,'0')}:${sum.toString(16).padStart(8,'0')}`;}
let chart: ChartXY | undefined,
  channels: Channel[] = [],
  axes: Axis[] = [],
  preset = new URLSearchParams(location.search).get("preset") === "opentest" ? "opentest" : "standard",
  hidden = false,
  layout = "stacked",
  storage = "float64",
  windowMS = 15000,
  historyMS = 60000,
  nextSample = 0,
  generation = 0,
  ready = false,
  running = false,
  following = true,
  frame = 0,
  streamStart = 0,
  streamFirst = 0,
  peakHeap = 0,
  peakData = 0,
  lastHud = 0,
  createdDataSets = 0,
  disposedDataSets = 0,
  createdSeries = 0,
  disposedSeries = 0,
  createdCharts = 0,
  disposedCharts = 0,
  labelKey = "";
let lastExport: any,
  lastDisposal: any,
  ringResult: any,
  lastPointer: any,
  error = "",
  lastRequestedSample = 0;
const getHeap = () => {
  const heap = (performance as any).memory;
  return heap
    ? {
        used: heap.usedJSHeapSize,
        total: heap.totalJSHeapSize,
        limit: heap.jsHeapSizeLimit,
      }
    : undefined;
};
const color = (index: number) => {
  const angle = (index * 137.507764 * Math.PI) / 180;
  return ColorRGBA(
    Math.round(145 + 100 * Math.sin(angle)),
    Math.round(145 + 100 * Math.sin(angle + 2.1)),
    Math.round(145 + 100 * Math.sin(angle + 4.2)),
  );
};
function rawValue(index: number, channel: number) {
  if (index % rate === 12345) return Infinity;
  if (index % rate === 23456) return NaN;
  if (index % rate === 32000 && channel === 0) return 5;
  if (index % rate === 33000 && channel === 0) return -5;
  const t = index / rate;
  return (
    0.68 * Math.sin(2 * Math.PI * (37 + channel * 0.37) * t + channel * 0.43) +
    0.19 * Math.sin(2 * Math.PI * (113 + channel * 0.11) * t) +
    0.06 * Math.sin(2 * Math.PI * 3 * t)
  );
}
function batch(start: number, count: number, channel: number) {
  const Type = storage === "float64" ? Float64Array : Float32Array,
    raw = new Type(count),
    render = new Type(count);
  for (let i = 0; i < count; i++) {
    raw[i] = rawValue(start + i, channel);
    render[i] = Number.isFinite(raw[i]) ? raw[i] : NaN;
  }
  return { yValues: raw, renderYValues: render };
}
function status(text: string, failed = false) {
  element("status").textContent = text;
  element("status").classList.toggle("error", failed);
}
function controls() {
  for (const id of [
    "load",
    "preset",
    "layout",
    "storage",
    "channels",
    "window-seconds",
    "history-seconds",
    "play",
    "fit",
    "follow",
    "add",
    "remove",
    "export",
    "ring",
    "clear",
    "visibility",
  ]) {
    const control = element<
      HTMLInputElement | HTMLButtonElement | HTMLSelectElement
    >(id);
    control.disabled = !ready;
  }
  element<HTMLButtonElement>("dispose").disabled = !chart;
  element<HTMLButtonElement>("restore").disabled = Boolean(chart);
  element<HTMLButtonElement>("add").disabled = !ready || channels.length >= 128;
  element<HTMLButtonElement>("remove").disabled =
    !ready || channels.length <= 1;
  element("play").textContent = running ? "暂停" : "开始";
  element("visibility").textContent = hidden ? "显示曲线" : "隐藏曲线";
  element("preset-description").textContent = preset === "opentest"
    ? "OpenTest 波形配置：2 px 不透明线、显示缓存、覆盖合成与分区内裁切。保留全部原始值和 NaN 断线；这不是性能测试。"
    : "普通配置：保留库的默认渲染选项，线宽 1.25 px。切换预设会暂停采样，并保留现有数据。";
  element("run-state").textContent = error
    ? "错误"
    : !chart
      ? "已释放"
      : !ready
        ? "载入中"
        : running
          ? "采样中"
          : "已暂停";
}
function makeChart() {
  chart = engine.ChartXY({
    container: stage,
    theme: Themes.darkGold,
    renderer: "webgl2",
    ...(preset === "opentest" ? {
      experimentalLineCoverage: true,
      experimentalLineDisplayPixels: 1,
      experimentalOwnedCoverageFrame: true,
      experimentalGpuClipPolicy: "contained" as const,
    } : {}),
  });
  createdCharts++;
  labelKey = "";
  stage.classList.remove("empty");
  chart
    .setPadding({ left: 10, right: 8, top: -30, bottom: 6 })
    .setAutoCursorMode(AutoCursorModes.disabled);
  chart.getDefaultAxisY().dispose();
  chart
    .getDefaultAxisX()
    .setTitle("Time (s)")
    .setTickStrategy("numeric", (s) =>
      s.setFormattingFunction(
        (value: number) =>
          `${(value / 1000).toFixed(Math.abs(value) < 1000 ? 2 : 1)}`,
      ),
    );
  chart.overlay!.addEventListener("pointerdown", () => {
    following = false;
  });
  chart.overlay!.addEventListener(
    "wheel",
    () => {
      following = false;
    },
    { passive: true },
  );
  chart.overlay!.addEventListener("pointermove", inspectPointer);
  chart.overlay!.addEventListener("pointerleave", () => {
    lastPointer = undefined;
  });
  chart.on("render", () => {
    drawLabels();
    updateHud();
  });
}
function stop() {
  running = false;
  cancelAnimationFrame(frame);
  frame = 0;
  controls();
}
function clearSeries() {
  for (const channel of channels)
    if (channel.series) {
      channel.series.dispose();
      disposedSeries++;
      channel.series = undefined;
      channel.axis = undefined;
    }
  for (const axis of axes) axis.dispose();
  axes = [];
  chart?.renderNow();
}
function clearChannels() {
  clearSeries();
  for (const channel of channels) {
    channel.data.dispose();
    disposedDataSets++;
  }
  channels = [];
}
function resetY() {
  for (const axis of axes) axis.setInterval({ start: -1.15, end: 1.15 });
}
function bindSeries() {
  if (!chart) return;
  clearSeries();
  const shared =
    layout === "shared"
      ? chart.addAxisY({ iStack: 0, iParallel: 0 }).setTitle("Amplitude")
      : undefined;
  if (shared) axes.push(shared);
  for (const channel of channels) {
    const axis =
      shared ?? chart.addAxisY({ iStack: -channel.id, iParallel: 0 });
    if (!shared) axes.push(axis);
    axis.setInterval({ start: -1.15, end: 1.15 });
    if (!shared) {
      axis
        .setVisible(channels.length <= 16)
        .setTitle(channels.length <= 16 ? `CH ${channel.id + 1}` : "")
        .setTitleRotation(0)
        .setTickStrategy("numeric", (s) =>
          s.setMajorTickPlacement(() => [{ position: 0, label: "0" }]),
        );
    }
    channel.axis = axis;
    channel.series = chart
      .addLineSeries({ dataSet: channel.data, axisY: axis })
      .setDataMapping({ x: "xValues", y: "renderYValues" })
      .setName(`Channel ${channel.id + 1}`)
      .setStrokeStyle(
        new SolidLine({
          thickness: preset === "opentest" ? 2 : 1.25,
          fillStyle: new SolidFill({ color: channel.color }),
        }),
      );
    channel.series.setVisible(!hidden);
    createdSeries++;
  }
  labelKey = "";
  chart.renderNow();
  drawLabels();
}
function createChannel(id: number, start: number, count: number) {
  const Type = storage === "float64" ? Float64Array : Float32Array,
    data = new DataSetXY({
      schema: {
        xValues: { storage: Float64Array, pattern: "progressive", auto: true },
        yValues: { storage: Type },
        renderYValues: { storage: Type },
      },
      includesNaN: true,
    });
  createdDataSets++;
  data.setMaxSampleCount({
    mode: "auto",
    initial: Math.min(initialCount, Math.floor(historyMS / step)),
    max: Math.floor(historyMS / step),
  });
  const input=batch(start,count,id),source={start,count,raw:fingerprint([input.yValues]),render:fingerprint([input.renderYValues])};
  data.appendSamples(input, { start: start * step, step });
  return { id, data, color: color(id),identity:createdDataSets,source } as Channel;
}
function follow() {
  if (!chart) return;
  const end = nextSample * step;
  chart.getDefaultAxisX().setInterval({ start: end - windowMS, end });
}
function fit() {
  if (!chart || !channels.length) return;
  if (!channels[0].data.getSampleCount()) return;
  following = false;
  const data = channels[0].data,
    start = data.getValue("xValues", 0)!,
    end = data.getValue("xValues", data.getSampleCount() - 1)!;
  chart
    .getDefaultAxisX()
    .setInterval({ start, end: end > start ? end : start + step });
  resetY();
}
async function load() {
  const version = ++generation;
  stop();
  ready = false;
  error = "";
  controls();
  try {
    const requested = Number(element<HTMLSelectElement>("channels").value);
    if (!Number.isInteger(requested) || requested < 1 || requested > 128)
      throw new RangeError("通道数必须为1到128");
    storage = element<HTMLSelectElement>("storage").value;
    layout = element<HTMLSelectElement>("layout").value;
    windowMS = Number(element<HTMLInputElement>("window-seconds").value) * 1000;
    historyMS =
      Number(element<HTMLInputElement>("history-seconds").value) * 1000;
    if (
      !(
        windowMS >= 100 &&
        windowMS <= 60000 &&
        historyMS >= 1000 &&
        historyMS <= 60000
      )
    )
      throw new RangeError("窗口须为0.1至60秒，历史须为1至60秒");
    if (!chart) makeChart();
    clearChannels();
    hidden = false;
    nextSample = initialCount;
    lastRequestedSample = nextSample;
    following = true;
    for (let i = 0; i < requested; i++) {
      if (version !== generation) return;
      channels.push(createChannel(i, 0, initialCount));
      if (i % 8 === 7) {
        status(
          `已生成 ${i + 1}/${requested} 通道；每通道 ${format(initialCount)} 点`,
        );
        await frames();
      }
    }
    if (version !== generation) return;
    bindSeries();
    follow();
    await frames();
    if (version !== generation) return;
    ready = true;
    controls();
    updateHud(true);
    element("follow").textContent = `跟随 ${windowMS / 1000} 秒窗口`;
    status(
      `${channels.length} 通道已载入，每通道1秒真实样本；未验证完整 ${historyMS / 1000} 秒容量。`,
    );
  } catch (cause) {
    error = String(cause);
    ready = true;
    status(error, true);
    controls();
  }
}
async function changePreset(value: string) {
  if (!ready || !chart || (value !== "standard" && value !== "opentest")) return;
  stop();
  ready = false;
  const version = ++generation, x = chart.getDefaultAxisX().getInterval(),
    intervals = channels.map(channel => channel.axis!.getInterval());
  controls();
  clearSeries();
  chart.dispose();
  disposedCharts++;
  chart = undefined;
  preset = value;
  makeChart();
  bindSeries();
  chart!.getDefaultAxisX().setInterval(x);
  for (let i = 0; i < channels.length; i++) channels[i].axis!.setInterval(intervals[i]);
  chart!.renderNow();
  await frames();
  if (version !== generation) return;
  ready = true;
  controls();
  updateHud(true);
  status("预设已切换，采样已暂停；现有原始数据、数值精度和视区保持不变。");
}
function clearData() {
  if (!ready || !chart) return;
  stop();
  for (const channel of channels) {
    channel.data.clear();
    channel.source = { start: 0, count: 0, raw: fingerprint([]), render: fingerprint([]) };
  }
  nextSample = 0;
  lastRequestedSample = 0;
  following = true;
  follow();
  chart.renderNow();
  updateHud(true);
  status("数据已清空，时间起点已归零；点击开始可重新采样。");
}
function toggleVisibility() {
  if (!ready || !chart) return;
  stop();
  hidden = !hidden;
  for (const channel of channels) channel.series!.setVisible(!hidden);
  chart.renderNow();
  controls();
  updateHud(true);
  status(hidden ? "曲线已隐藏，全部原始数据仍保留。" : "曲线已恢复，全部原始数据保持不变。");
}
function tick(now: number) {
  if (!running || !chart) return;
  const target = streamFirst + Math.floor(((now - streamStart) * rate) / 1000),
    amount = target - nextSample;
  lastRequestedSample = target;
  if (amount > 0) {
    for (const channel of channels)
      channel.data.appendSamples(batch(nextSample, amount, channel.id), {
        start: nextSample * step,
        step,
      });
    nextSample = target;
    if (following) follow();
  }
  updateHud();
  frame = requestAnimationFrame(tick);
}
function play() {
  if (running) {
    stop();
    status("采样已暂停，全部保留数据仍可缩放、平移和导出。");
    return;
  }
  if (!ready || !chart) return;
  running = true;
  streamFirst = nextSample;
  streamStart = performance.now();
  controls();
  status("正在按48 kHz生成全部通道样本；保留容量按需增长。");
  frame = requestAnimationFrame(tick);
}
function drawLabels() {
  if (!chart) return;
  const key = JSON.stringify([layout, channels.length, chart.plot]);
  if (labelKey === key) return;
  labelKey = key;
  const old = stage.querySelector(".channel-label-layer");
  old?.remove();
  if (layout !== "stacked" || channels.length <= 16) return;
  const layer = document.createElement("div");
  layer.className = "channel-label-layer";
  const interval = channels.length > 64 ? 8 : 4;
  for (const channel of channels) {
    if (!channel.series) continue;
    const r = chart.getSeriesScreenRect(channel.series);
    if (channel.id % interval === 0) {
      const label = document.createElement("div");
      label.className = "pane-label";
      label.textContent = `${channel.id + 1}`;
      label.style.top = `${r.top + r.height / 2}px`;
      layer.append(label);
    }
    const separator = document.createElement("div");
    separator.className = "pane-separator";
    separator.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px`;
    layer.append(separator);
  }
  chart.root!.append(layer);
}
function inspectPointer(event: PointerEvent) {
  if (!chart || !ready || !channels.length) return;
  const bounds = chart.overlay!.getBoundingClientRect(),
    py = event.clientY - bounds.top;
  const channel =
    layout === "shared"
      ? channels[0]
      : channels.find((channel) => {
          const r = chart!.getSeriesScreenRect(channel.series!);
          return py >= r.top && py <= r.top + r.height;
        });
  if (!channel?.axis) return;
  const point = chart.translateCoordinate(event, {
      x: chart.getDefaultAxisX(),
      y: channel.axis,
    }),
    data = channel.data,
    first = data.getValue("xValues", 0)!;
  const index = Math.round((point.x - first) / step);
  if (index < 0 || index >= data.getSampleCount()) return;
  const raw = data.getValue("yValues", index)!,
    render = data.getValue("renderYValues", index)!,
    time = data.getValue("xValues", index)!;
  lastPointer = {
    channel: channel.id,
    time,
    raw: String(raw),
    render: String(render),
    axisValue: point.y,
  };
  element("inspector").textContent =
    `CH ${channel.id + 1} · ${time.toFixed(6)} ms\nraw Y = ${raw}  /  render Y = ${render}\n分区坐标 Y = ${point.y.toFixed(6)}`;
}
function updateHud(force = false) {
  const now = performance.now();
  if (!force && now - lastHud < 250) return;
  lastHud = now;
  const stats = channels.map((channel) => channel.data.getStorageStats()),
    count = stats.reduce((sum, item) => sum + item.sampleCount, 0),
    bytes = stats.reduce(
      (sum, item) => sum + item.denseTypedArrayBytes + item.snapshotBytes,
      0,
    ),
    render = chart?.getRenderStats(),
    heap = getHeap();
  peakData = Math.max(peakData, bytes);
  if (heap) peakHeap = Math.max(peakHeap, heap.used);
  element("point-count").textContent = format(count);
  element("duration").textContent =
    `每通道 ${((stats[0]?.sampleCount ?? 0) / rate).toFixed(3)} 秒；上限 ${historyMS / 1000} 秒`;
  element("data-bytes").textContent = mib(bytes);
  element("gpu-bytes").textContent = mib(
    getGpuBufferStats(chart?.canvas?.getContext("webgl2")).allocatedBytes,
  );
  element("gpu-vertices").textContent =
    `本帧提交样本 ${format(render?.submittedSamples ?? 0)}`;
  element("heap-bytes").textContent = heap ? mib(heap.used) : "未提供";
  element("peak-bytes").textContent = heap
    ? `采样峰值 ${mib(peakHeap)}；非RSS`
    : "此浏览器未开放堆统计";
  element("schema-state").textContent =
    `${channels.length} ch · raw/render ${storage === "float64" ? "F64" : "F32"} · X affine`;
}
async function exportPNG() {
  if (!chart) return;
  const image = await chart.exportToImage(),
    url = URL.createObjectURL(image);
  lastExport = {
    bytes: image.size,
    type: image.type,
    width: chart.canvas!.width,
    height: chart.canvas!.height,
    points: channels.reduce((sum, c) => sum + c.data.getSampleCount(), 0),
  };
  const link = document.createElement("a");
  link.href = url;
  link.download = `crychart-${channels.length}channels.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status(
    `已导出 ${lastExport.width} × ${lastExport.height} PNG，${format(lastExport.points)} 个保留样本。`,
  );
}
function dispose() {
  generation++;
  stop();
  const before = channels.map((channel) => channel.data.getStorageStats());
  clearChannels();
  const gl = chart?.canvas?.getContext("webgl2"),
    buffersBeforeDispose = getGpuBufferStats(gl);
  if (chart) {
    chart.dispose();
    disposedCharts++;
    chart = undefined;
  }
  axes = [];
  stage.classList.add("empty");
  ready = false;
  lastDisposal = {
    datasets: before.length,
    denseBytesBefore: before.reduce(
      (sum, s) => sum + s.denseTypedArrayBytes,
      0,
    ),
    buffersBeforeDispose,
    buffersAfterDispose: getGpuBufferStats(gl),
    createdDataSets,
    disposedDataSets,
    createdSeries,
    disposedSeries,
    createdCharts,
    disposedCharts,
  };
  controls();
  updateHud(true);
  status("已释放图表、数据列和系列；浏览器进程内存回收由浏览器管理。");
}
function runRing() {
  const dataset = new DataSetXY({
    schema: {
      xValues: { storage: Float64Array, auto: true },
      yValues: { storage: Float64Array },
      renderYValues: { storage: Float64Array },
    },
  }).setMaxSampleCount({ mode: "auto", initial: 8, max: 16 });
  const expected: Array<{ x: number; raw: number; render: number }> = [];
  let index = 0;
  for (const count of [9, 11, 7]) {
    const start = 1735689600000 + index * step,
      raw = new Float64Array(count),
      render = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      raw[i] = index + i === 17 ? Infinity : index + i;
      render[i] = Number.isFinite(raw[i]) ? raw[i] : NaN;
      expected.push({ x: start + i * step, raw: raw[i], render: render[i] });
    }
    dataset.appendSamples(
      { yValues: raw, renderYValues: render },
      { start, step },
    );
    index += count;
  }
  const retained = expected.slice(-16),
    actual = retained.map((_, offset) => dataset.getSample(offset)!),
    equal = (a: number, b: number) => Object.is(a, b);
  const passed = actual.every(
    (row, i) =>
      equal(row.xValues, retained[i].x) &&
      equal(row.yValues, retained[i].raw) &&
      equal(row.renderYValues, retained[i].render),
  );
  ringResult = {
    passed,
    appended: 27,
    retained: dataset.getSampleCount(),
    firstRetained: dataset.getNextSampleIndex() - dataset.getSampleCount(),
    capacity: dataset.getMaxSampleCount(),
    xKind: dataset.getColumnRuns("xValues").kind,
    storage: dataset.getStorageStats(),
    rawInfinityPreserved: actual.some(
      (row) => row.yValues === Infinity && Number.isNaN(row.renderYValues),
    ),
    rows: actual.map((row) => ({
      x: row.xValues,
      raw: String(row.yValues),
      render: String(row.renderYValues),
    })),
  };
  dataset.dispose();
  ringResult.disposedStorage = dataset.getStorageStats();
  element("ring-output").textContent = JSON.stringify(ringResult, null, 2);
  return ringResult;
}
function snapshot() {
  updateHud(true);
  return {
    ready,
    error,
    running,
    preset,
    hidden,
    requestedRenderOptions: preset === "opentest" ? {
      experimentalLineCoverage: true,
      experimentalLineDisplayPixels: 1,
      experimentalOwnedCoverageFrame: true,
      experimentalGpuClipPolicy: "contained",
    } : {},
    layout,
    storage,
    rate,
    step,
    initialSeconds: 1,
    configuredWindowMS: windowMS,
    configuredHistoryMS: historyMS,
    nextSample,
    lastRequestedSample,
    following,
    channelCount: channels.length,
    totalSamples: channels.reduce((sum, c) => sum + c.data.getSampleCount(), 0),
    fullHistoryValidated: false,
    chartInstances: chart ? 1 : 0,
    engineChartCount:engine.getChartCount(),
    chartDisposed: !chart,
    plot: chart?.plot,
    x: chart?.getDefaultAxisX().getInterval(),
    stats: chart?.getRenderStats(),
    gpuBuffers: getGpuBufferStats(chart?.canvas?.getContext("webgl2")),
    channels: channels.map((channel) => ({
      id: channel.id,
      identity:channel.identity,
      count: channel.data.getSampleCount(),
      storage: channel.data.getStorageStats(),
      xKind: channel.data.getColumnRuns("xValues").kind,
      rawProbe: String(channel.data.getValue("yValues", 12345)),
      renderProbe: String(channel.data.getValue("renderYValues", 12345)),
      spikeProbes: [
        channel.data.getValue("yValues", 32000),
        channel.data.getValue("yValues", 33000),
      ],
      first: channel.data.getSample(0),
      last: channel.data.getSample(channel.data.getSampleCount() - 1),
      axis: channel.axis?.getInterval(),
      rect: channel.series
        ? chart?.getSeriesScreenRect(channel.series)
        : undefined,
      color: [
        channel.color.getR(),
        channel.color.getG(),
        channel.color.getB(),
        channel.color.getA(),
      ],
      mapping: channel.series?.getDataMapping(),
      strokeWidth: channel.series?.getStrokeStyle().getThickness(),
      displayStats: channel.series?.getLineDisplayStats(),
      visible: channel.series?.getVisible(),
      probe:
        channel.axis && chart
          ? chart.translateCoordinate(
              { x: 500, y: 0 },
              { x: chart.getDefaultAxisX(), y: channel.axis },
              chart.coordsClient,
            )
          : undefined,
    })),
    lifecycle: {
      createdDataSets,
      disposedDataSets,
      createdSeries,
      disposedSeries,
      createdCharts,
      disposedCharts,
    },
    heap: getHeap(),
    peakSampledHeap: peakHeap,
    peakDataBytes: peakData,
    lastExport,
    lastDisposal,
    ringResult,
    lastPointer,
  };
}
element("load").onclick = () => void load();
element("restore").onclick = () => void load();
element("play").onclick = play;
element<HTMLSelectElement>("preset").value = preset;
element<HTMLSelectElement>("preset").onchange = event => void changePreset((event.target as HTMLSelectElement).value);
element("clear").onclick = clearData;
element("visibility").onclick = toggleVisibility;
element("fit").onclick = fit;
element("follow").onclick = () => {
  following = true;
  follow();
};
element("dispose").onclick = dispose;
element("export").onclick = () =>
  void exportPNG().catch((cause) => {
    error = String(cause);
    status(error, true);
  });
element("ring").onclick = runRing;
element<HTMLSelectElement>("layout").onchange = async (event) => {
  stop();
  ready = false;
  controls();
  layout = (event.target as HTMLSelectElement).value;
  bindSeries();
  await frames();
  ready = true;
  controls();
  updateHud(true);
  status("布局已切换，原始数据与保留样本数未改变。");
};
element("add").onclick = async () => {
  if (channels.length >= 128 || !ready) return;
  stop();
  ready = false;
  controls();
  const count = channels[0].data.getSampleCount();
  channels.push(createChannel(channels.length, nextSample - count, count));
  bindSeries();
  await frames();
  ready = true;
  controls();
  updateHud(true);
  status(`已新增通道，当前 ${channels.length} 通道。`);
};
element("remove").onclick = async () => {
  if (channels.length <= 1 || !ready) return;
  stop();
  ready = false;
  controls();
  const removed = channels.pop()!;
  removed.series?.dispose();
  disposedSeries++;
  removed.data.dispose();
  disposedDataSets++;
  removed.axis?.dispose();
  bindSeries();
  await frames();
  ready = true;
  controls();
  updateHud(true);
  status(`已移除最后一个通道，当前 ${channels.length} 通道。`);
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden && running) {
    stop();
    status("页面进入后台，信号生成已暂停。");
  }
});
window.addEventListener("beforeunload", dispose);
(window as any).__channelLab = {
  snapshot,
  auditData:()=>{
    const results=channels.map(channel=>{const data=channel.data,raw=data.getColumnRuns('yValues'),render=data.getColumnRuns('renderYValues'),x=data.getColumnRuns('xValues'),applicable=data.getSampleCount()===channel.source.count,rawHash=raw.kind==='dense'?fingerprint(raw.slices):undefined,renderHash=render.kind==='dense'?fingerprint(render.slices):undefined;
      return{id:channel.id,identity:channel.identity,count:data.getSampleCount(),applicable,rawHash,renderHash,source:channel.source,rawMatches:applicable&&rawHash===channel.source.raw,renderMatches:applicable&&renderHash===channel.source.render,xKind:x.kind,xRuns:x.kind==='affine'?x.runs.slice(x.runStart).map(run=>({...run})):undefined,storage:data.getStorageStats()};});
    return{algorithm:'FNV-1a32 and indexed-byte sum32, every retained source byte',noXMaterialization:true,checkedChannels:results.length,passed:results.every(r=>r.applicable&&r.rawMatches&&r.renderMatches&&r.xKind==='affine'&&r.storage.snapshotBytes===0),channels:results};
  },
  roundTrip: (id: number, point: { x: number; y: number }) => {
    if (!chart) throw new Error("Disposed chart");
    const axis = channels[id].axis!,
      coordinates = { x: chart.getDefaultAxisX(), y: axis },
      client = chart.translateCoordinate(
        point,
        coordinates,
        chart.coordsClient,
      ),
      restored = chart.translateCoordinate(client, coordinates);
    return {
      point,
      client,
      restored,
      xKind: channels[id].data.getColumnRuns("xValues").kind,
    };
  },
};
void load();
