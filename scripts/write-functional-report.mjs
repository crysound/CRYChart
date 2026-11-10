import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, dirname, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label = status => ({passed:'通过',failed:'失败',incomplete:'未完成',pending:'未执行'}[status] ?? status);

export function projectFunctionalReport(previous, report, reportPath) {
  assert.equal(report.kind, 'official-functional-visible');
  assert.ok(report.identity?.sessionId && /^[a-f0-9]{64}$/.test(report.identity.bundleSHA256), '报告必须绑定本轮会话与构建');
  const actual = new Map();
  for (const item of report.cases) {
    assert.ok(!actual.has(item.id), '报告中有重复场景：' + item.id);
    actual.set(item.id, item);
  }
  const known = new Set(previous.cases.map(item => item.id));
  for (const id of actual.keys()) assert.ok(known.has(id), '未知场景：' + id);
  const cases = previous.cases.map(old => {
    const item = actual.get(old.id);
    const passed = item?.status === 'passed' && item.functionalComplete === true;
    return {id:old.id,title:old.title,requirements:item?.requirements ?? old.requirements,
      historicalStatus:old.historicalStatus,historicalFunctionalComplete:old.historicalFunctionalComplete,
      historicalDimensions:old.historicalDimensions,
      status:passed?'passed':item?.status==='failed'?'failed':item?'incomplete':'pending',
      functionalComplete:passed,dimensions:item?.dimensions,errors:item?.errors ?? [],
      remainingRequirements:item?.requirements?.filter(r=>r.required!==false && r.status!=='passed'),
      latestEvidence:reportPath};
  });
  const complete = cases.filter(c=>c.functionalComplete).length;
  const failed = cases.filter(c=>c.status==='failed').length;
  const errors = [...(report.errors ?? []), ...(report.legacyErrors ?? [])];
  const status = failed || errors.length ? 'failed' : complete===cases.length ? 'passed' : 'incomplete';
  return {schemaVersion:3,product:'CRYChart',generatedAt:report.finishedAt,status,
    catalogTotal:cases.length,functionallyComplete:complete,failed,incomplete:cases.length-complete-failed,
    currentSourceAcceptance:status,identity:report.identity,history:previous.history,
    casePolicy:'当前构建逐项检查功能要求、数据、真实操作和生命周期；历史结果不计入本轮通过数。',
    openTestApplicationExecuted:false,openTestModified:false,sourceReport:reportPath,errors,cases};
}

export async function writeFunctionalReport(report, {reportPath}) {
  const currentHash = createHash('sha256').update(await readFile(resolve(root,'dist/official.js'))).digest('hex');
  assert.equal(report.identity.bundleSHA256,currentHash,'报告构建已过期，不能更新当前验收结果');
  const path = resolve(root,'docs/functional-verification.json');
  const previous = JSON.parse(await readFile(path,'utf8'));
  const evidencePath = relative(root,resolve(reportPath)).replaceAll('\\','/');
  const result = projectFunctionalReport(previous,report,evidencePath);
  await writeFile(path,JSON.stringify(result,null,2)+'\n');
  const summary = `本轮检查 ${result.catalogTotal} 个功能场景：${result.functionallyComplete} 项通过，${result.failed} 项失败，${result.incomplete} 项未完成。`;
  await writeFile(resolve(root,'docs/functional-verification.md'),`# CRYChart 功能场景检查\n\n${summary}\n\n运行时间：${result.generatedAt}。当前状态：${label(result.status)}。\n\n构建指纹：\`${result.identity.bundleSHA256}\`。\n\n执行 \`npm run build\` 后运行 \`npm run test:functional\`，或使用 \`npm run verify\` 执行整套本库验证。缺项或失败返回非零退出码。\n\n[逐项清单](functional-verification.json) · [HTML 场景表](CRYChart-functional-report.html) · [本轮原始证据](../${evidencePath})\n\n历史结果保存在 JSON 的 history 字段，不计入当前通过数。本轮不运行 OpenTest 应用，也不据此宣称参考库完全等价或性能验收通过。\n`);
  const rows = result.cases.map(c=>`<tr><td><code>${escape(c.id)}</code></td><td>${escape(c.title)}</td><td>${label(c.status)}</td><td>${(c.remainingRequirements??[]).map(r=>escape(r.description??r.title??r.id??JSON.stringify(r))).join('<br>')}</td></tr>`).join('');
  await writeFile(resolve(root,'docs/CRYChart-functional-report.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CRYChart 功能场景检查</title><style>body{font:15px/1.6 system-ui;margin:32px;color:#18243c;background:#f5f7fb}table{border-collapse:collapse;background:white;width:100%}td,th{padding:10px;text-align:left;border:1px solid #d5deeb}input{padding:10px;width:320px;max-width:90%}code{font-size:12px}</style><h1>CRYChart 功能场景检查</h1><p>${summary}</p><p>运行时间：${escape(result.generatedAt)}；状态：${label(result.status)}。</p><p>本轮构建：<code>${escape(result.identity.bundleSHA256)}</code></p><p>历史通过数不计入本轮结果。未执行 OpenTest 应用；功能检查不等于参考库完全等价或性能验收。</p><p><a href="functional-verification.json">逐项 JSON</a> · <a href="../${escape(evidencePath)}">原始证据</a></p><input id="query" placeholder="搜索编号、名称或状态" aria-label="搜索场景"><p id="count">共 ${result.catalogTotal} 项</p><table><thead><tr><th>场景</th><th>原始名称</th><th>当前状态</th><th>未通过的要求</th></tr></thead><tbody>${rows}</tbody></table><script>const rows=[...document.querySelectorAll('tbody tr')];document.querySelector('#query').addEventListener('input',e=>{let n=0;for(const r of rows){r.hidden=!r.textContent.toLowerCase().includes(e.target.value.toLowerCase());if(!r.hidden)n++}document.querySelector('#count').textContent='显示 '+n+' / '+rows.length+' 项'})</script></html>\n`);
  return result;
}
