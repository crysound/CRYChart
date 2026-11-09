import { existsSync, mkdirSync, writeFileSync } from "node:fs";
const port = Number(process.env.PORT ?? 4180);
process.env.PORT = String(port);
const { connectVisibleChrome, showStep, ensureTestServer } = await import(
  "./visible-browser.mjs"
);
const service = await ensureTestServer(port);
const report = {
  generatedAt: new Date().toISOString(),
  status: "pending",
  comparison: {
    status: "not-measured",
    reason:
      "A valid CRYChart runtime is required for a matched baseline. These results describe CRYChart only.",
  },
  environment: { node: process.version },
  scenarios: [],
};
const executablePath =
  process.env.CRYCHART_CHROME ??
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].find(existsSync);
let browser;
try {
  const connection = await connectVisibleChrome();
  browser = connection.browser;
  const page = connection.page;
  report.environment.visible = true;
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.goto(`http://127.0.0.1:${port}/tests/browser.html`);
  await page.evaluate(async () => {
    window.lib = await import("/dist/crychart.js");
  });
  report.environment.browser = await browser.version();
  for (const points of [10000, 100000, 1000000]) {
    await showStep(
      page,
      `CRYChart ?? Chrome ?????${points.toLocaleString()} ?`,
      "??? CRYChart???????? CRYChart ??",
      0,
    );
    const result = await page.evaluate(async (points) => {
      const lib = window.lib,
        context = lib.cryChart(),
        c = context.ChartXY({ container: document.getElementById("chart") }),
        s = c.addLineSeries();
      c.getDefaultAxisX().setInterval({ start: 0, end: points });
      c.getDefaultAxisY().setInterval({ start: -2, end: 2 });
      const x = Float64Array.from({ length: points }, (_, i) => i),
        y = Float32Array.from({ length: points }, (_, i) =>
          Math.sin(i * 0.017),
        );
      const gl = c.renderer.gl;
      const start = performance.now();
      s.addArraysXY(x, y);
      const appendMs = performance.now() - start;
      const renderStart = performance.now();
      c.renderNow();
      gl?.finish();
      const firstFrameMs = performance.now() - renderStart;
      const times = [];
      for (let i = 0; i < 30; i++) {
        await new Promise(requestAnimationFrame);
        const t = performance.now();
        c.getDefaultAxisX().setInterval({
          start: i * 100,
          end: points + i * 100,
        });
        c.renderNow();
        gl?.finish();
        times.push(performance.now() - t);
      }
      const ext = gl?.getExtension("WEBGL_debug_renderer_info"),
        result = {
          points,
          appendMs,
          firstFrameMs,
          frames: times,
          stats: c.getRenderStats(),
          glError: gl?.getError(),
          gpu: ext
            ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
            : "unavailable",
        };
      context.dispose();
      return result;
    }, points);
    const sorted = [...result.frames].sort((a, b) => a - b);
    report.scenarios.push({
      ...result,
      frames: undefined,
      panMedianMs: sorted[Math.floor(sorted.length / 2)],
      panP95Ms: sorted[Math.floor(sorted.length * 0.95)],
    });
    console.log(
      JSON.stringify({
        scenario: "line",
        points,
        appendMs: result.appendMs,
        firstFrameMs: result.firstFrameMs,
      }),
    );
  }
  report.scenarios.push(
    await page.evaluate(async () => {
      const lib = window.lib,
        c = lib
          .cryChart()
          .ChartXY({ container: document.getElementById("chart") }),
        channels = 4,
        capacity = 100000,
        samplesPerFrame = 1000,
        series = Array.from({ length: channels }, () =>
          c
            .addLineSeries({ schema: { x: { auto: true }, y: {} } })
            .setMaxSampleCount(capacity),
        ),
        ys = Array.from({ length: channels }, (_, k) =>
          Float32Array.from({ length: samplesPerFrame }, (_, i) =>
            Math.sin(i * 0.01 + k),
          ),
        );
      c.getDefaultAxisY().setInterval({ start: -2, end: 2 });
      const gl = c.renderer.gl,
        times = [],
        started = performance.now();
      for (let frame = 0; frame < 120; frame++) {
        await new Promise(requestAnimationFrame);
        const start = performance.now();
        for (let k = 0; k < channels; k++)
          series[k].appendSamples({ y: ys[k] }, { step: 1 });
        c.getDefaultAxisX().setInterval({
          start: Math.max(0, (frame + 1) * samplesPerFrame - capacity),
          end: (frame + 1) * samplesPerFrame,
        });
        c.renderNow();
        gl?.finish();
        times.push(performance.now() - start);
      }
      const elapsedMs = performance.now() - started,
        sorted = [...times].sort((a, b) => a - b),
        result = {
          scenario: "bounded-stream",
          channels,
          capacityPerChannel: capacity,
          samplesPerFrame,
          frames: 120,
          elapsedMs,
          observedFPS: 120000 / elapsedMs,
          medianFrameWorkMs: sorted[60],
          p95FrameWorkMs: sorted[114],
          stats: c.getRenderStats(),
          retained: series.map((s) => s.getSampleCount()),
          glError: gl?.getError(),
        };
      c.dispose();
      return result;
    }),
  );
  await showStep(page,"CRYChart 可见 Chrome：10 万点三维旋转","记录实际 GPU 完成耗时与缓存上传次数",0);
  report.scenarios.push(await page.evaluate(async()=>{
    const lib=window.lib,c=lib.cryChart().Chart3D({container:document.getElementById('chart')}),count=100000,s=c.addPointSeries().setPointSize(2);
    for(const axis of[c.getDefaultAxisX(),c.getDefaultAxisY(),c.getDefaultAxisZ()])axis.setInterval({start:-3,end:3});
    const x=new Float32Array(count),y=new Float32Array(count),z=new Float32Array(count);for(let i=0;i<count;i++){const a=i*.017,b=i*.013,r=2+.6*Math.cos(b);x[i]=r*Math.cos(a);y[i]=r*Math.sin(a);z[i]=.6*Math.sin(b)}
    const start=performance.now();s.addArraysXYZ(x,y,z);c.renderNow();const gl=c.renderer.gl;gl.finish();const initialMs=performance.now()-start,uploads=c.getRenderStats().uploads,times=[];
    for(let i=0;i<60;i++){await new Promise(requestAnimationFrame);const t=performance.now();c.setCameraLocation({azimuth:i*.03,elevation:.4});c.renderNow();gl.finish();times.push(performance.now()-t)}
    times.sort((a,b)=>a-b);const result={scenario:'point-cloud-rotation',count,initialMs,medianFrameWorkMs:times[30],p95FrameWorkMs:times[57],uploadsBefore:uploads,uploadsAfter:c.getRenderStats().uploads,stats:c.getRenderStats(),glError:gl.getError()};c.dispose();return result;
  }));
  await page.goto("http://127.0.0.1:4178/#demo=scatter3d");
  report.status = report.scenarios.every((s) => s.glError === 0)
    ? "measured"
    : "failed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  mkdirSync("codex_artifact/performance", { recursive: true });
  writeFileSync(
    "codex_artifact/performance/crychart.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      status: report.status,
      comparison: report.comparison,
      path: "codex_artifact/performance/crychart.json",
      error: report.error,
    }),
  );
  await browser?.close();
  await service.close();
}
