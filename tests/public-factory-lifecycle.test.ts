import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { cryChart, Dashboard } from "../src/index.js";
import * as API from "../src/index.js";
import { apiTest } from "./helpers/api-test.js";

function verifyFactory(
  name:
    | "ChartXY"
    | "Chart3D"
    | "Polar"
    | "Pie"
    | "Gauge"
    | "Spider"
    | "BarChart"
    | "TreeMapChart"
    | "ParallelCoordinateChart"
    | "DataGrid"
    | "MapChart"
    | "SunBurstChart"
    | "Funnel"
    | "Pyramid",
) {
  const engine = cryChart(),
    chart = engine[name]({ headless: true });
  assert.equal(chart.constructor, API[name]);
  let disposals = 0;
  chart.onDispose(() => {
    disposals++;
  });
  assert.equal(engine.getChartCount(), 1);
  chart.dispose();
  assert.equal(engine.getChartCount(), 0);
  const owned = engine[name]({ headless: true });
  assert.equal(owned.constructor, API[name]);
  engine.dispose();
  engine.dispose();
  assert.equal(owned.isDisposed(), true);
  assert.equal(engine.isDisposed(), true);
  assert.equal(engine.getChartCount(), 0);
  assert.equal(disposals, 1);
  assert.throws(
    () => engine[name]({ headless: true }),
    /context has been disposed/,
  );
}
apiTest(
  "public ChartXY factory registers ownership and rejects creation after context disposal",
  ["cryChart().ChartXY", "ChartXY.constructor"],
  () => verifyFactory("ChartXY"),
);
apiTest(
  "public Chart3D factory registers ownership and rejects creation after context disposal",
  ["cryChart().Chart3D", "Chart3D.constructor"],
  () => verifyFactory("Chart3D"),
);
apiTest(
  "public Polar factory registers ownership and rejects creation after context disposal",
  ["cryChart().Polar", "Polar.constructor"],
  () => verifyFactory("Polar"),
);
apiTest(
  "public Pie factory registers ownership and rejects creation after context disposal",
  ["cryChart().Pie", "Pie.constructor"],
  () => verifyFactory("Pie"),
);
apiTest(
  "public Gauge factory registers ownership and rejects creation after context disposal",
  ["cryChart().Gauge", "Gauge.constructor"],
  () => verifyFactory("Gauge"),
);
apiTest(
  "public Spider factory registers ownership and rejects creation after context disposal",
  ["cryChart().Spider", "Spider.constructor"],
  () => verifyFactory("Spider"),
);
apiTest(
  "public BarChart factory registers ownership and rejects creation after context disposal",
  ["cryChart().BarChart", "BarChart.constructor"],
  () => verifyFactory("BarChart"),
);
apiTest(
  "public TreeMapChart factory registers ownership and rejects creation after context disposal",
  ["cryChart().TreeMapChart", "TreeMapChart.constructor"],
  () => verifyFactory("TreeMapChart"),
);
apiTest(
  "public ParallelCoordinateChart factory registers ownership and rejects creation after context disposal",
  ["cryChart().ParallelCoordinateChart", "ParallelCoordinateChart.constructor"],
  () => verifyFactory("ParallelCoordinateChart"),
);
apiTest(
  "public DataGrid factory registers ownership and rejects creation after context disposal",
  ["cryChart().DataGrid", "DataGrid.constructor"],
  () => verifyFactory("DataGrid"),
);
apiTest(
  "public MapChart factory registers ownership and rejects creation after context disposal",
  ["cryChart().MapChart", "MapChart.constructor"],
  () => verifyFactory("MapChart"),
);
apiTest(
  "public SunBurstChart factory registers ownership and rejects creation after context disposal",
  ["cryChart().SunBurstChart", "SunBurstChart.constructor"],
  () => verifyFactory("SunBurstChart"),
);
apiTest(
  "public Funnel factory registers ownership and rejects creation after context disposal",
  ["cryChart().Funnel", "Funnel.constructor"],
  () => verifyFactory("Funnel"),
);
apiTest(
  "public Pyramid factory registers ownership and rejects creation after context disposal",
  ["cryChart().Pyramid", "Pyramid.constructor"],
  () => verifyFactory("Pyramid"),
);

