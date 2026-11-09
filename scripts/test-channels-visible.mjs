import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import {
  connectVisibleChrome,
  ensureTestServer,
  showStep,
} from "./visible-browser.mjs";

// Diagnostic UI and real pointer checks only. Never opens the OpenTest application.
// The memory instrumentation and readPixels calls make this unsuitable as an FPS benchmark.
const artifacts = resolve("codex_artifact/channel-lab"),
  stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
await mkdir(artifacts, { recursive: true });
const previous = resolve(artifacts, "report.json");
if (existsSync(previous)) {
  await mkdir(resolve(artifacts, "history"), { recursive: true });
  await copyFile(previous, resolve(artifacts, `history/report-${stamp}.json`));
}
const built = await build({
  entryPoints: ["examples/channel-lab/main.ts"],
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: resolve(artifacts, "lab.js"),
  sourcemap: true,
  metafile: true,
});
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  bundleSHA256 = digest(await readFile(resolve(artifacts, "lab.js")));
const sourceSHA256 = Object.fromEntries(
  await Promise.all(
    Object.keys(built.metafile.inputs).map(async (file) => [
      file,
      digest(await readFile(file)),
    ]),
  ),
);
const runName = `${stamp}-${bundleSHA256.slice(0, 10)}`,
  runDir = resolve(artifacts, runName);
await mkdir(runDir, { recursive: true });
await copyFile(resolve(artifacts, 'lab.js'), resolve(runDir, 'lab.js'));
await copyFile(resolve(artifacts, 'lab.js.map'), resolve(runDir, 'lab.js.map'));
await copyFile('examples/channel-lab/index.html', resolve(runDir, 'index.html'));
const focusUI=process.argv.includes('--focus-ui');
const report = {
  observedAt: new Date().toISOString(),
  bundleSHA256,
  sourceSHA256,
  htmlSHA256:digest(await readFile('examples/channel-lab/index.html')),
  runnerSHA256:digest(await readFile('scripts/test-channels-visible.mjs')),
  focusedUIOnly:focusUI,
  browserVisible: true,
  headless: false,
  viewport: { width: 1560, height: 1080 },
  scope: {
    application: "isolated channel lab; OpenTest not launched",
    sampleRate: 48000,
    tiers: [1, 4, 16, 64, 128],
    initialSecondsPerChannel: 1,
    configuredVisibleSeconds: 15,
    configuredHistorySeconds: 60,
    fullHistoryValidated: false,
    performanceComparison: false,
    sourceSamplesDropped: false,
    memory:
      "Dataset typed arrays plus WebGL BUFFER_SIZE allocations; sampled JS heap. GPU residency, renderer CPU arrays, driver overhead and process RSS are not fully measured.",
  },
  checks: [],
  errors: [],
  screenshots: [],
};
const server = await ensureTestServer();
let browser,
  page,
  cdp,
  pageErrors = [],
  consoleErrors = [];
