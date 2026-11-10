import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {collectPerformanceMetrics,collectPerformanceComparisons,loadResourceMeasurements,writeSummary} from '../run-performance.mjs';
import {evaluatePerformance} from './protocol.mjs';
import {distribution} from './monitoring.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Publish derived summaries without changing original measurements or timing scripts. */
export async function publishPerformanceReport(reportPath){
  const measuredPath=resolve(reportPath),run=dirname(measuredPath),bytes=await readFile(measuredPath),report=JSON.parse(bytes);
  assert.equal(report.status,'passed','仅发布已完整执行的测量报告');
  const baselineBytes=await readFile(resolve(run,'baselines.json'));
  assert.equal(hash(baselineBytes),report.baselineSHA256,'基准快照已变化');
  for(const [path,digest]of Object.entries(report.sourceHashes))assert.equal(hash(await readFile(resolve(run,'frozen-sources',path))),digest,'冻结执行源码已变化：'+path);
  await loadResourceMeasurements(report.groups,report.sessionId,report.bundleSHA256);
  for(const group of report.groups.filter(g=>g.id.startsWith('monitoring-'))){
    const base=resolve(run,group.id);
    for(const item of group.report.runs){
      const prefix=`${item.configuration.id}-${item.configuration.seedSamples/48000}s`;
      const appendQuantiles=(summary,raw)=>{for(const [name,rows]of Object.entries(raw.metrics)){
        const actual=distribution(rows.map(row=>row.value));
        assert.equal(actual.p95,summary[name].p95,'原始分布与既有摘要不符');
        summary[name].p99=actual.p99;
      }};
      const raw=JSON.parse(await readFile(resolve(base,prefix+'-complete.json'),'utf8'));
      appendQuantiles(item.fullRunSummary,raw);
      for(const point of item.checkpoints){const window=JSON.parse(await readFile(resolve(base,`${prefix}-${point.requestedCheckpointMs}ms-window.json`),'utf8'));appendQuantiles(point.summary,window.raw);}
    }
  }
  for(const group of report.groups){
    if(group.id==='channels')for(const scenario of group.report.scenarios)scenario.comparability.historicalProtocolEligible=scenario.historicalComparison.eligible;
    group.reportPath='../'+group.reportPath;
  }
  report.metrics=collectPerformanceMetrics(report.groups);report.comparison=collectPerformanceComparisons(report.groups);
  report.evaluation=evaluatePerformance({profile:report.profile,groups:report.groups,metrics:report.metrics});
  assert.equal(report.evaluation.status,'passed');
  report.publication={at:new Date().toISOString(),measurementReport:'../report.json',measurementReportSHA256:hash(bytes),frozenSources:'../source-snapshot.json',method:'仅补充汇总与从原始样本计算P99；原始计时、样本和执行源码保持原样。',publisherSHA256:hash(await readFile(fileURLToPath(import.meta.url)))};
  const output=resolve(run,'publication');await mkdir(output,{recursive:true});await copyFile(resolve(run,'baselines.json'),resolve(output,'baselines.json'));
  await writeSummary(output,report,JSON.parse(baselineBytes));
  await writeFile(resolve(output,'publication.json'),JSON.stringify(report.publication,null,2)+'\n');
  return{status:report.status,reportPath:resolve(output,'report.html'),metrics:Object.keys(report.metrics).length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await publishPerformanceReport(process.argv[2])));
