import {ColorHEX, ColorRGBA, FontSettings, LUT, SolidFill, SolidLine, transparentFill} from '../../src/core/styles';
import type {BarChart, BarDatum, Gauge, Pie, PieSlice, Spider, SpiderSeries, SpecialtyChart, TreeMapChart, TreeMapNode} from '../../src/specialty';
import type {OfficialEntry, OfficialMountContext, OfficialMounted} from './types';

const colors = ['#ffff57', '#ffd266', '#ff9c59', '#ffc7c0', '#ff93bd', '#d394c4', '#ebc8e0', '#aa94c0', '#94dfc8', '#95ffb2', '#b8ff9b'];
const textColor = ColorHEX('#f3f3d2');
const background = 'radial-gradient(ellipse at 66% 37%,#303132 0%,#171819 58%,#050606 100%)';
const fill = (color: string) => new SolidFill({color: ColorHEX(color)});
const line = (color: string, thickness = 1.5) => new SolidLine({fillStyle: fill(color), thickness});
const unknownAnimation = "本库场景的功能、交互和资源占用需在目标运行环境验证。";
const visualGap = '字体、背景、阴影、边缘抗锯齿和标签位置仍需逐像素比较。';
const legendGap = "本库场景的功能、交互和资源占用需在目标运行环境验证。";

export const businessFixtures = {
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  electricity: [20, 20, -25, 40, 28, -23, -40, 35, 17, 24, -29, 15],
  temperatures: [['Singapore', 32.6], ['Kathmandu', 29.8], ['Tokyo', 26.5], ['Barcelona', 23.7], ['Kyiv', 23.4], ['Beijing', 22.4], ['Budapest', 21.8], ['Chicago', 21.4], ['Tallinn', 21], ['New York', 20.6], ['Helsinki', 19.1], ['Berlin', 18], ['Stockholm', 17.2], ['London', 16.6], ['Oslo', 16.3]] as Array<[string, number]>,
  rooms: ['5 chair room', '5 chair room', '5 chair room', '10 chair room', '10 chair room', '20 chair room', 'Conference Hall'],
  reservations: [
    {name: 'Certificate exams', row: 0, start: 10, end: 13}, {name: 'Interview', row: 0, start: 16, end: 18},
    {name: 'Trainee training program', row: 1, start: 8, end: 17}, {name: 'Department competition training sessions', row: 2, start: 12, end: 20},
    {name: 'Internet security training', row: 3, start: 9, end: 17}, {name: 'Scrum meeting', row: 4, start: 10, end: 12}, {name: 'Development meeting', row: 4, start: 15, end: 19},
    {name: 'First Aid training', row: 5, start: 11, end: 16}, {name: 'Conquering the silence - How to improve your marketing', row: 6, start: 9, end: 18},
  ],
  projectTime: [{name: 'Planning', value: 20}, {name: 'Development', value: 60}, {name: 'Testing', value: 30}, {name: 'Review', value: 12}, {name: 'Bug Fixing', value: 45}],
  visitors: [{name: 'US', value: 15000}, {name: 'Canada', value: 20030}, {name: 'Greece', value: 8237}, {name: 'UK', value: 16790}, {name: 'Finland', value: 9842}, {name: 'Denmark', value: 4300}],
  radarAxes: ['Pre-planning', 'Customer contacts', 'Meetings', 'Development time', 'Releases'],
  radarMaxima: [94, 63, 97, 76, 100],
  radarBranches: [{name: 'Sydney', values: [6, 21, 60, 76, 100]}, {name: 'Kuopio', values: [44, 8, 97, 68, 70]}, {name: 'New York', values: [94, 63, 4, 67, 70]}],
  lookupInitial: [97, 89, 10, 76, 58, 21, 83, 104, 60, 16],
};

/** Clock labels deliberately fix the observed noon-as-12AM mistake. */
export function businessHourLabel(hour: number): string {const normalized = ((Math.round(hour) % 24) + 24) % 24; return `${normalized % 12 || 12}${normalized < 12 ? 'AM' : 'PM'}`;}
export function dashboardSample(channel: number, time: number): number {
  return Math.max(0, Math.min(100, 50 + 31 * Math.sin(time * (.34 + channel * .055) + channel * 1.9) + 14 * Math.sin(time * 1.47 + channel) + 4 * Math.sin(time * 23.1 + channel * 2.7)));
}
export function animatedRadarFrame(elapsed: number): number[] {return Array.from({length: 5}, (_, i) => Math.max(2, Math.min(100, 53 + 37 * Math.sin(elapsed * (.65 + i * .13) + i * .8) + 8 * Math.sin(elapsed * 1.8 + i))));}

