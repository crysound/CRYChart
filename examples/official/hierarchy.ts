import {ColorHEX, FontSettings, SolidFill, SolidLine, transparentFill} from '../../src/core/styles';
import type {HierarchyNode, SlicedHierarchyChart, StageSlice, SunBurstChart} from '../../src/hierarchy';
import type {OfficialEntry, OfficialMountContext, OfficialMounted} from './types';

const stageColors = ['#ffff78', '#ffd36c', '#ff9d64', '#f5b9b5'];
const text = ColorHEX('#f3f3d2');
const background = 'radial-gradient(ellipse at 68% 38%,#303132 0%,#171819 58%,#050606 100%)';
const contacts = [{name: 'Prospects', value: 2000}, {name: 'Contacts', value: 1540}, {name: 'Leads', value: 1095}, {name: 'Customers', value: 549}];
const years = [{name: '2015 - 2016', value: 3}, {name: '2016 - 2017', value: 5}, {name: '2017 - 2018', value: 10}, {name: '2018 - 2019', value: 17}];

function itemLegend(host: HTMLElement, slices: StageSlice[]): () => void {
  const row = document.createElement('div'); row.style.cssText = 'height:40px;flex:none;display:flex;align-items:center;justify-content:center;min-width:0;padding:3px 5px 7px';
  const box = document.createElement('div'); box.style.cssText = 'display:flex;gap:8px;align-items:center;max-width:100%;overflow:auto;border:1px solid #b0b0a2;border-radius:9px;background:#080909c9;padding:3px 9px;box-shadow:0 0 2px #f1f1cc;font:12px sans-serif';
  const cleanups: Array<() => void> = [];
  slices.forEach((slice, index) => {
    const button = document.createElement('button'), swatch = document.createElement('span'), label = document.createElement('span');
    button.type = 'button'; button.setAttribute('aria-pressed', 'true'); button.style.cssText = 'display:inline-flex;align-items:center;gap:4px;flex:none;white-space:nowrap;border:0;background:transparent;color:#f3f3d2;padding:2px 0;font:inherit;cursor:pointer';
    swatch.style.cssText = `width:10px;height:10px;flex:none;border-radius:50%;background:radial-gradient(circle at 25% 25%,#fff,${stageColors[index]},#444);box-shadow:0 0 2px #ffffff66`;
    label.textContent = slice.getName(); button.append(swatch, label);
    const click = () => {slice.setVisible(!slice.getVisible()); button.setAttribute('aria-pressed', String(slice.getVisible())); button.style.opacity = slice.getVisible() ? '1' : '.35';};
    button.addEventListener('click', click); cleanups.push(() => button.removeEventListener('click', click)); box.append(button);
  });
  row.append(box); host.append(row); return () => {cleanups.forEach(fn => fn()); row.remove();};
}

function mountStages(context: OfficialMountContext, kind: 'Funnel' | 'Pyramid', data: Array<{name: string; value: number}>, title: string): OfficialMounted {
  const wrapper = document.createElement('div'); wrapper.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);width:100%;height:100%;min-height:0;flex:1;gap:4px;background:linear-gradient(90deg,#000,#444 50%,#000)'; context.host.append(wrapper);
  const charts: SlicedHierarchyChart[] = [], cleanup: Array<() => void> = [];
  for (let index = 0; index < 2; index++) {
    const panel = document.createElement('div'), chartHost = document.createElement('div');
    panel.style.cssText = `display:flex;flex-direction:column;min-width:0;min-height:0;background:${background}`; chartHost.style.cssText = 'flex:1;min-height:0;width:100%'; panel.append(chartHost); wrapper.append(panel);
    const chart: SlicedHierarchyChart = context.engine[kind]({container: chartHost, theme: {...context.theme, textColor: text}});
    chart.setTitle(title).setTitleFont(new FontSettings({size: 18, weight: 400})).setPadding(9).setBackgroundFillStyle(transparentFill)
      .setSliceMode(index === 0 ? 'VariableWidth' : 'VariableHeight').setLabelPosition(index === 0 ? 'left' : 'inside')
      .setSliceSpacing(4).setSliceGap(8).setSliceGradient(true).setSliceEffect(true).setLabelEffect(index === 1)
      .setLabelFont(new FontSettings({size: 13})).setLabelFillStyle(new SolidFill({color: text}))
      .setLabelFormatter(slice => `${slice.getName()}: ${slice.getValue()}`)
      .setSliceStrokeStyle(new SolidLine({fillStyle: new SolidFill({color: ColorHEX('#e1dfc6')}), thickness: 1.5}));
    const slices = chart.addSlices(data); slices.forEach((slice, i) => slice.setFillStyle(new SolidFill({color: ColorHEX(stageColors[i])})));
    cleanup.push(itemLegend(panel, slices)); charts.push(chart);
  }
  return {charts, dispose: () => {cleanup.forEach(fn => fn()); wrapper.remove();}, snapshot: () => ({kind, panels: charts.map((chart, index) => ({mode: index === 0 ? 'VariableWidth' : 'VariableHeight', labelPosition: index === 0 ? 'left' : 'inside', stages: chart.getSlices().map(slice => ({name: slice.getName(), value: slice.getValue(), visible: slice.getVisible()}))})), referenceValues: true})};
}