try {
  const connected = await connectVisibleChrome();
  browser = connected.browser;
  page = connected.page;
  report.browserMetadata = connected.metadata;
  await page.setViewportSize(report.viewport);
  await page.bringToFront();
  cdp = await page.context().newCDPSession(page);
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  await page.goto(
    `http://127.0.0.1:4178/examples/channel-lab/index.html?build=${bundleSHA256}&fixture=${encodeURIComponent('/codex_artifact/channel-lab/'+runName+'/lab.js')}`,
    { waitUntil: "networkidle" },
  );
  const served = await page.request.get(
    `http://127.0.0.1:4178/codex_artifact/channel-lab/${runName}/lab.js`,
  );
  assert.equal(
    digest(await served.body()),
    bundleSHA256,
    "Served bundle differs from tested artifact",
  );
  report.deviceScaleFactor = await page.evaluate(() => devicePixelRatio);
  const snapshot = () => page.evaluate(() => window.__channelLab.snapshot());
  const settle = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  const ready = async (count) => {
    await page.waitForFunction(
      (count) => {
        const s = window.__channelLab?.snapshot();
        return s?.ready && (s.error || s.channelCount === count);
      },
      count,
      { timeout: 120000 },
    );
    const s = await snapshot();
    assert.equal(s.error, "");
    return s;
  };
  const capture = async (name) => {
    await page.evaluate(()=>window.scrollTo(0,0));
    const { data } = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const relative = `${runName}/${name}.png`;
    await writeFile(resolve(artifacts, relative), Buffer.from(data, "base64"));
    report.screenshots.push(relative);
    return relative;
  };
  const check = async (name, action) => {
    if(focusUI&&!['4 通道 ×','128 通道 ×','4 通道：正负','界面'].some(prefix=>name.startsWith(prefix)))return;
    pageErrors = [];
    consoleErrors = [];
    await showStep(page, "多通道实验台 · 可见 Chrome 验证", name);
    const result = { name, status: "pending" };
    const started = performance.now();
    try {
      result.evidence = await action();
      assert.deepEqual(pageErrors, [], "Uncaught page errors");
      assert.deepEqual(consoleErrors, [], "Console errors");
      result.status = "passed";
    } catch (e) {
      result.status = "failed";
      result.error = String(e);
      result.pageErrors = [...pageErrors];
      result.consoleErrors = [...consoleErrors];
      report.errors.push({ name, error: String(e) });
      try {
        result.failureScreenshot = await capture(
          `failed-${report.checks.length + 1}`,
        );
        result.failureSnapshot = await snapshot();
      } catch {}
    }
    result.elapsedMs = Math.round(performance.now() - started);
    report.checks.push(result);
    console.log(`${result.status}: ${name}`);
    await writeFile(previous, JSON.stringify(report, null, 2));
    return result;
  };
  const mount = async (count, storage = "float64", layout = "stacked") => {
    await ready((await snapshot()).channelCount);
    await page.selectOption("#channels", String(count));
    await page.selectOption("#storage", storage);
    if ((await snapshot()).layout !== layout) {
      await page.selectOption("#layout", layout);
      await ready((await snapshot()).channelCount);
    }
    await page.click("#load");
    return ready(count);
  };
  const graphics = () =>
    page.evaluate(() => {
      const s = window.__channelLab.snapshot(),
        canvases = [...document.querySelectorAll("#stage canvas")],
        data = canvases
          .map((canvas) => ({ canvas, gl: canvas.getContext("webgl2") }))
          .filter((item) => item.gl);
      const frames = data.map(({ canvas, gl }) => {
        const bytes = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(
          0,
          0,
          canvas.width,
          canvas.height,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          bytes,
        );
        const errors = [];
        for (let i = 0; i < 16; i++) {
          const error = gl.getError();
          if (!error) break;
          errors.push(error);
        }
        const rect = canvas.getBoundingClientRect(),
          sx = canvas.width / rect.width,
          sy = canvas.height / rect.height;
        const panes = s.channels.map((channel) => {
          const p = channel.rect;
          let painted = 0,
            chromatic = 0;
          for (
            let y = Math.ceil(p.top * sy);
            y < Math.min(canvas.height, Math.floor((p.top + p.height) * sy));
            y++
          )
            for (
              let x = Math.ceil(p.left * sx);
              x < Math.min(canvas.width, Math.floor((p.left + p.width) * sx));
              x++
            ) {
              const i = ((canvas.height - 1 - y) * canvas.width + x) * 4;
              if (bytes[i + 3] > 30) painted++;
              if (
                bytes[i + 3] > 30 &&
                Math.max(bytes[i], bytes[i + 1], bytes[i + 2]) -
                  Math.min(bytes[i], bytes[i + 1], bytes[i + 2]) >
                  20
              )
                chromatic++;
            }
          return { id: channel.id, painted, chromatic, rect: p };
        });
        return {
          width: canvas.width,
          height: canvas.height,
          cssWidth: rect.width,
          cssHeight: rect.height,
          panes,
          glErrors: errors,
          contextLost: gl.isContextLost(),
          renderer: gl.getParameter(gl.RENDERER),
        };
      });
      return {
        chartElements: document.querySelectorAll("#stage .crychart").length,
        glContexts: data.length,
        canvasCount: canvases.length,
        frames,
      };
    });
  const assertGraph = (g) => {
    assert.equal(g.chartElements, 1);
    assert.equal(g.glContexts, 1, "All channels must share one WebGL context");
    assert.ok(
      g.frames[0].panes.every((p) => p.chromatic > 2),
      "Every pane must contain real colored GPU pixels",
    );
    assert.deepEqual(g.frames[0].glErrors, []);
    assert.equal(g.frames[0].contextLost, false);
  };
  await ready(4);
  for (const count of report.scope.tiers)
    await check(
      `${count} 通道 × 48,000 样本：真实分区像素与隐式 X`,
      async () => {
        let s = await mount(count);
        assert.equal(s.totalSamples, count * 48000);
        assert.equal(s.stats.samples, s.totalSamples);
        assert.equal(s.stats.series, count);
        assert.equal(
          s.stats.submittedSamples,
          s.totalSamples,
          "Every initial source sample is submitted, including explicit NaN gaps",
        );
        assert.equal(s.x.end - s.x.start, 15000);
        assert.equal(s.fullHistoryValidated, false);
        for (const c of s.channels) {
          assert.equal(c.count, 48000);
          assert.equal(c.storage.capacity, 48000);
          assert.equal(c.storage.denseTypedArrayBytes, 48000 * 16);
          assert.equal(c.storage.snapshotBytes, 0);
          assert.equal(c.xKind, "affine");
          assert.equal(c.storage.affineColumnCount, 1);
          assert.equal(c.storage.denseColumnCount, 2);
          assert.equal(c.rawProbe, "Infinity");
          assert.equal(c.renderProbe, "NaN");
          assert.equal(c.first.xValues, 0);
          assert.equal(c.last.xValues, 47999 * (1000 / 48000));
          assert.deepEqual(c.mapping, { x: "xValues", y: "renderYValues" });
        }
        const g = await graphics();
        assertGraph(g);
        assert.ok(s.gpuBuffers.allocatedBytes > 0);
        const heap = await cdp.send("Runtime.getHeapUsage");
        const screenshot = await capture(`channels-${count}-15s-window`);
        return { snapshot: s, graphics: g, heap, screenshot };
      },
    );
  await check("128 通道：共享 Y / 分区 Y 切换保留全部 6.144M 点", async () => {
    const before = await snapshot();
    await page.selectOption("#layout", "shared");
    let shared = await ready(128);
    assert.equal(shared.totalSamples, 6144000);
    assert.equal(
      new Set(shared.channels.map((c) => JSON.stringify(c.rect))).size,
      1,
    );
    assert.equal(shared.gpuBuffers.liveBuffers, before.gpuBuffers.liveBuffers);
    assert.ok(
      shared.channels.every(
        (c) => c.xKind === "affine" && c.storage.snapshotBytes === 0,
      ),
    );
    await settle();
    assert.equal((await graphics()).glContexts, 1);
    const sharedScreenshot = await capture("channels-128-shared");
    await page.selectOption("#layout", "stacked");
    const stacked = await ready(128);
    assert.equal(new Set(stacked.channels.map((c) => c.rect.top)).size, 128);
    assert.equal(stacked.totalSamples, before.totalSamples);
    const g = await graphics();
    assertGraph(g);
    return {
      shared: {
        samples: shared.totalSamples,
        rect: shared.channels[0].rect,
        gpuBuffers: shared.gpuBuffers,
      },
      stacked: {
        samples: stacked.totalSamples,
        gpuBuffers: stacked.gpuBuffers,
      },
      graphics: g,
      sharedScreenshot,
    };
  });
  await check("4 通道：正负越界尖峰均被限制在所属分区", async () => {
    await mount(4);
    await page.click("#fit");
    await settle();
    const s = await snapshot();
    assert.deepEqual(s.channels[0].spikeProbes, [5, -5]);
    const evidence = await page.evaluate(() => {
      const s = window.__channelLab.snapshot(),
        canvas = document.querySelectorAll("#stage canvas")[1],
        gl = canvas.getContext("webgl2"),
        pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(
        0,
        0,
        canvas.width,
        canvas.height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      );
      const p = s.channels[0].rect,
        c = s.channels[0].color,
        scale = canvas.height / canvas.clientHeight;
      let inside = 0,
        outside = 0;
      for (let y = 0; y < canvas.height; y++)
        for (let x = 0; x < canvas.width; x++) {
          const i = ((canvas.height - 1 - y) * canvas.width + x) * 4,
            a = pixels[i + 3];
          if (a < 90) continue;
          const match = [0, 1, 2].every(
            (k) => Math.abs((pixels[i + k] * 255) / a - c[k]) < 5,
          );
          if (!match) continue;
          if (
            y >= Math.floor(p.top * scale) - 1 &&
            y <= Math.ceil((p.top + p.height) * scale) + 1
          )
            inside++;
          else outside++;
        }
      return { inside, outside, glError: gl.getError(), rect: p };
    });
    assert.ok(evidence.inside > 100);
    assert.equal(
      evidence.outside,
      0,
      "Channel 0 color leaked into another pane",
    );
    assert.equal(evidence.glError, 0);
    return { ...evidence, screenshot: await capture("stacked-spike-clipping") };
  });
  await check("鼠标滚轮仅改变当前分区 Y 和共享 X", async () => {
    await page.click("#fit");
    await settle();
    const before = await snapshot(),
      target = before.channels[2].probe;
    await page.mouse.move(target.clientX, target.clientY);
    await page.mouse.wheel(0, -120);
    await page.waitForFunction(
      (old) => window.__channelLab.snapshot().x.start !== old,
      before.x.start,
    );
    await settle();
    const after = await snapshot();
    assert.notDeepEqual(after.x, before.x);
    assert.notDeepEqual(after.channels[2].axis, before.channels[2].axis);
    for (const i of [0, 1, 3])
      assert.deepEqual(after.channels[i].axis, before.channels[i].axis);
    return {
      before: { x: before.x, y: before.channels.map((c) => c.axis) },
      after: { x: after.x, y: after.channels.map((c) => c.axis) },
    };
  });
  await check("鼠标右拖平移与左拖框选按目标分区生效", async () => {
    await page.click("#fit");
    await settle();
    let before = await snapshot(),
      p = before.channels[1].probe;
    await page.mouse.move(p.clientX, p.clientY);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(p.clientX + 80, p.clientY + 18, { steps: 5 });
    await page.mouse.up({ button: "right" });
    await settle();
    const panned = await snapshot();
    assert.notDeepEqual(panned.x, before.x);
    assert.notDeepEqual(panned.channels[1].axis, before.channels[1].axis);
    for (const i of [0, 2, 3])
      assert.deepEqual(panned.channels[i].axis, before.channels[i].axis);
    await page.click("#fit");
    await settle();
    before = await snapshot();
    p = before.channels[1].probe;
    await page.mouse.move(p.clientX - 100, p.clientY - 28);
    await page.mouse.down();
    await page.mouse.move(p.clientX + 100, p.clientY + 28, { steps: 5 });
    await page.mouse.up();
    await settle();
    const zoomed = await snapshot();
    assert.ok(zoomed.x.end - zoomed.x.start < before.x.end - before.x.start);
    assert.ok(
      zoomed.channels[1].axis.end - zoomed.channels[1].axis.start <
        before.channels[1].axis.end - before.channels[1].axis.start,
    );
    for (const i of [0, 2, 3])
      assert.deepEqual(zoomed.channels[i].axis, before.channels[i].axis);
    return {
      panned: { x: panned.x, y: panned.channels.map((c) => c.axis) },
      zoomed: { x: zoomed.x, y: zoomed.channels.map((c) => c.axis) },
    };
  });
  await check("真实鼠标分区读数与坐标双向转换", async () => {
    await page.click("#fit");
    await settle();
    const s = await snapshot(),
      roundTrip = await page.evaluate(() =>
        window.__channelLab.roundTrip(3, { x: 431.25, y: 0.35 }),
      );
    assert.ok(Math.abs(roundTrip.restored.x - 431.25) < 1e-8);
    assert.ok(Math.abs(roundTrip.restored.y - 0.35) < 1e-8);
    assert.equal(roundTrip.xKind, "affine");
    await page.mouse.move(roundTrip.client.clientX, roundTrip.client.clientY);
    await settle();
    const after = await snapshot();
    assert.equal(after.lastPointer.channel, 3);
    assert.ok(Math.abs(after.lastPointer.axisValue - 0.35) < 0.02);
    assert.ok(Math.abs(after.lastPointer.time - 431.25) < 1);
    assert.equal(s.channels.length, 4);
    return {
      roundTrip,
      pointer: after.lastPointer,
      screenshot: await capture("coordinate-inspector"),
    };
  });
  await check("48 kHz 开始/暂停：实际追加全部采样，X 不物化", async () => {
    const before = await snapshot();
    await page.click("#play");
    await page.waitForFunction(
      (n) => window.__channelLab.snapshot().nextSample >= n + 4800,
      before.nextSample,
    );
    await page.click("#play");
    await settle();
    const after = await snapshot();
    assert.equal(after.running, false);
    assert.ok(after.nextSample > before.nextSample);
    assert.equal(after.nextSample, after.lastRequestedSample);
    assert.equal(after.totalSamples, after.nextSample * 4);
    assert.ok(
      after.channels.every(
        (c) =>
          c.xKind === "affine" &&
          c.count === after.nextSample &&
          c.storage.snapshotBytes === 0 &&
          c.storage.capacity < 60 * 48000,
      ),
    );
    const count = after.nextSample;
    await settle();
    assert.equal((await snapshot()).nextSample, count);
    return {
      beforeSamples: before.totalSamples,
      afterSamples: after.totalSamples,
      nextSample: after.nextSample,
      storage: after.channels[0].storage,
      gpuBuffers: after.gpuBuffers,
    };
  });
  await check("通道增删保留既有数据并释放移除系列", async () => {
    const before = await snapshot();
    await page.click("#add");
    const added = await ready(5);
    assert.equal(added.channels[0].count, before.channels[0].count);
    assert.equal(added.totalSamples, added.channels[0].count * 5);
    assert.equal(
      added.gpuBuffers.liveBuffers,
      before.gpuBuffers.liveBuffers + 1,
    );
    await page.click("#remove");
    const removed = await ready(4);
    assert.equal(removed.totalSamples, before.totalSamples);
    assert.equal(removed.gpuBuffers.liveBuffers, before.gpuBuffers.liveBuffers);
    assert.equal(
      removed.lifecycle.disposedDataSets,
      before.lifecycle.disposedDataSets + 1,
    );
    return {
      before: { samples: before.totalSamples, buffers: before.gpuBuffers },
      added: { samples: added.totalSamples, buffers: added.gpuBuffers },
      removed: { samples: removed.totalSamples, buffers: removed.gpuBuffers },
    };
  });
  await check("真实 PNG 导出包含当前波形", async () => {
    const downloaded = page.waitForEvent("download");
    await page.click("#export");
    const download = await downloaded,
      file = resolve(runDir, "channels-export.png");
    await download.saveAs(file);
    const bytes = await readFile(file);
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    assert.ok(bytes.length > 5000);
    const s = await snapshot();
    assert.equal(s.lastExport.bytes, bytes.length);
    assert.equal(s.lastExport.points, s.totalSamples);
    assert.equal(bytes.readUInt32BE(16), s.lastExport.width);
    assert.equal(bytes.readUInt32BE(20), s.lastExport.height);
    report.screenshots.push(`${runName}/channels-export.png`);
    return { screenshot: `${runName}/channels-export.png`, ...s.lastExport };
  });
  await check("16 点小缓冲回卷：逐值核对与 Float64 epoch X", async () => {
    await page.click("#ring");
    const ring = (await snapshot()).ringResult;
    assert.equal(ring.passed, true);
    assert.equal(ring.retained, 16);
    assert.equal(ring.firstRetained, 11);
    assert.equal(ring.capacity, 16);
    assert.equal(ring.xKind, "affine");
    assert.equal(ring.rawInfinityPreserved, true);
    assert.equal(ring.storage.snapshotBytes, 0);
    assert.equal(ring.disposedStorage.denseTypedArrayBytes, 0);
    assert.equal(ring.disposedStorage.affineRunCount, 0);
    return ring;
  });
  await check("显式释放与恢复：数据和 GPU buffers 均释放", async () => {
    await page.click("#dispose");
    await settle();
    const disposed = await snapshot();
    assert.equal(disposed.chartInstances, 0);
    assert.equal(disposed.totalSamples, 0);
    assert.equal(
      disposed.lifecycle.createdDataSets,
      disposed.lifecycle.disposedDataSets,
    );
    assert.equal(
      disposed.lifecycle.createdSeries,
      disposed.lifecycle.disposedSeries,
    );
    assert.equal(disposed.lastDisposal.buffersAfterDispose.liveBuffers, 0);
    assert.equal(disposed.lastDisposal.buffersAfterDispose.allocatedBytes, 0);
    assert.equal(await page.locator("#stage canvas").count(), 0);
    await page.click("#restore");
    const restored = await ready(4);
    assert.equal(restored.totalSamples, 192000);
    assert.ok(restored.channels.every((c) => c.xKind === "affine"));
    assertGraph(await graphics());
    return {
      disposed,
      restored: {
        samples: restored.totalSamples,
        lifecycle: restored.lifecycle,
        gpuBuffers: restored.gpuBuffers,
      },
    };
  });
  await check("Base / Single 精度：Float32 双 Y 列与共享 Y", async () => {
    const s = await mount(4, "float32", "shared");
    assert.equal(s.totalSamples, 192000);
    assert.ok(
      s.channels.every(
        (c) =>
          c.storage.denseTypedArrayBytes === 48000 * 8 &&
          c.xKind === "affine" &&
          c.rawProbe === "Infinity" &&
          c.renderProbe === "NaN",
      ),
    );
    assert.equal(
      new Set(s.channels.map((c) => JSON.stringify(c.rect))).size,
      1,
    );
    const g = await graphics();
    assertGraph(g);
    return {
      storage: s.channels[0].storage,
      graphics: g,
      screenshot: await capture("shared-y-float32"),
    };
  });
  await mount(128, "float64", "stacked");
  await page.click("#fit");
  await settle();
  await check('界面：128 通道编号、样本计数与 GPU 分配文案',async()=>{
    const state=await snapshot();assert.equal(state.totalSamples,6144000);
    assert.equal(await page.locator('.pane-label').count(),16);
    assert.equal(await page.locator('.pane-separator').count(),128);
    assert.match(await page.locator('#gpu-vertices').innerText(),/6,144,000/);
    assert.match(await page.locator('#gpu-bytes').locator('..').innerText(),/GPU 缓冲区分配/);
    const labelBoxes=await page.locator('.pane-label').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,top:n.getBoundingClientRect().top,height:n.getBoundingClientRect().height})));assert.ok(labelBoxes.every(x=>x.height>0));
    const g=await graphics();assertGraph(g);return{labelBoxes,graphics:g};
  });
  await showStep(
    page,
    "多通道实验台 · 本轮完成",
    `${report.checks.filter((c) => c.status === "passed").length}/${report.checks.length} 项通过。当前 128 通道 × 1 秒；完整 60 秒和性能对比另行验证。`,
  );
  report.finalScreenshot = await capture("final-128-channels");
  report.finalSnapshot = await snapshot();
  report.finishedAt = new Date().toISOString();
  report.passed = report.errors.length === 0;
} catch (error) {
  report.errors.push({ name: "runner", error: String(error) });
  report.passed = false;
  console.error(error);
} finally {
  await writeFile(previous, JSON.stringify(report, null, 2));
  await writeFile(
    resolve(runDir, "report.json"),
    JSON.stringify(report, null, 2),
  );
  if (cdp) await cdp.detach().catch(() => {});
  if (browser) await browser.close();
  await server.close();
}
console.log(
  JSON.stringify({
    report: previous,
    passed: report.passed,
    checks: report.checks.length,
    errors: report.errors.length,
    bundleSHA256,
  }),
);
if (!report.passed) process.exitCode = 1;