function frame(context: OfficialMountContext): {wrapper: HTMLDivElement; host: HTMLDivElement} {
  const wrapper = document.createElement('div'), host = document.createElement('div');
  wrapper.style.cssText = `display:flex;flex-direction:column;width:100%;height:100%;min-height:0;flex:1;background:${background}`;
  host.style.cssText = 'flex:1;min-height:0;position:relative'; wrapper.append(host); context.host.append(wrapper); return {wrapper, host};
}
function style<T extends SpecialtyChart>(chart: T, title: string): T {return chart.setTitle(title).setTitleAlignment('center').setTitleFont(new FontSettings({size: 18, weight: 400})).setPadding(9).setBackgroundFillStyle(transparentFill);}
const chartTheme = (context: OfficialMountContext) => ({...context.theme, textColor});
interface LegendItem {name: string; color: () => string; visible: () => boolean; toggle: (value: boolean) => void;}
function legend(host: HTMLElement, items: LegendItem[]): {dispose: () => void; refresh: () => void} {
  const row = document.createElement('div'), box = document.createElement('div'); row.dataset.businessLegend = 'true'; row.style.cssText = 'height:40px;min-height:40px;display:flex;justify-content:center;align-items:center;padding:3px 6px 7px';
  box.style.cssText = 'display:flex;max-width:100%;gap:8px;overflow:auto;border:1px solid #b0b0a2;border-radius:9px;background:#080909ca;padding:4px 9px;box-shadow:0 0 2px #f3f3c9;font:12px sans-serif';
  const bindings = items.map(item => {
    const button = document.createElement('button'), swatch = document.createElement('span'); button.type = 'button'; button.style.cssText = 'display:inline-flex;align-items:center;gap:4px;flex:none;white-space:nowrap;border:0;background:none;color:#f3f3d2;padding:2px 0;font:inherit;cursor:pointer';
    swatch.style.cssText = 'width:10px;height:10px;border-radius:50%;flex:none'; button.append(swatch, document.createTextNode(item.name)); box.append(button);
    const refresh = () => {swatch.style.background = item.color(); button.setAttribute('aria-pressed', String(item.visible())); button.style.opacity = item.visible() ? '1' : '.35';};
    const click = () => {item.toggle(!item.visible()); refresh();}; button.addEventListener('click', click); refresh(); return {refresh, dispose: () => button.removeEventListener('click', click)};
  });
  row.append(box); host.append(row); return {refresh: () => bindings.forEach(item => item.refresh()), dispose: () => {bindings.forEach(item => item.dispose()); row.remove();}};
}

function mountBars(context: OfficialMountContext, horizontal: boolean): OfficialMounted {
  const view = frame(context), chart: BarChart = context.engine.BarChart({container: view.host, theme: chartTheme(context)});
  style(chart, horizontal ? 'Global temperatures' : 'Bar Chart').setHorizontal(horizontal).setGridVisible(false).setCornerRadius(8).setBarEffect(true).setValueFormatter(value => value.toFixed(1));
  if (horizontal) chart.setValueInterval({start: 0, end: 35}).setTickCount(7).setValueAxisTitle('Temperature (°C)').setValueAxisPlacement('start').setLabelPosition('outside').setBarLabelFormatter(item => item.value.toFixed(1))
    .setData(businessFixtures.temperatures.map(([category, value], i) => ({category, value, color: colors[i % colors.length]})));
  else chart.setValueInterval({start: -40, end: 40}).setTickCount(8).setValueAxisTitle('Electricity consumption change (%)').setLabelPosition('inside').setLabelEffect(true).setBarLabelFormatter(item => item.value.toFixed(1))
    .setData(businessFixtures.months.map((category, i) => ({category, value: businessFixtures.electricity[i], color: businessFixtures.electricity[i] >= 0 ? '#ff0000' : '#00ff00'})));
  return {charts: [chart], dispose: () => view.wrapper.remove(), snapshot: () => ({orientation: horizontal ? 'horizontal' : 'vertical', values: chart.getData().map(item => ({category: item.category, value: item.value})), valueInterval: horizontal ? [0, 35] : [-40, 40], labels: horizontal ? 'outside' : 'inside', selection: chart.getSelectedItem()?.category})};
}

