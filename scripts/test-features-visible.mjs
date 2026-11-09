import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  connectVisibleChrome,
  ensureTestServer,
  showStep,
} from "./visible-browser.mjs";

const directory = "codex_artifact/features-visible";
mkdirSync(directory, { recursive: true });
const service = await ensureTestServer(),
  report = {
    createdAt: new Date().toISOString(),
    visible: true,
    bundleSHA256: createHash("sha256")
      .update(readFileSync("dist/crychart.js"))
      .digest("hex"),
    checks: [],
    errors: [],
  };
let browser;
try {
  const connection = await connectVisibleChrome();
  browser = connection.browser;
  const page = connection.page;
  report.browser = connection.metadata.Browser;
  await page.setViewportSize({ width: 1100, height: 760 });
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.goto(
    `http://127.0.0.1:4178/tests/browser.html?features=${report.bundleSHA256}`,
  );
  await page.evaluate(async () => {
    window.lib = await import("/dist/crychart.js");
  });
  await showStep(
    page,
    "CRYChart：面积渐变实测",
    "实际像素检查：上部实色、下部透明、NaN保持断开",
  );
  report.gradient = await page.evaluate(() => {
    const l = window.lib,
      c = l
        .cryChart()
        .ChartXY({ container: "chart" })
        .setTitle("Original area gradient / NaN gap");
    c.getDefaultAxisX().setInterval({ start: 0, end: 10 });
    c.getDefaultAxisY().setInterval({ start: 0, end: 10 });
    c.addAreaSeries()
      .setAreaBaseline(1)
      .setAreaFillStyle(
        new l.LinearGradientFill({
          angle: 0,
          stops: [
            { offset: 0, color: l.ColorRGBA(255, 210, 0, 0) },
            { offset: 1, color: l.ColorRGBA(255, 210, 0) },
          ],
        }),
      )
      .add([
        { x: 1, y: 9 },
        { x: 4, y: 9 },
        { x: 5, y: NaN },
        { x: 6, y: 9 },
        { x: 9, y: 9 },
      ]);
    c.renderNow();
    const r = c.plot,
      ctx = c.underlay.getContext("2d"),
      pixel = (x, y) => [
        ...ctx.getImageData(
          Math.round((r.left + (x / 10) * r.width) * c.dpr),
          Math.round((r.top + (1 - y / 10) * r.height) * c.dpr),
          1,
          1,
        ).data,
      ];
    window.featureChart = c;
    return {
      top: pixel(2.31, 8.25),
      bottom: pixel(2.31, 1.75),
      gap: pixel(5.05, 7.15),
    };
  });
  assert.ok(
    report.gradient.top[3] > 210 && report.gradient.bottom[3] < 40,
    JSON.stringify(report.gradient),
  );
  assert.equal(report.gradient.gap[3], 0);
  report.checks.push("gradient opacity direction and NaN gaps");
  let cdp = await page.context().newCDPSession(page);
  let capture = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(
    `${directory}/gradient.png`,
    Buffer.from(capture.data, "base64"),
  );
  await cdp.detach();
  await page.evaluate(() => window.featureChart.dispose());
  report.incremental = await page.evaluate(() => {
    const l = window.lib,
      c = l
        .cryChart()
        .ChartXY({ container: "chart" })
        .setTitle("Incremental append and complete clear/replay")
        .setAutoCursorMode(l.AutoCursorModes.disabled);
    c.getDefaultAxisX().setInterval({ start: 0, end: 4 });
    c.getDefaultAxisY().setInterval({ start: 0, end: 10 });
    const s = c
      .addLineSeries()
      .setStrokeStyle(
        new l.SolidLine({
          thickness: 4,
          fillStyle: new l.SolidFill({ color: l.ColorRGBA(0, 255, 0) }),
        }),
      )
      .add([
        { x: 0, y: 1 },
        { x: 1, y: 2 },
      ]);
    c.renderNow();
    const before = c.getRenderStats().uploadedBytes;
    s.add({ x: 3, y: 8 });
    c.renderNow();
    const after = c.getRenderStats().uploadedBytes,
      gl = c.renderer.gl,
      r = c.plot,
      pixel = (x, y) => {
        const p = new Uint8Array(4);
        gl.readPixels(
          Math.round((r.left + (x / 4) * r.width) * c.dpr),
          Math.round(
            c.canvas.height - (r.top + (1 - y / 10) * r.height) * c.dpr,
          ),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          p,
        );
        return [...p];
      };
    const tail = pixel(2, 5);
    s.clear().add([
      { x: 0, y: 8 },
      { x: 4, y: 8 },
    ]);
    c.renderNow();
    const oldPixel = pixel(2, 5),
      newPixel = pixel(2, 8),
      afterReplay = c.getRenderStats().uploadedBytes;
    window.featureChart = c;
    return {
      before,
      after,
      afterReplay,
      tail,
      oldPixel,
      newPixel,
      point: { x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 },
      error: gl.getError(),
    };
  });
  // Each upload also maintains one endpoint neighbor for the joined stroke mesh.
  assert.equal(report.incremental.after - report.incremental.before, 32);
  assert.equal(report.incremental.afterReplay - report.incremental.after, 64);
  assert.ok(report.incremental.tail[1] > 200);
  assert.equal(report.incremental.oldPixel[3], 0);
  assert.ok(report.incremental.newPixel[1] > 200);
  assert.equal(report.incremental.error, 0);
  report.checks.push(
    "GPU appends upload only new points while clear/replay replaces all geometry",
  );
  await page.mouse.move(report.incremental.point.x, report.incremental.point.y);
  report.disabledCursor = await page.evaluate(() => {
    const c = window.featureChart;
    c.renderNow();
    const pixels = c.overlay
      .getContext("2d")
      .getImageData(0, 0, c.overlay.width, c.overlay.height).data;
    let count = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) count++;
    return {
      mode: c.getAutoCursorMode(),
      positioned: c.getCursor().positioned,
      overlayPixels: count,
    };
  });
  assert.equal(report.disabledCursor.mode, 0);
  assert.equal(report.disabledCursor.positioned, false);
  assert.equal(report.disabledCursor.overlayPixels, 0);
  report.checks.push(
    "disabled auto cursor draws no overlay after real mouse movement",
  );
  await page.evaluate(() => window.featureChart.dispose());
  await showStep(
    page,
    "CRYChart：虚线与样条实测",
    "密集短线段保持连续虚线，相同缩放平移复用GPU缓冲",
  );
  report.dash = await page.evaluate(() => {
    const l = window.lib,
      c = l
        .cryChart()
        .ChartXY({ container: "chart" })
        .setTitle("Continuous dash phase across 1000 short segments");
    c.getDefaultAxisX().setInterval({ start: 0, end: 10 });
    c.getDefaultAxisY().setInterval({ start: 0, end: 10 });
    c.addLineSeries()
      .setStrokeStyle(
        new l.DashedLine({
          pattern: [12, 8],
          thickness: 4,
          fillStyle: new l.SolidFill({ color: l.ColorRGBA(255, 0, 0) }),
        }),
      )
      .add(Array.from({ length: 1001 }, (_, i) => ({ x: i / 100, y: 5 })));
    c.renderNow();
    const gl = c.renderer.gl,
      r = c.plot,
      w = Math.floor(r.width * c.dpr),
      pixels = new Uint8Array(w * 4);
    gl.readPixels(
      Math.round(r.left * c.dpr),
      Math.round(c.canvas.height - (r.top + r.height / 2) * c.dpr),
      w,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    let visible = 0,
      hidden = 0,
      transitions = 0,
      last = false;
    for (let i = 4; i < w - 4; i++) {
      const on = pixels[i * 4 + 3] > 128;
      on ? visible++ : hidden++;
      if (on !== last) transitions++;
      last = on;
    }
    const before = c.getRenderStats().uploads;
    c.getDefaultAxisX().setInterval({ start: 1, end: 11 });
    c.renderNow();
    const after = c.getRenderStats().uploads,
      result = {
        visible,
        hidden,
        transitions,
        before,
        after,
        error: gl.getError(),
      };
    c.dispose();
    return result;
  });
  assert.ok(
    report.dash.visible > report.dash.hidden &&
      report.dash.hidden > 100 &&
      report.dash.transitions > 20,
    JSON.stringify(report.dash),
  );
  assert.equal(report.dash.before, report.dash.after);
  assert.equal(report.dash.error, 0);
  report.checks.push(
    "GPU dash phase survives dense segments and pan reuses buffers",
  );
  report.spline = await page.evaluate(() => {
    const l = window.lib,
      c = l
        .cryChart()
        .ChartXY({ container: "chart" })
        .setTitle("Original cubic spline");
    c.getDefaultAxisX().setInterval({ start: 0, end: 2 });
    c.getDefaultAxisY().setInterval({ start: 0, end: 1 });
    c.addSplineSeries()
      .setStrokeStyle(
        new l.SolidLine({
          thickness: 4,
          fillStyle: new l.SolidFill({ color: l.ColorRGBA(0, 255, 0) }),
        }),
      )
      .add([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 0 },
      ]);
    c.renderNow();
    const gl = c.renderer.gl,
      r = c.plot,
      pixel = (x, y) => {
        const p = new Uint8Array(4);
        gl.readPixels(
          Math.round((r.left + (x / 2) * r.width) * c.dpr),
          Math.round(c.canvas.height - (r.top + (1 - y) * r.height) * c.dpr),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          p,
        );
        return [...p];
      };
    const result = {
      curved: pixel(0.5, 0.625),
      straight: pixel(0.5, 0.5),
      error: gl.getError(),
    };
    window.featureChart = c;
    return result;
  });
  assert.ok(report.spline.curved[1] > 200, JSON.stringify(report.spline));
  assert.equal(report.spline.straight[3], 0);
  assert.equal(report.spline.error, 0);
  report.checks.push(
    "GPU spline passes the independent cubic midpoint and differs from a straight segment",
  );
  cdp = await page.context().newCDPSession(page);
  capture = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${directory}/spline.png`, Buffer.from(capture.data, "base64"));
  await cdp.detach();
  await page.evaluate(() => window.featureChart.dispose());
  await showStep(
    page,
    "CRYChart：气泡和颜色阈值实测",
    "按样本大小、旋转、颜色与LUT边界检查真实GPU像素",
  );
  report.attributes = await page.evaluate(() => {
    const l = window.lib,
      c = l
        .cryChart()
        .ChartXY({ container: "chart" })
        .setTitle(
          "Per-sample colors, sizes, rotations and exact LUT boundaries",
        );
    c.getDefaultAxisX().setInterval({ start: 0, end: 10 });
    c.getDefaultAxisY().setInterval({ start: 0, end: 10 });
    c.addPointSeries({ pointShape: l.PointShape.Triangle })
      .setPointFillStyle(new l.IndividualPointFill())
      .setIndividualPointSizeEnabled(true)
      .setIndividualPointRotationEnabled(true)
      .add([
        { x: 2, y: 7, color: l.ColorRGBA(255, 0, 0), size: 24, rotation: 0 },
        { x: 4, y: 7, color: l.ColorRGBA(0, 0, 255), size: 40, rotation: 180 },
      ]);
    const lut = new l.LUT({
      steps: [
        { value: 0, color: l.ColorRGBA(0, 255, 0) },
        { value: 5, color: l.ColorRGBA(255, 0, 0) },
        { value: 10, color: l.ColorRGBA(0, 0, 255) },
      ],
      interpolate: false,
    });
    c.addLineSeries()
      .setStrokeStyle(
        new l.SolidLine({
          thickness: 5,
          fillStyle: new l.PalettedFill({ lut, lookUpProperty: "value" }),
        }),
      )
      .add([
        { x: 1, y: 2, value: 0 },
        { x: 9, y: 2, value: 10 },
      ]);
    c.addPointSeries()
      .setPointSize(24)
      .setIndividualPointValueEnabled(true)
      .setPointFillStyle(new l.PalettedFill({ lut, lookUpProperty: "value" }))
      .add([
        { x: 6, y: 7, value: 0 },
        { x: 8, y: 7, value: 10 },
      ]);
    c.renderNow();
    const gl = c.renderer.gl,
      r = c.plot,
      pixel = (x, y, dx = 0, dy = 0) => {
        const p = new Uint8Array(4);
        gl.readPixels(
          Math.round((r.left + (x / 10) * r.width + dx) * c.dpr),
          Math.round(
            c.canvas.height - (r.top + (1 - y / 10) * r.height + dy) * c.dpr,
          ),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          p,
        );
        return [...p];
      };
    const values = {
        red: pixel(2, 7),
        blue: pixel(4, 7),
        smallOutside: pixel(2, 7, 16, 0),
        // Keep the interior probe clear of the analytically covered triangle edge.
        largeInside: pixel(4, 7, 14, -14),
        uprightTop: pixel(2, 7, 0, -9),
        invertedBottom: pixel(4, 7, 0, 16),
        paletteGreen: pixel(6, 7),
        paletteBlue: pixel(8, 7),
        thresholdBefore: pixel(4.9, 2),
        thresholdAfter: pixel(5.1, 2),
      },
      before = c.getRenderStats().uploads;
    c.getDefaultAxisX().setInterval({ start: 1, end: 11 });
    c.renderNow();
    const after = c.getRenderStats().uploads;
    window.featureChart = c;
    return { values, before, after, error: gl.getError() };
  });
  const ap = report.attributes.values;
  assert.deepEqual(ap.red, [255, 0, 0, 255]);
  assert.deepEqual(ap.blue, [0, 0, 255, 255]);
  assert.equal(ap.smallOutside[3], 0);
  assert.equal(ap.largeInside[3], 255);
  assert.equal(ap.uprightTop[3], 255);
  assert.equal(ap.invertedBottom[3], 255);
  assert.deepEqual(ap.paletteGreen, [0, 255, 0, 255]);
  assert.deepEqual(ap.paletteBlue, [0, 0, 255, 255]);
  assert.deepEqual(ap.thresholdBefore, [0, 255, 0, 255]);
  assert.deepEqual(ap.thresholdAfter, [255, 0, 0, 255]);
  assert.equal(report.attributes.before, report.attributes.after);
  assert.equal(report.attributes.error, 0);
  report.checks.push(
    "GPU per-sample colors, sizes, rotation and hard LUT boundaries retain cached buffers",
  );
  cdp = await page.context().newCDPSession(page);
  capture = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(
    `${directory}/attributes.png`,
    Buffer.from(capture.data, "base64"),
  );
  await cdp.detach();
  await page.evaluate(() => window.featureChart.dispose());
  report.pointBorder = await page.evaluate(() => {
    const l = window.lib,
      c = l.cryChart().ChartXY({ container: "chart" });
    c.getDefaultAxisX().setInterval({ start: 0, end: 10 });
    c.getDefaultAxisY().setInterval({ start: 0, end: 10 });
    c.addPointSeries()
      .setPointSize(50)
      .setPointFillStyle(new l.SolidFill({ color: l.ColorRGBA(255, 0, 0, 64) }))
      .setPointStrokeStyle(
        new l.SolidLine({
          thickness: 3,
          fillStyle: new l.SolidFill({ color: l.ColorRGBA(240, 240, 240) }),
        }),
      )
      .add({ x: 5, y: 5 });
    c.renderNow();
    const gl = c.renderer.gl,
      r = c.plot,
      pixel = (dx) => {
        const p = new Uint8Array(4);
        gl.readPixels(
          Math.round((r.left + r.width / 2 + dx) * c.dpr),
          Math.round(c.canvas.height - (r.top + r.height / 2) * c.dpr),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          p,
        );
        return [...p];
      };
    const result = { center: pixel(0), rim: pixel(23), outside: pixel(27) };
    c.dispose();
    return result;
  });
  assert.ok(Math.abs(report.pointBorder.center[3] - 64) < 2);
  assert.ok(report.pointBorder.rim[0] > 230 && report.pointBorder.rim[3] > 250);
  assert.equal(report.pointBorder.outside[3], 0);
  report.checks.push(
    "GPU bubble outline preserves translucent interior without an opaque backing",
  );
  report.pointCoverage = await page.evaluate(() => {
    const l=window.lib,c=l.cryChart().ChartXY({container:'chart'}).setTitle('Analytic point coverage / unclipped rotated square');
    c.getDefaultAxisX().setInterval({start:0,end:10});c.getDefaultAxisY().setInterval({start:0,end:10});
    c.addPointSeries().setPointSize(50).setPointFillStyle(new l.SolidFill({color:l.ColorRGBA(0,255,255)})).add({x:3,y:5});
    c.addPointSeries().setPointShape('square').setPointRotation(45).setPointSize(40).setPointFillStyle(new l.SolidFill({color:l.ColorRGBA(255,190,0)})).add({x:7,y:5});
    c.renderNow();const gl=c.renderer.gl,r=c.plot,size=Math.ceil(60*c.dpr),pixels=new Uint8Array(size*size*4);
    gl.readPixels(Math.floor((r.left+.3*r.width-30)*c.dpr),Math.floor(c.canvas.height-(r.top+.5*r.height+30)*c.dpr),size,size,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    let partiallyCovered=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>0&&pixels[i]<255)partiallyCovered++;
    const pixel=(dx)=>{const p=new Uint8Array(4);gl.readPixels(Math.round((r.left+.7*r.width+dx)*c.dpr),Math.round(c.canvas.height-(r.top+.5*r.height)*c.dpr),1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];};
    window.featureChart=c;return {antialias:gl.getContextAttributes().antialias,partiallyCovered,rotatedCorner:pixel(25),outside:pixel(31),error:gl.getError()};
  });
  assert.equal(report.pointCoverage.antialias,false);
  assert.ok(report.pointCoverage.partiallyCovered>20,JSON.stringify(report.pointCoverage));
  assert.ok(report.pointCoverage.rotatedCorner[3]>240,JSON.stringify(report.pointCoverage));
  assert.equal(report.pointCoverage.outside[3],0);assert.equal(report.pointCoverage.error,0);
  report.checks.push('Analytic point edge coverage without MSAA and rotation preserves square corners');
  cdp=await page.context().newCDPSession(page);capture=await cdp.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${directory}/point-coverage.png`,Buffer.from(capture.data,'base64'));await cdp.detach();await page.evaluate(()=>window.featureChart.dispose());
  report.viewportCulling=await page.evaluate(()=>{
    const l=window.lib,c=l.cryChart().ChartXY({container:'chart'}),n=100000,x=Float64Array.from({length:n},(_,i)=>i),y=Float64Array.from({length:n},(_,i)=>5+3*Math.sin(i*.021));
    c.getDefaultAxisX().setInterval({start:50000.25,end:51000.75});c.getDefaultAxisY().setInterval({start:0,end:10});
    const s=c.addLineSeries().setStrokeStyle(new l.DashedLine({thickness:2,pattern:[12,8],fillStyle:new l.SolidFill({color:l.ColorRGBA(0,255,0)})})).addArraysXY(x,y);
    c.renderNow();const gl=c.renderer.gl,read=()=>{const a=new Uint8Array(c.canvas.width*c.canvas.height*4);gl.readPixels(0,0,c.canvas.width,c.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,a);return a;},limited=read(),culledVertices=c.getRenderStats().vertices,uploads=c.getRenderStats().uploads,original=s.drawPacket.bind(s);
    s.drawPacket=(...args)=>({...original(...args),monotonicX:false});c.renderNow();const full=read(),fullVertices=c.getRenderStats().vertices;let differentBytes=0;for(let i=0;i<limited.length;i++)if(limited[i]!==full[i])differentBytes++;
    s.drawPacket=original;c.getDefaultAxisX().setInterval({start:50100.25,end:51100.75});c.renderNow();const result={differentBytes,culledVertices,fullVertices,uploads,afterPan:c.getRenderStats().uploads,count:s.getSampleCount(),error:gl.getError()};c.dispose();return result;
  });
  assert.equal(report.viewportCulling.differentBytes,0,JSON.stringify(report.viewportCulling));assert.ok(report.viewportCulling.culledVertices<report.viewportCulling.fullVertices/50);assert.equal(report.viewportCulling.uploads,report.viewportCulling.afterPan);assert.equal(report.viewportCulling.count,100000);assert.equal(report.viewportCulling.error,0);
  report.checks.push('Visible-range line culling matches every full-draw pixel, keeps dash phase and all data, and pans without uploads');
  await showStep(
    page,
    "CRYChart：热力图插值实测",
    "先插值强度再查颜色表，保留NaN缺口；对数轴按每个像素反投影",
  );
  report.interpolation = await page.evaluate(() => {
    const l = window.lib,
      c = l
        .cryChart()
        .ChartXY({ container: "chart" })
        .setTitle("Bilinear intensities / hard color lookup table");
    c.getDefaultAxisX().setInterval({ start: 0, end: 2 });
    c.getDefaultAxisY().setInterval({ start: 0, end: 2 });
    const h = c
      .addHeatmapGridSeries({ columns: 2, rows: 2 })
      .setFillStyle(
        new l.PalettedFill({
          lut: new l.LUT({
            steps: [
              { value: 0, color: l.ColorRGBA(255, 0, 0) },
              { value: 0.25, color: l.ColorRGBA(0, 255, 0) },
              { value: 0.75, color: l.ColorRGBA(0, 0, 255) },
            ],
            interpolate: false,
          }),
        }),
      )
      .invalidateIntensityValues([
        [0, 0],
        [0, 1],
      ]);
    c.renderNow();
    const gl = c.renderer.gl,
      r = c.plot,
      pixel = (x, y) => {
        const p = new Uint8Array(4);
        gl.readPixels(
          Math.round((r.left + (x / 2) * r.width) * c.dpr),
          Math.round(
            c.canvas.height - (r.top + (1 - y / 2) * r.height) * c.dpr,
          ),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          p,
        );
        return [...p];
      };
    const nearest = pixel(1.1, 1.1),
      uploads = c.getRenderStats().heatmapStats.uploads;
    h.setIntensityInterpolation("bilinear");
    c.renderNow();
    const blended = pixel(1.1, 1.1),
      after = c.getRenderStats().heatmapStats.uploads;
    h.invalidateIntensityValues([
      [0, 0],
      [0, NaN],
    ]);
    c.renderNow();
    const gap = pixel(1.4, 1.4),
      finite = pixel(0.2, 0.2),
      result = {
        nearest,
        blended,
        uploads,
        after,
        gap,
        finite,
        error: gl.getError(),
      };
    c.dispose();
    return result;
  });
  assert.deepEqual(report.interpolation.nearest, [0, 0, 255, 255]);
  assert.deepEqual(report.interpolation.blended, [0, 255, 0, 255]);
  assert.equal(report.interpolation.uploads, report.interpolation.after);
  assert.equal(report.interpolation.gap[3], 0);
  assert.deepEqual(report.interpolation.finite, [255, 0, 0, 255]);
  assert.equal(report.interpolation.error, 0);
  report.checks.push(
    "GPU bilinear intensity interpolation precedes LUT without texture reupload and keeps gaps transparent",
  );
  report.logHeatmap = await page.evaluate(() => {
    const l = window.lib,
      c = l
        .cryChart()
        .ChartXY({ container: "chart", defaultAxisX: { type: "logarithmic" } })
        .setTitle("Logarithmic heatmap coordinates");
    c.getDefaultAxisX().setInterval({ start: 1, end: 100 });
    c.getDefaultAxisY().setInterval({ start: 0, end: 1 });
    c.addHeatmapGridSeries({
      columns: 2,
      rows: 1,
      start: { x: 1, y: 0 },
      step: { x: 49.5, y: 1 },
    })
      .setFillStyle(
        new l.PalettedFill({
          lut: new l.LUT({
            steps: [
              { value: 0, color: l.ColorRGBA(255, 0, 0) },
              { value: 1, color: l.ColorRGBA(0, 0, 255) },
            ],
          }),
        }),
      )
      .invalidateIntensityValues([[0, 1]]);
    c.renderNow();
    const r = c.plot,
      ctx = c.underlay.getContext("2d"),
      pixel = (x) => [
        ...ctx.getImageData(
          Math.round(
            (r.left + c.getDefaultAxisX().valueToFraction(x) * r.width) * c.dpr,
          ),
          Math.round((r.top + r.height * 0.45) * c.dpr),
          1,
          1,
        ).data,
      ];
    const result = { at10: pixel(10), at80: pixel(80) };
    c.dispose();
    return result;
  });
  assert.deepEqual(report.logHeatmap.at10, [255, 0, 0, 255]);
  assert.deepEqual(report.logHeatmap.at80, [0, 0, 255, 255]);
  report.checks.push(
    "CPU heatmap fallback maps logarithmic cells using inverse axis coordinates",
  );
  await showStep(
    page,
    "CRYChart：地图交互实测",
    "区域与内洞命中、点覆盖层、鼠标锚定缩放、平移",
  );
  const mapCoordinates = await page.evaluate(() => {
    const l = window.lib,
      m = l
        .cryChart()
        .MapChart({ container: "chart" })
        .setTitle("Map region with a hole / overlay and view controls");
    m.setGeoJSON({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "region",
          properties: { name: "Region A" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 10],
                [0, 0],
              ],
              [
                [3, 3],
                [7, 3],
                [7, 7],
                [3, 7],
                [3, 3],
              ],
            ],
          },
        },
      ],
    });
    m.setRegionValues({ region: 42 });
    m.addPointSeries()
      .setName("Sensor")
      .setPointSize(16)
      .add([[2, 2]]);
    window.mapEvents = [];
    m.on("regionclick", (e) =>
      window.mapEvents.push({ kind: "region", key: e.key, value: e.value }),
    );
    m.on("overlayclick", (e) =>
      window.mapEvents.push({ kind: "overlay", index: e.index }),
    );
    m.canvas.addEventListener(
      "wheel",
      (event) => {
        const b = m.canvas.getBoundingClientRect(),
          anchor = { x: event.clientX - b.left, y: event.clientY - b.top };
        window.mapWheelBefore = {
          anchor,
          position: m.screenToPosition(anchor),
          view: m.getView(),
        };
      },
      { capture: true },
    );
    m.render();
    window.featureMap = m;
    return {
      region: m.positionToScreen([1, 1]),
      hole: m.positionToScreen([5, 5]),
      point: m.positionToScreen([2, 2]),
    };
  });
  const box = await page.locator("#chart canvas").boundingBox(),
    screen = (p) => ({ x: box.x + p.x, y: box.y + p.y });
  for (const p of [
    mapCoordinates.region,
    mapCoordinates.hole,
    mapCoordinates.point,
  ]) {
    const q = screen(p);
    await page.mouse.click(q.x, q.y);
  }
  report.mapEvents = await page.evaluate(() => window.mapEvents);
  assert.deepEqual(report.mapEvents, [
    { kind: "region", key: "region", value: 42 },
    { kind: "overlay", index: 0 },
  ]);
  report.checks.push("map region, hole exclusion and overlay hit priority");
  const anchor = screen(mapCoordinates.hole);
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.wheel(0, -220);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const before = await page.evaluate(() => window.mapWheelBefore);
  const after = await page.evaluate(
    (p) => ({
      position: window.featureMap.screenToPosition(p),
      view: window.featureMap.getView(),
    }),
    before.anchor,
  );
  report.mapZoom = { before, after };
  assert.ok(after.view.zoom > before.view.zoom);
  assert.ok(
    after.position.every((v, i) => Math.abs(v - before.position[i]) < 1e-8),
    JSON.stringify(report.mapZoom),
  );
  report.mapPan = await page.evaluate(() => {
    const m = window.featureMap,
      a = m.positionToScreen([1, 1]);
    m.panBy(30, -20);
    m.render();
    const b = m.positionToScreen([1, 1]);
    return { dx: b.x - a.x, dy: b.y - a.y };
  });
  assert.ok(
    Math.abs(report.mapPan.dx - 30) < 1e-8 &&
      Math.abs(report.mapPan.dy + 20) < 1e-8,
  );
  report.checks.push("map anchored wheel zoom and pixel-space pan");
  cdp = await page.context().newCDPSession(page);
  capture = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${directory}/map.png`, Buffer.from(capture.data, "base64"));
  await cdp.detach();
  assert.deepEqual(report.errors, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  writeFileSync(`${directory}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser?.close();
  await service.close();
}