function dashboardDocument(t: TestContext) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  const element = (): any => ({
    style: { cssText: "" },
    children: [] as any[],
    parent: undefined as any,
    setAttribute() {},
    getContext() {
      return null;
    },
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 500 };
    },
    append(child: any) {
      child.parent = this;
      this.children.push(child);
    },
    remove() {
      if (this.parent)
        this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.parent = undefined;
    },
  });
  const host = element(),
    body = element();
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      body,
      createElement: element,
      getElementById: (id: string) => (id === "host" ? host : null),
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  });
  return { host, body };
}

apiTest(
  "dashboard factories own their grid cells and release individually disposed children",
  [
    "Dashboard.createChartXY",
    "Dashboard.createChart3D",
    "Dashboard.createPolar",
    "Dashboard.createPie",
    "Dashboard.createGauge",
    "Dashboard.createSpider",
  ],
  (t) => {
    const { host } = dashboardDocument(t),
      engine = cryChart();
    const dashboard = engine.Dashboard({
      container: "host",
      numberOfColumns: 3,
      numberOfRows: 2,
    });
    assert.equal(engine.getChartCount(), 1);
    assert.equal(host.children.length, 1);
    assert.match(dashboard.root.style.cssText, /repeat\(3,/);
    const children = [
      "createChartXY",
      "createChart3D",
      "createPolar",
      "createPie",
      "createGauge",
      "createSpider",
    ].map((name) => {
      const chart = (dashboard as any)[name]({
        headless: true,
        columnIndex: 1,
        rowIndex: 0,
        columnSpan: 2,
      });
      return chart;
    });
    assert.deepEqual(
      children.map((chart) => chart.constructor),
      [API.ChartXY, API.Chart3D, API.Polar, API.Pie, API.Gauge, API.Spider],
    );
    assert.equal(dashboard.getChartCount(), 6);
    assert.equal(dashboard.root.children.length, 6);
    assert.match(
      (dashboard.root.children[0] as HTMLElement).style.cssText,
      /grid-column:2\/span 2/,
    );
    children[0].dispose();
    assert.equal(dashboard.getChartCount(), 5);
    assert.equal(dashboard.root.children.length, 5);
    assert.throws(
      () =>
        dashboard.createChartXY({
          headless: true,
          experimentalLineDisplayPixels: 0,
        }),
      RangeError,
    );
    assert.equal(
      dashboard.root.children.length,
      5,
      "failed construction must remove its temporary cell",
    );
    engine.dispose();
    assert.equal(host.children.length, 0);
    assert.equal(dashboard.getChartCount(), 0);
    assert.ok(children.every((chart) => chart.isDisposed()));
    assert.throws(() => dashboard.createGauge({ headless: true }), /disposed/);
  },
);

test("dashboard cleanup continues through child and dashboard listener failures", (t) => {
  const { body } = dashboardDocument(t),
    dashboard = new Dashboard();
  const first = dashboard.createChartXY({ headless: true }),
    second = dashboard.createPie({ headless: true });
  first.onDispose(() => {
    throw new Error("child cleanup");
  });
  dashboard.onDispose(() => {
    throw new Error("dashboard cleanup");
  });
  assert.throws(
    () => dashboard.dispose(),
    (error: any) =>
      error instanceof AggregateError && error.errors.length === 2,
  );
  assert.equal(second.isDisposed(), true);
  assert.equal(dashboard.isDisposed(), true);
  assert.equal(dashboard.getChartCount(), 0);
  assert.equal(body.children.length, 0);
  dashboard.dispose();
});

test("dashboard reports missing DOM and missing containers without registering failed instances", (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Reflect.deleteProperty(globalThis, "document");
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  });
  const engine = cryChart();
  assert.throws(() => engine.Dashboard(), /requires a DOM/);
  assert.equal(engine.getChartCount(), 0);
  dashboardDocument(t);
  assert.throws(
    () => engine.Dashboard({ container: "missing" }),
    /container was not found/,
  );
  assert.equal(engine.getChartCount(), 0);
  engine.dispose();
});