function mountSpan(context: OfficialMountContext): OfficialMounted {
  const view = frame(context), chart: BarChart = context.engine.BarChart({container: view.host, theme: chartTheme(context)});
  style(chart, 'Conference Room Reservations').setHorizontal(true).setCategories(businessFixtures.rooms).setValueInterval({start: 8, end: 20}).setTickCount(12).setValueAxisPlacement('end').setCategoryAxisTitle('Conference Room')
    .setValueFormatter(businessHourLabel).setGridVisible(false).setCornerRadius(10).setGradientFill(true).setBarEffect(true).setLabelPosition('inside').setBarLabelFormatter(item => item.label!)
    .setData(businessFixtures.reservations.map((item, i) => ({category: businessFixtures.rooms[item.row], row: item.row, start: item.start, value: item.end - item.start, label: item.name, color: colors[i % colors.length]})));
  return {charts: [chart], dispose: () => view.wrapper.remove(), snapshot: () => ({rows: businessFixtures.rooms, reservations: businessFixtures.reservations, noonLabel: businessHourLabel(12), selected: chart.getSelectedItem()?.label})};
}

function mountSpider(context: OfficialMountContext, animated: boolean): OfficialMounted {
  const view = frame(context), chart: Spider = context.engine.Spider({container: view.host, theme: chartTheme(context)});
  style(chart, animated ? 'Animated Radar Chart' : 'Company branch efficiency').setRadiusFactor(animated ? .43 : .40).setTickCount(4).setTickLabels(animated ? 'first' : 'all').setGridShape(animated ? 'circle' : 'polygon').setLabelEffect(true);
  const axes = animated ? ['Category A', 'Category B', 'Category C', 'Category D', 'Category E'] : businessFixtures.radarAxes;
  const series: SpiderSeries[] = [], labels: LegendItem[] = [];
  for (const [index, branch] of (animated ? [{name: 'Series', values: [92, 92, 92, 92, 92]}] : businessFixtures.radarBranches).entries()) {
    const item = chart.addSeries().setName(branch.name).setFillStyle(fill(colors[index])).setFillOpacity(.4).setStrokeStyle(line(colors[index], 2)).setData(axes.map((name, i) => ({name, value: branch.values[i]}))); series.push(item);
    labels.push({name: branch.name, color: () => colors[index], visible: () => item.getVisible(), toggle: value => item.setVisible(value)});
  }
  axes.forEach((name, i) => chart.setAxisRange(name, {start: 0, end: animated ? 100 : businessFixtures.radarMaxima[i]}));
  const control = animated ? undefined : legend(view.wrapper, labels); let lastFrame = -1;
  return {charts: [chart], update: animated ? elapsed => {const frame = Math.floor(elapsed * 12); if (frame === lastFrame) return; lastFrame = frame; const values = animatedRadarFrame(elapsed); series[0].setData(axes.map((name, i) => ({name, value: values[i]}))); axes.forEach((name, i) => chart.setAxisRange(name, {start: 0, end: values[i]})); chart.setTickLabels('all');} : undefined,
    dispose: () => {control?.dispose(); view.wrapper.remove();}, snapshot: () => ({axes, grid: animated ? 'circle' : 'polygon', independentAxisRanges: axes.map(name => chart.getAxisRange(name)), series: series.map(item => ({name: item.name, visible: item.visible, values: item.points.map(point => point.value)})), animated})};
}

function mountPie(context: OfficialMountContext, mode: 'pie' | 'donut' | 'lookup'): OfficialMounted {
  const view = frame(context), chart: Pie = context.engine.Pie({container: view.host, theme: chartTheme(context)}), lookup = mode === 'lookup', donut = mode === 'donut';
  style(chart, lookup ? 'Pie Chart' : donut ? 'Inter Hotels - hotel visitors in June 2016' : 'Project Time Division').setRadiusFactor(lookup ? .40 : .46).setSelectionOffset(22).setLabelPosition(lookup ? 'outside' : 'inside').setLabelEffect(!lookup).setLabelFont(new FontSettings({size: 12}));
  if (donut) chart.setInnerRadius(60).setCenterLabel(total => `Total: ${Math.round(total)} visitors`);
  const data = lookup ? businessFixtures.lookupInitial.map((value, i) => ({name: `Slice #${i + 1}`, value})) : donut ? businessFixtures.visitors : businessFixtures.projectTime;
  const palette = new LUT({steps: [{value: 0, color: ColorHEX('#ff0000')}, {value: 25, color: ColorHEX('#ff0000')}, {value: 40, color: ColorHEX('#ff9e24')}, {value: 60, color: ColorHEX('#ffff30')}, {value: 80, color: ColorHEX('#00883b')}, {value: 100, color: ColorHEX('#0900d8')}, {value: 120, color: ColorHEX('#a820bb')}]});
  const slices: PieSlice[] = data.map((item, i) => chart.addSlice(item.name, item.value).setFillStyle(lookup ? new SolidFill({color: palette.getColor(item.value)}) : fill(colors[i])).setStrokeStyle(line('#eeeece', 1.2)));
  if (!lookup) {const order = donut ? ['Canada', 'Denmark', 'Finland', 'Greece', 'UK', 'US'] : ['Bug Fixing', 'Development', 'Planning', 'Review', 'Testing']; chart.setSliceSorter((a, b) => order.indexOf(a.name) - order.indexOf(b.name));}
  chart.setLabelFormatter((slice, relativeValue) => lookup || donut ? `${slice.name}: ${Math.round(slice.value)}` : `${slice.name}: ${(relativeValue * 100).toFixed(2)}%`);
  const controls = legend(view.wrapper, slices.map(slice => ({name: slice.name, color: () => slice.getFillStyle()!.getColor!().toCSS(), visible: () => slice.getVisible(), toggle: value => slice.setVisible(value)})));
  let bucket = 0;
  return {charts: [chart], update: lookup ? elapsed => {const next = Math.floor(elapsed / 2.5); if (next === bucket) return; bucket = next; slices.forEach((slice, i) => {const value = Math.round(65 + 52 * Math.sin(next * .83 + i * 1.71)); slice.setValue(value).setFillStyle(new SolidFill({color: palette.getColor(value)}));}); controls.refresh();} : undefined,
    dispose: () => {controls.dispose(); view.wrapper.remove();}, snapshot: () => ({mode, innerRadius: chart.innerRadius, values: slices.map(slice => ({name: slice.name, value: slice.value, visible: slice.visible})), total: slices.filter(slice => slice.visible).reduce((sum, slice) => sum + slice.value, 0), selected: chart.getSelectedItem()?.name, lookupUpdates: bucket})};
}