/** Category labels observed on the reference; counts below are independently selected. */
function inventory(): HierarchyNode[] {
  const leaf = (name: string, value: number): HierarchyNode => ({name, value});
  const branch = (name: string, children: HierarchyNode[]): HierarchyNode => ({name, children});
  const roots = [
    branch('Home & Kitchen', [branch('Decor', [leaf('Wall Art', 10), leaf('Lighting', 18)]), branch('Kitchen', [leaf('Appliances', 14), leaf('Utensils', 10), leaf('Cookware', 14)])]),
    branch('Sports', [leaf('Team sports', 34), leaf('Hiking', 38), leaf('Fitness', 41)]),
    branch('Health & Beauty', [branch('Healthcare', [leaf('Supplements', 43)]), branch('Makeup', [leaf('Lips', 20), leaf('Eyes', 25), leaf('Face', 30)]), branch('Personal care', [leaf('Oral Care', 22), leaf('Bodycare', 31), leaf('Haircare', 42), leaf('Skincare', 55)])]),
    branch('Clothing', [branch('Children', [leaf('Shoes', 16), leaf('Clothing', 22), leaf('Accessories', 12)]), branch('Men', [leaf('Shoes', 19), leaf('Bottoms', 29), leaf('Tops', 33), leaf('Accessories', 18)]), branch('Women', [leaf('Dresses', 22), leaf('Shoes', 24), leaf('Bottoms', 28), leaf('Tops', 30)])]),
    branch('Electronics', [branch('Laptops', [leaf('Gaming laptops', 31), leaf('Ultrabooks', 24), leaf('Business laptops', 27)]), branch('Audio & Video', [leaf('Smart TVs', 26), leaf('Speakers', 28), leaf('Headphones', 44)]), branch('Mobile devices', [leaf('Accessories', 40), branch('Smartphones', [leaf('iOS', 28), leaf('Android', 52)])])]),
  ];
  const hues = ['#ffab12', '#eab91c', '#f3d51a', '#ffeb40', '#fff198'];
  const paint = (node: HierarchyNode, color: string) => {node.color = color; node.children?.forEach(child => paint(child, color));};
  roots.forEach((node, index) => paint(node, hues[index])); return roots;
}

export const hierarchyEntries: OfficialEntry[] = [
  {
    id: 'crychart-example-1712-sunBurstChart',
    title: '旭日图 · 1712',
    description: '五类库存按层级展开为同色系圆环；鼠标指向分支会突出其后代，点击可进入子树，并通过左上返回或中心孔回到父层。',
    observed: ["五类库存按层级展开为同色系圆环；鼠标指向分支会突出其后代，点击可进入子树，并通过左上返回或中心孔回到父层。"],
    gaps: ["本库场景的功能、交互和资源占用需在目标运行环境验证。","Team sports、Personal care、Mobile devices 等名称包含对截断标签的推定展开。"],
    mount(context) {
      const panel = document.createElement('div'); panel.style.cssText = `width:100%;height:100%;flex:1;min-height:0;background:${background}`; context.host.append(panel);
      const chart: SunBurstChart = context.engine.SunBurstChart({container: panel, theme: {...context.theme, textColor: text}});
      chart.setTitle('Inventory by Category').setTitleFont(new FontSettings({size: 18, weight: 400})).setPadding(9).setBackgroundFillStyle(transparentFill)
        .setData(inventory()).setStartAngle(0).setInnerRadius(.08).setRadiusFactor(.49).setMaxDepth(4)
        .setCenterLabelVisible(false).setHoleFillStyle(new SolidFill({color: ColorHEX('#3b3d3a')})).setLabelOrientation('radial')
        .setLabelFont(new FontSettings({size: 13})).setLabelFillStyle(new SolidFill({color: text})).setLabelEffect(true);
      return {charts: [chart], dispose: () => panel.remove(), snapshot: () => ({focusPath: chart.getPath(), rootCategories: chart.getData().map(node => node.name), independentLeafValues: true, maximumRings: 4})};
    },
  },
  {
    id: 'crychart-example-0460-simpleFunnelChart',
    title: '漏斗图 · 0460',
    description: '同一组四阶段客户数据并排展示。左侧等层高并用外侧引线标签，右侧按数值分配层高并显示内标签；两侧各有图例。',
    observed: ["同一组四阶段客户数据并排展示。左侧等层高并用外侧引线标签，右侧按数值分配层高并显示内标签；两侧各有图例。"],
    gaps: ["本库场景的功能、交互和资源占用需在目标运行环境验证。","边界宽度按可见轮廓推导为累计值比例，尚需对照更多输入验证。"],
    mount: context => mountStages(context, 'Funnel', contacts, 'Customer contacts progression'),
  },
  {
    id: 'crychart-example-0465-simplePyramidChart',
    title: '金字塔图 · 0465',
    description: '四年的员工人数为 3、5、10、17。左侧等层高并显示外侧引线标签，右侧按人数分配层高并显示内标签。',
    observed: ["四年的员工人数为 3、5、10、17。左侧等层高并显示外侧引线标签，右侧按人数分配层高并显示内标签。"],
    gaps: ["左侧边界宽度采用从公开画面推导的累计人数比例，仍需更多数据输入对照。","本库场景的功能、交互和资源占用需在目标运行环境验证。","标签描边、投影和图例框尚未做像素级对齐。"],
    mount: context => mountStages(context, 'Pyramid', years, 'Company staff growth'),
  },
];
