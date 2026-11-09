import referenceCatalog from '../docs/reference-examples.json';
import { recipes, type Demo, type Parameters, type Recipe } from './recipes';

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing gallery element: ${selector}`);
  return element;
};
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag); result.className = className; result.textContent = text; return result;
}
const parameters: Parameters = { points: 4096, frequency: 32, amplitude: 1, channels: 4, theme: 'dark' };
let mode: 'recipes' | 'references' = 'recipes';
let selected = 'stream', referenceId = '', active: Demo | undefined;
let frame = 0, paused = false, elapsed = 0, previous = 0, meterStart = 0, frames = 0;
let category = '', query = '';
const label = { points: '样本数量', frequency: '信号频率', amplitude: '幅值比例', channels: '通道数量' };

function report(status: string, detail = '') {
  (window as any).__CRY_GALLERY__ = { status, detail, selected, mode, recipeCount: recipes.length, referenceCount: referenceCatalog.examples.length,
    snapshot: () => ({ elapsed, paused, count: active?.count() ?? 0, charts: (document.querySelector('#chart-stage') as any)?.gallerySnapshot?.() ?? [] }),
  };
}
function teardown() {
  cancelAnimationFrame(frame); frame = 0;
  if (active) { active.dispose(); active = undefined; }
}
function updateTabs() {
  for (const tab of ['recipes', 'references'] as const) {
    const button = $(`#${tab}-tab`); button.classList.toggle('active', mode === tab); button.setAttribute('aria-selected', String(mode === tab));
  }
  const select = $<HTMLSelectElement>('#category'); select.replaceChildren(element('option', '', '全部分类'));
  select.options[0].value = '';
  const source = mode === 'recipes' ? recipes : referenceCatalog.examples;
  [...new Set(source.map(item => item.category))].forEach(name => { const option = element('option', '', name); option.value = name; select.append(option); });
  select.value = category;
}
function renderList() {
  const list = $('#demo-list'); list.replaceChildren();
  const source = mode === 'recipes' ? recipes : referenceCatalog.examples;
  const filtered = source.filter(item => (!category || item.category === category) && `${item.id} ${item.title} ${item.category} ${'summary' in item ? item.summary : item.description}`.toLowerCase().includes(query.toLowerCase()));
  $('#list-count').textContent = `${filtered.length} 项 · ${mode === 'recipes' ? '原创演示' : '图表场景'}`;
  for (const item of filtered) {
    const button = element('button', 'demo-link'); button.type = 'button';
    const current = mode === 'recipes' ? item.id === selected : item.id === referenceId;
    button.classList.toggle('active', current); if (current) button.setAttribute('aria-current', 'page');
    const icon = element('span', 'demo-icon', mode === 'recipes' ? '∿' : '↗'); icon.setAttribute('aria-hidden', 'true');
    const text = element('span'); text.append(element('div', 'demo-name', item.title.replace(/^JavaScript /, '')), element('div', 'demo-category', item.category));
    button.append(icon, text);
    if (mode === 'references') { const pending = element('span', 'pending-dot'); pending.title = '待验收'; button.append(pending); }
    button.onclick = () => { location.hash = mode === 'recipes' ? `demo=${item.id}` : `reference=${item.id}`; };
    list.append(button);
  }
  if (!filtered.length) list.append(element('div', 'empty', '没有匹配项。\n试试其他名称或分类。'));
}
function switchMode(next: typeof mode) {
  mode = next; category = ''; query = ''; $<HTMLInputElement>('#search').value = '';
  updateTabs(); renderList();
}
function breadcrumb(section: string, name: string) {
  const row = element('div', 'breadcrumb'); row.append(element('span', '', '实验室'), element('span', '', '/'), element('span', '', section), element('span', '', '/'), element('span', '', name)); return row;
}
function infoPanel(title: string, subtitle = '') {
  const panel = element('section', 'info-panel'), heading = element('h2', 'panel-heading', title);
  if (subtitle) heading.append(element('small', '', subtitle)); panel.append(heading); return panel;
}
function addControls(recipe: Recipe, panel: HTMLElement) {
  if (!recipe.controls?.length) panel.append(element('p', 'panel-text', '此示例使用固定的原创数据。可通过预览区浏览图表，或切换主题比较显示效果。'));
  for (const name of recipe.controls ?? []) {
    const row = element('label', 'control'); row.append(element('span', 'control-label', label[name]));
    if (name === 'points' || name === 'channels') {
      const select = element('select'); select.name = name; select.setAttribute('aria-label', label[name]);
      const values = name === 'points' ? [1024, 4096, 16384, 65536, 262144, 1048576] : [1, 2, 4, 5, 8, 16];
      for (const number of values) { const option = element('option', '', number.toLocaleString()); option.value = String(number); option.selected = number === parameters[name]; select.append(option); }
      select.onchange = () => { parameters[name] = Number(select.value); mountRecipe(recipe); }; row.append(select);
    } else {
      const input = element('input'), output = element('output', 'control-output'); input.type = 'range'; input.name = name; input.setAttribute('aria-label', label[name]);
      input.min = name === 'frequency' ? '2' : '0.2'; input.max = name === 'frequency' ? '120' : '3'; input.step = name === 'frequency' ? '1' : '0.1'; input.value = String(parameters[name]);
      const format = () => `${input.value}${name === 'frequency' ? ' Hz' : ' ×'}`; output.value = format();
      input.oninput = () => { output.value = format(); };
      input.onchange = () => { parameters[name] = Number(input.value); mountRecipe(recipe); }; row.append(input, output);
    }
    panel.append(row);
  }
}
function mountRecipe(recipe: Recipe) {
  teardown(); selected = recipe.id; paused = false; elapsed = 0; frames = 0; previous = 0; meterStart = 0;
  const main = $('#main'); main.replaceChildren(); main.append(breadcrumb(recipe.category, '原创演示'));
  const heading = element('div', 'heading-row'); heading.append(element('h1', 'headline', recipe.title), element('span', 'status-pill', '原创演示')); main.append(heading, element('p', 'subhead', recipe.description));
  const features = element('div', 'feature-row'); recipe.features.forEach(feature => features.append(element('span', 'feature', feature))); main.append(features);
  const toolbar = element('div', 'toolbar'), toolbarTitle = element('div', 'toolbar-title'); toolbarTitle.append(element('i', 'dot'), document.createTextNode('LIVE PREVIEW'));
  const actions = element('div', 'actions'), pause = element('button', 'button primary', '暂停'), reset = element('button', 'button', '重置'), expand = element('button', 'button subtle', '展开');
  pause.id = 'pause-button'; reset.id = 'reset-button'; expand.id = 'expand-button'; actions.append(pause, reset, expand); toolbar.append(toolbarTitle, actions); main.append(toolbar);
  const stage = element('div', 'chart-stage'); stage.id = 'chart-stage'; stage.setAttribute('aria-label', recipe.title); main.append(stage);
  const stats = element('div', 'stats');
  const entries = [['数据点', 'point-count', '—'], ['绘制回调频率', 'frame-rate', '—'], ['运行时长', 'elapsed-time', '0.0 s'], ['场景验证', 'reference-status', '待验证']];
  entries.forEach(([name, id, initial]) => { const stat = element('div', 'stat'), value = element('div', 'stat-value', initial); value.id = id; stat.append(element('div', 'stat-label', name), value); stats.append(stat); }); main.append(stats);
  const lower = element('div', 'bottom-grid'), controls = infoPanel('实验参数', '修改后重新生成'), references = infoPanel('场景与覆盖', '独立功能验证'); addControls(recipe, controls);
  references.append(element('p', 'panel-text', '这些条目展示相关的原生图表场景。功能、交互和性能需要分别验证。'));
  const links = element('div', 'reference-links'); recipe.references.forEach(id => { const link = element('a', 'reference-link', id); link.href = `#reference=crychart-example-${id}`; links.append(link); }); references.append(links);
  if (recipe.limitation) references.append(element('p', 'limitation', recipe.limitation)); lower.append(controls, references); main.append(lower);
  const foot = element('div', 'footnote'); foot.append(element('span', '', '数据均在本地生成，不依赖远程素材。回调频率不是 GPU 渲染吞吐或性能对标结果。'), element('span', '', `${recipe.id} · CRYChart`)); main.append(foot);
  pause.onclick = () => { paused = !paused; pause.textContent = paused ? '继续' : '暂停'; pause.setAttribute('aria-pressed', String(paused)); previous = 0; };
  reset.onclick = () => mountRecipe(recipe);
  expand.onclick = () => { const expanded = stage.classList.toggle('wide'); expand.textContent = expanded ? '收起' : '展开'; expand.setAttribute('aria-expanded', String(expanded)); };
  try {
    active = recipe.create(stage, parameters); $('#point-count').textContent = active.count().toLocaleString();
    if (!active.update) { pause.disabled = true; pause.textContent = '静态'; $('#frame-rate').textContent = '静态'; }
    report('mounted');
    const tick = (now: number) => {
      try {
        const delta = previous ? Math.min(0.1, (now - previous) / 1000) : 0; previous = now;
        if (!paused && active?.update) { elapsed += delta; active.update(elapsed, delta); frames++; }
        if (!meterStart) meterStart = now;
        if (now - meterStart >= 500) {
          $('#point-count').textContent = (active?.count() ?? 0).toLocaleString(); $('#elapsed-time').textContent = `${elapsed.toFixed(1)} s`;
          if (active?.update) $('#frame-rate').textContent = paused ? '已暂停' : `${Math.round(frames * 1000 / (now - meterStart))} fps`;
          frames = 0; meterStart = now;
        }
        frame = requestAnimationFrame(tick);
      } catch (error) { showError(stage, error); }
    };
    frame = requestAnimationFrame(tick);
  } catch (error) { showError(stage, error); }
  renderList();
}
function showError(stage: HTMLElement, error: unknown) {
  teardown(); const message = error instanceof Error ? error.message : String(error); stage.replaceChildren(); stage.classList.remove('chart-grid');
  const box = element('div', 'chart-error'); box.append(element('strong', '', '此演示未成功运行'), element('span', '', '当前能力仍需修复或补齐，不能计入已验证覆盖。'), element('code', '', message)); stage.append(box); report('error', message); console.error(error);
}
function mountReference(id: string) {
  teardown(); referenceId = id;
  const reference = referenceCatalog.examples.find(item => item.id === id), main = $('#main'); main.replaceChildren();
  if (!reference) { main.append(element('div', 'empty', '目录中没有这个编号。')); report('missing-reference'); return; }
  main.append(breadcrumb(reference.category, '图表场景'));
  const heading = element('div', 'heading-row'); heading.append(element('h1', 'headline', reference.title.replace(/^JavaScript /, '')), element('span', 'status-pill pending', '演示场景')); main.append(heading, element('p', 'subhead', reference.summary));
  const detail = element('section', 'reference-detail'); detail.append(element('div', 'reference-id', reference.id), element('h2', 'panel-heading', 'CRYChart 图表场景'), element('p', 'panel-text', '每个场景展示独立的图表、数据与交互。演示运行不代表任意负载下的性能保证。'));
  const checks = element('div', 'check-grid'); ['功能与数据', '交互与联动', '显示与布局', '性能与资源'].forEach(name => { const item = element('div', 'check-item', name); item.append(element('span', '', '独立验证')); checks.append(item); }); detail.append(checks);
  const actions = element('div', 'reference-actions');
  const candidate = (reference as any).officialCandidate;
  if (candidate) {const link = element('a', 'button primary', '运行此图表场景'); link.href = `/${candidate.path}`; actions.append(link);}
  const related = recipes.filter(recipe => recipe.references.some(value => `crychart-example-${value}` === id));
  related.forEach(recipe => { const link = element('a', 'button primary', `相关演示：${recipe.title}`); link.href = `#demo=${recipe.id}`; actions.append(link); }); detail.append(actions); main.append(detail);
  const notes = infoPanel('使用范围'); notes.style.marginTop = '22px'; notes.append(element('p', 'panel-text', '目录按图表功能组织。实际业务接入、长时运行和资源容量需要使用目标数据验证。')); main.append(notes);
  report('reference'); renderList();
}
function navigate() {
  const hash = new URLSearchParams(location.hash.slice(1)), reference = hash.get('reference'), demo = hash.get('demo');
  if (reference) { if (mode !== 'references') switchMode('references'); mountReference(reference); }
  else { if (mode !== 'recipes') switchMode('recipes'); const recipe = recipes.find(item => item.id === demo) ?? recipes.find(item => item.id === selected) ?? recipes[0]; mountRecipe(recipe); }
}
$('#recipe-total').textContent = `${recipes.length} 个原创演示`;
$('#recipes-tab').onclick = () => { switchMode('recipes'); location.hash = `demo=${selected}`; if (mode === 'recipes') navigate(); };
$('#references-tab').onclick = () => { switchMode('references'); location.hash = `reference=${referenceId || referenceCatalog.examples[0].id}`; };
$<HTMLInputElement>('#search').oninput = event => { query = (event.target as HTMLInputElement).value; renderList(); };
$<HTMLSelectElement>('#category').onchange = event => { category = (event.target as HTMLSelectElement).value; renderList(); };
$('#theme-button').onclick = () => { parameters.theme = parameters.theme === 'dark' ? 'light' : 'dark'; document.body.classList.toggle('light', parameters.theme === 'light'); $('#theme-button').textContent = parameters.theme === 'dark' ? '浅色' : '深色'; navigate(); };
$('#menu-button').onclick = () => { const collapsed = $('#sidebar').classList.toggle('collapsed'); $('#menu-button').setAttribute('aria-expanded', String(!collapsed)); };
window.addEventListener('hashchange', navigate); window.addEventListener('beforeunload', teardown);
document.addEventListener('visibilitychange', () => { previous = 0; });
updateTabs(); navigate();