const leaf = (name: string, value: number): TreeMapNode => ({name, value});
const branch = (name: string, children: TreeMapNode[], color?: string): TreeMapNode => ({name, children, ...(color ? {color} : {})});
export function companySectors(): TreeMapNode[] {return [
  branch('TECHNOLOGY', [['NVDA', 180], ['AVGO', 75], ['CRM', 70], ['ADBE', 60], ['INTU', 45], ['MSFT', 42], ['AAPL', 38], ['ORCL', 22]].map(([name, value]) => leaf(String(name), Number(value))), '#f5e68b'),
  branch('COMMUNICATION SERVICES', [leaf('META', 140), leaf('NFLX', 75), leaf('GOOG', 60), leaf('TMUS', 6)], '#f8e22d'),
  branch('CONSUMER CYCLICAL', [leaf('TSLA', 95), leaf('AMZN', 80), leaf('MCD', 17), leaf('HD', 13)], '#edd311'),
  branch('FINANCIAL', [leaf('JPM', 28), leaf('V', 27), leaf('BRK-B', 23), leaf('BAC', 18)], '#eeb119'),
];}
export function pythonInstallationTree(): TreeMapNode[] {
  const files = (prefix: string, count: number, scale: number) => Array.from({length: count}, (_, i) => leaf(`${prefix}_${String(i + 1).padStart(3, '0')}.py`, scale * (1 + ((i * 17) % 29))));
  const encodings = ['mac_arabic.py', 'cp865.py', 'cp850.py', 'cp852.py', 'cp437.py', 'cp858.py', 'cp860.py', 'cp775.py', 'cp857.py', 'cp737.py', 'cp866.py', 'cp855.py', 'cp861.py', 'cp863.py', 'cp864.py', 'cp862.py', 'cp869.py', 'cp720.py', 'cp037.py', 'aliases.py'];
  const numpy = branch('numpy', [branch('core', [branch('tests', files('test', 70, 1900)), leaf('_multiarray_umath.pyd', 1800000), ...files('core', 35, 1700)]), branch('lib', [branch('tests', files('test', 50, 900)), ...files('lib', 20, 800)]), ...['ma', 'polynomial', 'random', 'distutils', 'f2py', 'doc', 'fft'].map((name, i) => branch(name, files(name, 12 + i * 3, 900)))]);
  const lib = branch('Lib', [branch('site-packages', [numpy, branch('pip', [branch('_vendor', files('vendor', 80, 1800)), ...files('pip', 20, 700)]), branch('setuptools', files('package', 40, 1600))]), branch('test', [branch('decimaltestdata', files('decimal', 70, 1200)), ...files('test', 220, 2200)]), branch('ensurepip', [branch('_bundled', [leaf('pip-1.whl', 1200000)])]), branch('distutils', files('command', 45, 800)), branch('encodings', [...encodings.map((name, i) => leaf(name, 65000 - i * 1900)), ...files('encoding', 80, 400)]), ...['idlelib', 'lib-tk', 'email', 'pydoc_data', 'xml'].map(name => branch(name, files(name, 24, 900)))], '#f3e792');
  return [branch('C:\\Python27', [lib, branch('DLLs', [leaf('_ssl.pyd', 1400000), leaf('_hashlib.pyd', 900000), leaf('_bsddb.pyd', 700000), ...files('library', 30, 2500)], '#f9e732'), branch('tcl', [branch('tcl8.5', files('encoding', 45, 800)), branch('tk8.5', [branch('demos', files('demo', 25, 900)), ...files('tk', 20, 400)])], '#e5ca11'), branch('Doc', [leaf('python2718.chm', 1900000)], '#e9ad14'), branch('libs', files('library', 8, 3000), '#ef9d07'), branch('Tools', files('tool', 30, 800), '#ff6640'), leaf('NEWS.txt', 320000), branch('include', files('header', 18, 600), '#db488e')], '#343c3d')];
}
export function marketplaceTreeAt(elapsed = 0): TreeMapNode[] {
  const group = (name: string, names: string[], value: number) => branch(name, names.map((label, i) => leaf(label, value * (1 - i * .12))));
  const data = [
    branch('Electronics', [branch('Mobile Phones', [branch('Smartphones', [group('iOS', ['Latest', 'Older Models'], 32), group('Android', ['Mid-Range', 'High-End', 'Budget'], 31)]), leaf('Feature Phones', 23)]), group('Television & Video', ['LED TVs', 'Projectors', 'Streaming'], 36), group('Laptops', ['Ultrabooks', 'Gaming Laptops'], 39), group('Cameras', ['DSLR', 'Point-and-shoot', 'Mirrorless'], 21)], '#f8e999'),
    branch('Clothing', [group('Women', ['Dresses', 'Bottoms', 'Tops', 'Outerwear'], 30), branch('Men', [group('Accessories', ['Hats', 'Watches'], 10), leaf('Pants', 24), leaf('Shirts', 25)]), group('Children', ['Baby', 'Girls', 'Boys'], 20)], '#ffe835'),
    branch('Home & Kitchen', [group('Kitchen Supplies', ['Appliances', 'Cookware', 'Utensils'], 31), group('Furniture', ['Chairs', 'Sofas', 'Tables'], 27), group('Decor', ['Ornaments', 'Wall Art', 'Vases'], 13)], '#eed317'),
    branch('Sports & Outdoors', [group('Outdoor Recreation', ['Cycling', 'Camping & Hiking', 'Fishing'], 23), group('Exercise & Fitness', ['Strength training', 'Cardio', 'Yoga'], 24), group('Team Sports', ['Baseball', 'Basketball', 'Soccer'], 11)], '#f0b21b'),
    branch('Health & Beauty', [group('Personal Care', ['Haircare', 'Skincare', 'Oral Care'], 25), group('Healthcare', ['Supplements', 'Medicines', 'Equipment'], 24), group('Makeup', ['Lips', 'Eyes', 'Face'], 15)], '#ff9f08'),
    branch('Toys & Games', [group('Games', ['Video Games', 'Card Games', 'Puzzles', 'Board Games'], 22), group('Toys', ['Building', 'Action figures', 'Dolls', 'Educational'], 17)], '#ff7a1e'),
    branch('Books', [group('Non-Fiction', ['History', 'Self-help', 'Biography'], 17), group('Fiction', ['Mystery', 'Sci-Fi', 'Stories'], 14), group("Children's Books", ['Learning', 'Storybooks'], 11)], '#fa5738'),
  ];
  let index = 0;
  const update = (node: TreeMapNode): number => {if (node.children?.length) {const weights = new Map(node.children.map(child => [child, update(child)])); if (elapsed > 0) node.children.sort((a, b) => weights.get(b)! - weights.get(a)!); return [...weights.values()].reduce((sum, value) => sum + value, 0);} const i = index++; node.value = node.value! * (elapsed === 0 ? 1 : .80 + .43 * Math.sin(elapsed * (.35 + i % 5 * .11) + i * 1.4)); return node.value;};
  const weights = new Map(data.map(node => [node, update(node)])); if (elapsed > 0) data.sort((a, b) => weights.get(b)! - weights.get(a)!); return data;
}

