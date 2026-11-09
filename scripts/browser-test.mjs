import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  connectVisibleChrome,
  showStep,
  ensureTestServer,
} from "./visible-browser.mjs";
const port = Number(process.env.CRYCHART_PORT ?? 4178);
assert.ok(Number.isInteger(port) && port > 0 && port < 65536, 'CRYCHART_PORT must be a valid TCP port');
const baseURL = `http://127.0.0.1:${port}`;
const service = await ensureTestServer(port);
const directory = process.env.CRYCHART_BROWSER_EVIDENCE ?? "codex_artifact/browser";
mkdirSync(directory, { recursive: true });
const executablePath =
  process.env.CRYCHART_CHROME ??
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].find(existsSync);
let browser;
const failures = [];
const evidence = {
  checks: [],
  errors: [],
  environment: { node: process.version },
  createdAt: new Date().toISOString(),
};
try {
  const connection = await connectVisibleChrome();
  browser = connection.browser;
  const page = connection.page;
  evidence.environment.visible = true;
  evidence.environment.browser = connection.metadata.Browser;
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  const expectedBundle = sha256(readFileSync('dist/crychart.js'));
  const response = await page.request.get(`${baseURL}/dist/crychart.js`);
  assert.ok(response.ok(), 'The selected server must serve the local CRYChart build');
  assert.equal(sha256(await response.body()), expectedBundle, 'Another workspace/build is using the requested test port');
  evidence.environment.bundleSHA256 = expectedBundle;
  evidence.environment.workspace = process.cwd();
  evidence.environment.baseURL = baseURL;
  await page.setViewportSize({ width: 1100, height: 760 });
  page.on("pageerror", (e) => evidence.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") evidence.errors.push(m.text());
  });
  await page.goto(`${baseURL}/tests/browser.html`);
  await page.evaluate(async () => {
    const lib = await import("/dist/crychart.js");
    window.lib = lib;
    window.context = lib.cryChart();
    window.chart = window.context.ChartXY({
      container: document.getElementById("chart"),
    });
    window.chart.setTitle("Real browser · WebGL rendering and interaction");
    const c = window.chart;
    c.getDefaultAxisX().setInterval({ start: 0, end: 10 });
    c.getDefaultAxisY().setInterval({ start: 0, end: 10 });
    const s = c
      .addLineSeries()
      .setStrokeStyle(
        new lib.SolidLine({
          fillStyle: new lib.SolidFill({ color: lib.ColorRGBA(255, 70, 50) }),
          thickness: 4,
        }),
      );
    s.add([
      { x: 1, y: 5 },
      { x: 4, y: 5 },
      { x: 5, y: NaN },
      { x: 6, y: 5 },
      { x: 9, y: 5 },
    ]);
    window.series = s;
    c.renderNow();
  });
  const rendered = await page.evaluate(() => {
    const c = window.chart,
      gl = c.renderer.gl,
      r = c.plot;
    if (!gl) return { backend: c.renderer.backend };
    const pixel = (x, y) => {
      const p = new Uint8Array(4);
      gl.readPixels(
        Math.round(r.left + (x / 10) * r.width),
        Math.round(c.canvas.height - (r.top + r.height - (y / 10) * r.height)),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        p,
      );
      return [...p];
    };
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      ...c.getRenderStats(),
      linePixel: pixel(2, 5),
      gapPixel: pixel(5, 5),
      glError: gl.getError(),
      gpu: extension
        ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
    };
  });
  evidence.environment.render = rendered;
  assert.equal(rendered.backend, "webgl2");
  assert.equal(rendered.glError, 0);
  assert.ok(
    rendered.linePixel[0] > 180 && rendered.linePixel[3] > 200,
    "GPU must render actual red signal pixels",
  );
  assert.equal(rendered.gapPixel[3], 0, "NaN must create a visible gap");
  evidence.checks.push("real WebGL2 pixels and NaN gap");
  const cache = await page.evaluate(() => {
    const c = window.chart,
      before = c.getRenderStats().uploads;
    c.renderNow();
    c.getDefaultAxisX().setInterval({ start: 0, end: 11 });
    c.renderNow();
    return { before, after: c.getRenderStats().uploads };
  });
  assert.equal(cache.after, cache.before);
  evidence.checks.push("unchanged GPU buffers reused during axis changes");
  const before = await page.evaluate(() =>
    window.chart.getDefaultAxisX().getInterval(),
  );
  await page.mouse.move(460, 300);
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(120);
  const after = await page.evaluate(() =>
    window.chart.getDefaultAxisX().getInterval(),
  );
  assert.ok(after.end - after.start < before.end - before.start);
  evidence.checks.push("wheel zoom updates actual chart domain");
  await page.mouse.move(460, 300);
  await page.mouse.down({button:"right"});
  await page.mouse.move(520, 330, { steps: 5 });
  await page.mouse.up({button:"right"});
  const panned = await page.evaluate(() =>
    window.chart.getDefaultAxisX().getInterval(),
  );
  assert.notEqual(panned.start, after.start);
  assert.ok(Math.abs((panned.end-panned.start)-(after.end-after.start))<1e-8);
  evidence.checks.push("right-button drag pans without changing scale");
  await page.mouse.move(250,190);await page.mouse.down();await page.mouse.move(600,400,{steps:5});await page.mouse.up();
  const zoomed=await page.evaluate(()=>window.chart.getDefaultAxisX().getInterval());
  assert.ok(zoomed.end-zoomed.start<(panned.end-panned.start)*.75);
  evidence.checks.push("left-button rectangle selection zooms the chosen domain");
  const exported = await page.evaluate(async () => {
    const c = window.chart,
      visible = c.getCursor().getVisible(),
      blob = await c.exportToImage();
    const synchronous=c.engine.captureFrame('image/jpeg');
    return {
      type: blob.type,
      size: blob.size,
      cursorVisible: c.getCursor().getVisible(),
      before: visible,
      synchronousBlob:synchronous instanceof Blob,
      synchronousType:synchronous.type,
    };
  });
  assert.equal(exported.type, "image/png");
  assert.ok(exported.size > 1000);
  assert.equal(exported.cursorVisible, exported.before);
  assert.equal(exported.synchronousBlob,true);assert.equal(exported.synchronousType,'image/jpeg');
  evidence.checks.push("PNG export creates image and preserves cursor state");
  await page.screenshot({ path: `${directory}/chart.png` });
  const epoch = await page.evaluate(() => {
    const c = window.chart,
      s = window.series;
    c.getDefaultAxisX().setInterval({
      start: 1700000000000,
      end: 1700000000001,
    });
    c.getDefaultAxisY().setInterval({ start: 0, end: 10 });
    s.clear().add([
      { x: 1700000000000, y: 1 },
      { x: 1700000000000.5, y: 9 },
      { x: 1700000000001, y: 1 },
    ]);
    c.renderNow();
    const p = s.drawPacket();
    return {
      origin: p.origin.x,
      local: [...p.positions],
      error: c.renderer.gl.getError(),
    };
  });
  assert.equal(epoch.origin, 1700000000000);
  assert.equal(epoch.local[2], 0.5);
  assert.equal(epoch.error, 0);
  evidence.checks.push(
    "epoch coordinates preserve fractional precision in relative GPU coordinates",
  );
  const lifecycle = await page.evaluate(() => {
    const lib = window.lib,
      c = window.chart,
      data = new lib.DataSetXY({ schema: { x: {}, y: {} } });
    data.appendSamples({ x: [0, 1], y: [1, 2] });
    const a = c.addLineSeries({ dataSet: data }),
      b = c.addLineSeries({ dataSet: data });
    a.dispose();
    data.appendSamples({ x: [2], y: [3] });
    const count = b.getSampleCount();
    c.dispose();
    c.dispose();
    return {
      count,
      remaining: document.querySelectorAll(".crychart").length,
      disposed: c.isDisposed(),
    };
  });
  assert.equal(lifecycle.count, 3);
  assert.equal(lifecycle.remaining, 0);
  assert.equal(lifecycle.disposed, true);
  evidence.checks.push("shared dataset ownership and idempotent disposal");
  const geometry = await page.evaluate(() => {
    const lib = window.lib,
      c = lib
        .cryChart()
        .ChartXY({ container: document.getElementById("chart") });
    c.setTitle("Original geometry ? rectangle, range, OHLC");
    c.getDefaultAxisX().setInterval({ start: 0, end: 10 });
    c.getDefaultAxisY().setInterval({ start: 0, end: 10 });
    c.addRectangleSeries().add([
      { x: 1, y: 1, width: 2, height: 3 },
      { x: 4, y: 2, width: 2, height: 5 },
    ]);
    c.addAreaRangeSeries().add([
      { position: 1, low: 6, high: 7 },
      { position: 5, low: 7, high: 9 },
      { position: 9, low: 6, high: 8 },
    ]);
    c.renderNow();
    const ctx = c.underlay.getContext("2d"),
      r = c.plot,
      data = ctx.getImageData(r.left, r.top, r.width, r.height).data;
    let chromatic = 0;
    for (let i = 0; i < data.length; i += 4)
      if (
        data[i + 3] > 80 &&
        Math.max(data[i], data[i + 1], data[i + 2]) -
          Math.min(data[i], data[i + 1], data[i + 2]) >
          40
      )
        chromatic++;
    const result = { chromatic, series: c.getSeries().length };
    c.dispose();
    return result;
  });
  assert.ok(geometry.chromatic > 10000);
  assert.equal(geometry.series, 2);
  evidence.checks.push(
    "visible rectangle and range geometry produce actual colored pixels",
  );
  const layered=await page.evaluate(async()=>{
    const lib=window.lib,c=lib.cryChart().ChartXY({container:document.getElementById('chart')});c.getDefaultAxisX().setInterval({start:0,end:10});c.getDefaultAxisY().setInterval({start:0,end:10});
    c.addRectangleSeries().setFillStyle(new lib.SolidFill({color:lib.ColorRGBA(0,30,240)})).add({x:0,y:0,width:10,height:10});
    const a=new lib.DataSetXY(),b=new lib.DataSetXY();a.appendSamples({x:[1,9],y:[5,5]});b.appendSamples({x:[1,9],y:[8,8]});const s=c.addLineSeries({dataSet:a}).setStrokeStyle(new lib.SolidLine({thickness:5,fillStyle:new lib.SolidFill({color:lib.ColorRGBA(255,0,0)})}));c.renderNow();const before=c.getRenderStats().uploads;s.setDataSet(b);c.renderNow();const after=c.getRenderStats().uploads;
    const bitmap=await createImageBitmap(await c.exportToImage()),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();const r=c.plot,pixel=[...ctx.getImageData(Math.round((r.left+r.width*.22)*c.dpr),Math.round((r.top+r.height*.2)*c.dpr)+1,1,1).data];c.dispose();return{pixel,before,after};
  });assert.ok(layered.after>layered.before);assert.ok(layered.pixel[0]>200&&layered.pixel[2]<80,JSON.stringify(layered));evidence.checks.push('equal-revision data replacement uploads fresh pixels and opaque rectangles stay behind curves');
  const heatmap=await page.evaluate(()=>{
    const lib=window.lib,c=lib.cryChart().ChartXY({container:document.getElementById('chart')});c.getDefaultAxisX().setInterval({start:0,end:2});c.getDefaultAxisY().setInterval({start:0,end:2});
    const h=c.addHeatmapGridSeries({columns:2,rows:2}).setFillStyle(new lib.PalettedFill({lut:new lib.LUT({steps:[{value:0,color:lib.ColorRGBA(255,0,0)},{value:1,color:lib.ColorRGBA(0,0,255)}]})}));h.invalidateIntensityValues([[0,1],[NaN,.5]]);c.addLineSeries().add([{x:0,y:.8},{x:2,y:.8}]);c.renderNow();const gl=c.renderer.gl,r=c.plot;
    const pixel=(x,y)=>{const p=new Uint8Array(4);gl.readPixels(Math.round((r.left+r.width*x)*c.dpr),Math.round(c.canvas.height-(r.top+r.height*(1-y))*c.dpr),1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p]};
    const colors={red:pixel(.25,.25),blue:pixel(.75,.25),missing:pixel(.25,.75),mixed:pixel(.75,.75)},before=c.getRenderStats().heatmapStats;c.getDefaultAxisX().setInterval({start:0,end:4});c.renderNow();const afterPan=c.getRenderStats().heatmapStats;h.setFillStyle(new lib.PalettedFill({lut:new lib.LUT({steps:[{value:0,color:lib.ColorRGBA(0,0,0)},{value:1,color:lib.ColorRGBA(255,255,255)}]})}));c.renderNow();const afterPalette=c.getRenderStats().heatmapStats,result={colors,before,afterPan,afterPalette,glError:gl.getError(),backend:c.getRenderStats().heatmapBackend};c.dispose();return result;
  });assert.equal(heatmap.backend,'webgl2');assert.equal(heatmap.glError,0);assert.ok(heatmap.colors.red[0]>250&&heatmap.colors.blue[2]>250);assert.equal(heatmap.colors.missing[3],0,JSON.stringify(heatmap));assert.ok(Math.abs(heatmap.colors.mixed[0]-128)<3&&Math.abs(heatmap.colors.mixed[2]-128)<3);assert.equal(heatmap.afterPan.uploads,heatmap.before.uploads);assert.equal(heatmap.afterPalette.uploads,heatmap.before.uploads);assert.ok(heatmap.afterPalette.paletteUploads>heatmap.before.paletteUploads);evidence.checks.push('bit-preserving GPU heatmap colors, transparent gaps, curve composition and independent texture caches');evidence.environment.heatmap=heatmap;
  const alpha=await page.evaluate(()=>{const lib=window.lib,c=lib.cryChart().ChartXY({container:document.getElementById('chart')});c.getDefaultAxisX().setInterval({start:0,end:10});c.getDefaultAxisY().setInterval({start:0,end:10});c.addPointSeries().setPointSize(20).setPointFillStyle(new lib.SolidFill({color:lib.ColorRGBA(255,0,0,128)})).add({x:5,y:5});c.renderNow();const gl=c.renderer.gl,r=c.plot,p=new Uint8Array(4);gl.readPixels(Math.round((r.left+r.width/2)*c.dpr),Math.round(c.canvas.height-(r.top+r.height/2)*c.dpr),1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);const result={pixel:[...p],premultiplied:gl.getContextAttributes().premultipliedAlpha};c.dispose();return result});assert.equal(alpha.premultiplied,true);assert.ok(Math.abs(alpha.pixel[0]-128)<=1&&Math.abs(alpha.pixel[3]-128)<=1,JSON.stringify(alpha));evidence.checks.push('transparent GPU colors retain correct premultiplied RGB and alpha');
  const shapes=await page.evaluate(()=>{
    const lib=window.lib,c=lib.cryChart().ChartXY({container:document.getElementById('chart')});c.getDefaultAxisX().setInterval({start:0,end:10});c.getDefaultAxisY().setInterval({start:0,end:10});
    [[2,lib.PointShape.Square,0,24],[4,lib.PointShape.Circle,0,24],[6,lib.PointShape.Triangle,0,32],[8,lib.PointShape.Triangle,180,32],[5,lib.PointShape.Star,0,32]].forEach(([x,shape,angle,size])=>c.addPointSeries().setPointShape(shape).setPointRotation(angle).setPointSize(size).add({x,y:x===5?8:5}));c.renderNow();const gl=c.renderer.gl,r=c.plot;
    const alpha=(x,dx,dy)=>{const p=new Uint8Array(4);gl.readPixels(Math.round((r.left+x/10*r.width)*c.dpr)+dx,Math.round(c.canvas.height-(r.top+r.height*.5)*c.dpr)-dy,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return p[3]};
    const result={squareCorner:alpha(2,9,9),circleCorner:alpha(4,9,9),upTop:alpha(6,6,-9),upBottom:alpha(6,6,9),downTop:alpha(8,6,-9),downBottom:alpha(8,6,9),glError:gl.getError()};c.dispose();return result;
  });assert.ok(shapes.squareCorner>100);assert.equal(shapes.circleCorner,0);assert.equal(shapes.upTop,0,JSON.stringify(shapes));assert.ok(shapes.upBottom>100,JSON.stringify(shapes));assert.ok(shapes.downTop>100);assert.equal(shapes.downBottom,0);assert.equal(shapes.glError,0);evidence.checks.push('distinct GPU point shapes and rotated triangles match actual pixel silhouettes');evidence.environment.pointShapes=shapes;
  const threeD = await page.evaluate(() => {
    const lib = window.lib,
      c = lib
        .cryChart()
        .Chart3D({ container: document.getElementById("chart") });
    c.setTitle("WebGL2 3D ? real surface and point cloud");
    c.getDefaultAxisX().setInterval({ start: 0, end: 20 });
    c.getDefaultAxisY().setInterval({ start: -1, end: 1 });
    c.getDefaultAxisZ().setInterval({ start: 0, end: 20 });
    c.addSurfaceGridSeries({ columns: 20, rows: 20 }).invalidateHeightMap(
      Array.from({ length: 20 }, (_, r) =>
        Array.from(
          { length: 20 },
          (_, x) => Math.sin(x * 0.3) * Math.cos(r * 0.3),
        ),
      ),
    );
    c.addPointSeries()
      .setPointSize(6)
      .add(
        Array.from({ length: 100 }, (_, i) => ({
          x: i / 5,
          y: Math.sin(i / 9),
          z: i / 5,
        })),
      );
    c.renderNow();
    const gl = c.renderer.gl;
    gl.finish();
    const before = c.getRenderStats(),
      pixels = new Uint8Array(c.canvas.width * c.canvas.height * 4);
    gl.readPixels(
      0,
      0,
      c.canvas.width,
      c.canvas.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    let colored = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 100) colored++;
    c.setCameraLocation({ azimuth: 0.5, elevation: 0.3 });
    c.renderNow();
    gl.finish();
    const after = c.getRenderStats(),
      pixels2 = new Uint8Array(pixels.length);
    gl.readPixels(
      0,
      0,
      c.canvas.width,
      c.canvas.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels2,
    );
    let changed = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] !== pixels2[i]) changed++;
    window.chart3D = c;
    return { before, after, colored, changed, glError: gl.getError() };
  });
  assert.equal(threeD.after.backend, "webgl2-3d");
  assert.equal(threeD.glError, 0);
  assert.ok(threeD.colored > 10000);
  assert.ok(threeD.changed > 5000);
  assert.equal(threeD.after.uploads, threeD.before.uploads);
  evidence.checks.push(
    "WebGL2 surface and points render with depth and rotate without uploading data",
  );
  evidence.environment.threeD = threeD;
  await page.screenshot({ path: `${directory}/chart3d-visible.png` });
  await showStep(
    page,
    "CRYChart??? Chrome ??????",
    evidence.checks.join(" ? "),
    0,
  );
  evidence.status = evidence.errors.length ? "failed" : "passed";
  if (evidence.errors.length) failures.push(...evidence.errors);
} catch (error) {
  evidence.status = "failed";
  failures.push(error.stack ?? String(error));
} finally {
  await browser?.close();
  await service.close();
  evidence.failures = failures;
  writeFileSync(`${directory}/results.json`, JSON.stringify(evidence, null, 2));
  console.log(
    JSON.stringify(
      {
        status: evidence.status,
        checks: evidence.checks,
        failures,
        path: `${directory}/results.json`,
      },
      null,
      2,
    ),
  );
  if (failures.length) process.exitCode = 1;
}