function mountTree(context: OfficialMountContext, mode: 'sectors' | 'files' | 'dynamic'): OfficialMounted {
  const view = frame(context), chart: TreeMapChart = context.engine.TreeMapChart({container: view.host, theme: chartTheme(context)});
  const title = mode === 'sectors' ? 'Sector Distribution of Leading Global Companies' : mode === 'files' ? 'Python installation file sizes - Click on Node to drilldown' : 'Marketplace Product Segmentation';
  style(chart, title).setHierarchyDepth(mode === 'sectors' ? 2 : 9).setValueLabelsVisible(false).setLabelEffect(true).setCornerRadius(7).setTilePadding(.8).setLabelFont(new FontSettings({size: 13}));
  chart.setData(mode === 'sectors' ? companySectors() : mode === 'files' ? pythonInstallationTree() : marketplaceTreeAt());
  let revision = 0;
  const count = (nodes: TreeMapNode[]): number => nodes.reduce((total, node) => total + 1 + (node.children ? count(node.children) : 0), 0);
  return {charts: [chart], update: mode === 'dynamic' ? elapsed => {const frame = Math.floor(elapsed * 2); if (frame === revision) return; revision = frame; chart.setData(marketplaceTreeAt(elapsed), {preservePath: true});} : undefined,
    dispose: () => view.wrapper.remove(), snapshot: () => ({mode, path: chart.getPath(), roots: chart.data.map(node => node.name), nodeCount: count(chart.data), updateRevision: revision, independentWeights: true})};
}

function mountGauge(context: OfficialMountContext): OfficialMounted {
  const view = frame(context), chart: Gauge = context.engine.Gauge({container: view.host, theme: chartTheme(context)});
  view.wrapper.style.background = 'radial-gradient(ellipse at 50% 60%,#555637 0%,#2a2c25 43%,#0b0c0c 76%)';
  style(chart, 'Speed').setInterval({start: 0, end: 120}).setArc(135, 270).setArcThickness(.16).setArcColor(ColorHEX('#c2c83b')).setProgressVisible(false).setCursorStyle('arc').setValueLabelPosition('center').setUnitLabel('km/h').setValueFontSize(58).setInteractive(false).setValueFormatter(value => value === 0 ? '0' : value.toFixed(2)).setValue(0);
  return {charts: [chart], update: elapsed => chart.setValue(elapsed < .3 ? 0 : Math.max(0, Math.min(120, 71 + 29 * Math.sin(elapsed * .74) + 13 * Math.sin(elapsed * 1.8)))), dispose: () => view.wrapper.remove(), snapshot: () => ({value: chart.getValue(), interval: chart.interval, arc: {start: 135, sweep: 270}, unit: 'km/h', autonomous: true})};
}

function mountGaugeDashboard(context: OfficialMountContext): OfficialMounted {
  const wrapper = document.createElement('div'); wrapper.style.cssText = 'width:100%;height:100%;display:grid;grid-template-columns:25% 75%;grid-template-rows:repeat(4,minmax(0,1fr));gap:1px;background:#0a0b0b;min-height:0;flex:1'; context.host.append(wrapper);
  const gauges: Gauge[] = [], plots: any[] = [], traces: any[] = [], values: number[] = [];
  for (let i = 0; i < 4; i++) {
    const gaugeHost = document.createElement('div'), plotHost = document.createElement('div'); gaugeHost.style.cssText = `min-height:0;min-width:0;background:${background}`; plotHost.style.cssText = 'min-height:0;min-width:0'; wrapper.append(gaugeHost, plotHost);
    const gauge: Gauge = context.engine.Gauge({container: gaugeHost, theme: chartTheme(context)}); style(gauge, '').setPadding(4).setInterval({start: 0, end: 100}).setArc(-180, 180).setArcThickness(.28).setCursorStyle('arc').setValueLabelPosition('center').setUnitLabel(`Channel ${i + 1}`).setValueFontSize(23).setProgressVisible(false).setTickValues([0, 33, 67, 100]).setBands([{start: 0, end: 33, color: ColorHEX('#ff0000')}, {start: 33, end: 67, color: ColorHEX('#ffff00')}, {start: 67, end: 100, color: ColorHEX('#00ff00')}]).setValueFormatter(value => value.toFixed(2)).setInteractive(false);
    const plot = context.engine.ChartXY({container: plotHost, theme: context.theme}); plot.setPadding({left: -20, right: -12, top: -34, bottom: -25}); plot.getDefaultAxisX().setVisible(false).setInterval({start: -30, end: 0}); plot.getDefaultAxisY().setInterval({start: 0, end: 105}).setTickStrategy('numeric', (strategy: any) => strategy.setMajorTickPlacement(() => [0, 50, 100].map(position => ({position, label: String(position)}))));
    const trace = plot.addLineSeries().setName(`Channel ${i + 1}`).setMaxSampleCount(600).setStrokeStyle(line(colors[i], 1.6)); gauges.push(gauge); plots.push(plot); traces.push(trace); values.push(0);
  }
  let sample = 0;
  return {charts: [...gauges, ...plots], update: elapsed => {const target = Math.floor(elapsed * 20), end = Math.min(target, sample + 200); if (end <= sample) return;
    traces.forEach((trace, channel) => {const points = Array.from({length: end - sample}, (_, i) => {const x = (sample + i) / 20; return {x, y: dashboardSample(channel, x)};}); trace.add(points); const value = points.at(-1)!.y; values[channel] = value; gauges[channel].setValue(value).setArcColor(ColorHEX(value < 33 ? '#ef1300' : value < 67 ? '#d2da00' : '#00df10')); plots[channel].getDefaultAxisX().setInterval({start: (end - 1) / 20 - 30, end: (end - 1) / 20});}); sample = end;},
    dispose: () => wrapper.remove(), snapshot: () => ({channels: 4, gaugeValues: values.slice(), samples: traces.map(trace => trace.getSampleCount()), latestSamples: traces.map(trace => trace.getPoints().at(-1)?.y), windows: plots.map(plot => plot.getDefaultAxisX().getInterval()), inputRateHz: 20, layout: 'four-rows-gauge-and-trace'})};
}

export const businessEntries: OfficialEntry[] = [
  {id: 'crychart-example-0300-verticalBars', title: '月度正负柱 · 0300', description: '十二个月的用电变化：增加为红色，降低为绿色，零线居中，柱端显示一位小数。', observed: ["十二个月的用电变化：增加为红色，降低为绿色，零线居中，柱端显示一位小数。"], gaps: ["观察序列中滚轮与拖动未改变柱布局；独立点击选择细节仍待核对。"], mount: context => mountBars(context, false)},
  {id: 'crychart-example-0301-horizontalBars', title: '全球城市温度 · 0301', description: '十五座城市按温度从高到低横向排列；数值轴在顶部，条形末端显示温度。', observed: ["十五座城市按温度从高到低横向排列；数值轴在顶部，条形末端显示温度。"], gaps: ["数值直接来自已观察画面，不代表当前城市天气。"], mount: context => mountBars(context, true)},
  {id: 'crychart-example-0303-spanChart', title: '会议室预约区间 · 0303', description: '九个预约分布在七行会议室上，各块保留独立起止时间，支持悬停查看完整活动名与时间。', observed: ["九个预约分布在七行会议室上，各块保留独立起止时间，支持悬停查看完整活动名与时间。"], gaps: ["起止时刻由整点网格与轮廓位置读取，精确原始时间戳未取得。","本库场景的功能、交互和资源占用需在目标运行环境验证。"], mount: mountSpan},
  {id: 'crychart-example-0400-spiderStatic', title: '分公司效率雷达 · 0400', description: 'Sydney、Kuopio、New York 的五维比较；各指标独立刻度，底部图例控制三个覆盖多边形。', observed: ["Sydney、Kuopio、New York 的五维比较；各指标独立刻度，底部图例控制三个覆盖多边形。"], gaps: ["本库场景的功能、交互和资源占用需在目标运行环境验证。"], mount: context => mountSpider(context, false)},
  {id: 'crychart-example-0401-spiderAnimated', title: '动态雷达与独立刻度 · 0401', description: '五类指标持续更新，圆形网格保留，轴的最大值随该指标变化。', observed: ["五类指标持续更新，圆形网格保留，轴的最大值随该指标变化。"], gaps: ["本库场景的功能、交互和资源占用需在目标运行环境验证。"], mount: context => mountSpider(context, true)},
  {id: 'crychart-example-0450-pieChart', title: '项目时间分配 · 0450', description: '五个项目阶段显示百分比，图例切换，扇区选择后向外移出。', observed: ["五个项目阶段显示百分比，图例切换，扇区选择后向外移出。"], gaps: ["使用能得到相同显示百分比的独立比例权重，原始时间量与单位未观察到。"], mount: context => mountPie(context, 'pie')},
  {id: 'crychart-example-0451-donutChart', title: '酒店访客环图 · 0451', description: '六国访客数显示在环内，中心显示合计 74199，底部图例切换可见类别。', observed: ["六国访客数显示在环内，中心显示合计 74199，底部图例切换可见类别。"], gaps: ["隐藏扇区后中心合计是否按可见项重算尚未观察，本地按可见项计算。"], mount: context => mountPie(context, 'donut')},
  {id: 'crychart-example-0452-pieLUT', title: '值映射颜色的动态饼图 · 0452', description: '十个扇区数值变化时同步更新面积和颜色；外侧引线标签及底部图例展示各项当前状态。', observed: ["十个扇区数值变化时同步更新面积和颜色；外侧引线标签及底部图例展示各项当前状态。"], gaps: ["颜色查找表断点根据可见颜色独立选取，原始 LUT 配置未读取。"], mount: context => mountPie(context, 'lookup')},
  {id: 'crychart-example-1504-TreeMap', title: '公司行业树图 · 1504', description: '行业外框与公司矩形同时展示，点击行业标题可下钻，再从左上返回。', observed: ["行业外框与公司矩形同时展示，点击行业标题可下钻，再从左上返回。"], gaps: ["公司权重为独立示例值，不代表市值或投资资料；无法确认的窄标签用独立样本补足。","本库场景的功能、交互和资源占用需在目标运行环境验证。","完整下钻触发区域和返回手势仍需独立核对。"], mount: context => mountTree(context, 'sectors')},
  {id: 'crychart-example-1505-TreeMapDrilldown', title: 'Python 安装文件层级 · 1505', description: '文件夹多层嵌套显示，面积表示独立生成的示例文件大小；点击文件夹标题下钻并保留返回路径。', observed: ["文件夹多层嵌套显示，面积表示独立生成的示例文件大小；点击文件夹标题下钻并保留返回路径。"], gaps: ["本库场景的功能、交互和资源占用需在目标运行环境验证。","省略名称的展开为推定，未知文件使用明确的示例文件名。","矩形排布、深层节点可见阈值和圆角仍有差异。"], mount: context => mountTree(context, 'files')},
  {id: 'crychart-example-1506-TreeMapDynamic', title: '商品层级动态树图 · 1506', description: '七类商品及其子类同时显示；独立动态权重驱动重排，并在更新时保留当前下钻路径。', observed: ["七类商品及其子类同时显示；独立动态权重驱动重排，并在更新时保留当前下钻路径。"], gaps: ["完整叶节点名称、权重和更新逻辑未知；使用可见类别及独立补充数据。","本库场景的功能、交互和资源占用需在目标运行环境验证。"], mount: context => mountTree(context, 'dynamic')},
  {id: 'crychart-example-1600-basicGauge', title: '速度弧形仪表 · 1600', description: '0–120 km/h 的 270° 弧形仪表，值与弧上的游标同步变化。', observed: ["0–120 km/h 的 270° 弧形仪表，值与弧上的游标同步变化。"], gaps: ["游标拖动是否直接改值未独立确认，本地按输入数据更新。"], mount: mountGauge},
  {id: 'crychart-example-1602-gaugeDashboard', title: '四通道仪表与趋势 · 1602', description: '左侧四个仪表与右侧对应趋势同步更新；四条曲线共享同一时间窗口。', observed: ["左侧四个仪表与右侧对应趋势同步更新；四条曲线共享同一时间窗口。"], gaps: ["本库场景的功能、交互和资源占用需在目标运行环境验证。"], mount: mountGaugeDashboard},
];

const businessDataProvenance: Record<string, {kind: string; referenceValues?: string[]; independentlyGenerated?: string[]}> = {
  '0300': {kind: 'reference-visible-scalars', referenceValues: ['month labels', '12 electricity change percentages']},
  '0301': {kind: 'reference-visible-scalars', referenceValues: ['15 city labels and temperatures']},
  '0303': {kind: 'reference-visible-labels-and-geometry', referenceValues: ['room labels', 'reservation names'], independentlyGenerated: ['hour boundaries estimated from the visible grid']},
  '0400': {kind: 'mixed-reference-and-independent', referenceValues: ['five axis names and maxima', 'three branch names'], independentlyGenerated: ['series values approximating the observed shape']},
  '0401': {kind: 'independent-synthetic', independentlyGenerated: ['dynamic radar values and timing']},
  '0450': {kind: 'reference-visible-ratios', referenceValues: ['five displayed percentages and category names'], independentlyGenerated: ['integer weights producing those rounded percentages']},
  '0451': {kind: 'reference-visible-scalars', referenceValues: ['six country visitor counts and total 74199']},
  '0452': {kind: 'mixed-reference-and-independent', referenceValues: ['ten initial slice values'], independentlyGenerated: ['subsequent values, timing and LUT breakpoints']},
  '1504': {kind: 'mixed-reference-and-independent', referenceValues: ['visible sector and company names'], independentlyGenerated: ['weights and unconfirmed small company label']},
  '1505': {kind: 'mixed-reference-and-independent', referenceValues: ['visible directory and file names'], independentlyGenerated: ['additional sample filenames and all file sizes']},
  '1506': {kind: 'mixed-reference-and-independent', referenceValues: ['visible product category names'], independentlyGenerated: ['additional leaf names, weights and update formulas']},
  '1600': {kind: 'independent-synthetic', referenceValues: ['0–120 km/h range'], independentlyGenerated: ['speed signal and timing']},
  '1602': {kind: 'independent-synthetic', referenceValues: ['channel labels and 0–100 range'], independentlyGenerated: ['four signals, 20 Hz input and 30 second retention']},
};
for (const entry of businessEntries) {
  const mount = entry.mount!, provenance = businessDataProvenance[entry.id.match(/-(\d{4})-/)![1]];
  entry.mount = context => {const mounted = mount(context), snapshot = mounted.snapshot; return {...mounted, snapshot: () => ({...snapshot?.(), dataProvenance: provenance})};};
}
