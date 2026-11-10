import assert from 'node:assert/strict';

export const REQUIRED_GROUPS=Object.freeze(['channels','monitoring-short','monitoring-soak','resources','storage']);
export const RESOURCE_CASES=Object.freeze(['capacity-f64-128-60-12','capacity-f32-shared-128-60-120','memory-eight-cycles','paged-six-lifecycles']);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const median=values=>{const rows=[...values].sort((a,b)=>a-b),n=rows.length;return n?(rows[Math.floor((n-1)/2)]+rows[Math.ceil((n-1)/2)])/2:null;};

export function summarizeSamples(values){
  assert.ok(Array.isArray(values),'需要原始样本数组');
  const rows=values.filter(finite).sort((a,b)=>a-b),n=rows.length;
  const at=p=>n?rows[Math.ceil(n*p)-1]:null;
  return {aggregation:'pooled-raw-samples',count:n,unavailableCount:values.length-n,min:rows[0]??null,p50:at(.5),p95:at(.95),p99:at(.99),max:rows.at(-1)??null};
}

export function summarizeRounds(rounds,metric){
  assert.ok(Array.isArray(rounds),'需要逐轮原始帧');
  const values=rounds.map(round=>Array.isArray(round)?round:round.frames);
  assert.ok(values.every(Array.isArray),'不得将每轮P95冒充原始帧');
  const extracted=values.map(rows=>rows.map(row=>metric?row?.[metric]:row));
  const perRound=extracted.map(summarizeSamples);
  const complete=perRound.length>0&&perRound.every(row=>row.count>0);
  return {pooledFrames:summarizeSamples(extracted.flat()),perRound,
    medianOfRoundQuantiles:{aggregation:'median-of-round-quantiles',roundCount:rounds.length,status:complete?'available':'unavailable',
      ...Object.fromEntries(['p50','p95','p99'].map(key=>[key,complete?median(perRound.map(row=>row[key])):null]))}};
}

/** Same statistic only. A historical ratio never grants performance acceptance. */
export function historicalRatios(current,baseline,{protocolMatches=false,profile='full',aggregation,unit}={}){
  const eligible=profile==='full'&&protocolMatches===true&&aggregation===baseline?.aggregation&&unit===baseline?.unit;
  const result={status:eligible?'available':'not-comparable',performanceAcceptance:'unconfigured',currentPairedComparison:false,ratios:{},reason:eligible?null:'负载、单位、统计口径或完整模式未匹配'};
  for(const side of ['candidate','reference']){
    result.ratios[side]={};
    for(const percentile of ['p50','p95','p99']){
      const value=current?.[percentile],historical=baseline?.[side]?.[percentile];
      result.ratios[side][percentile]=eligible&&finite(value)&&finite(historical)&&historical>0?value/historical:null;
    }
  }
  if(eligible&&!Object.values(result.ratios).some(side=>Object.values(side).some(finite)))result.status='unavailable';
  return result;
}

/** limits: { 'B64.workMs.p95': {max:20,unit:'ms'} }; measurements use {value,unit}. */
export function evaluateLimits(metrics,limits){
  if(limits==null)return {status:'unconfigured',checks:[],exitCode:0};
  assert.ok(!Array.isArray(limits)&&typeof limits==='object','limits必须为指标名到上下限的对象');
  if(Object.keys(limits).length===0)return {status:'unconfigured',checks:[],exitCode:0};
  const checks=Object.entries(limits).map(([metric,limit])=>{
    assert.ok(limit&&typeof limit==='object'&&(finite(limit.max)||finite(limit.min)),`无效性能上下限：${metric}`);
    assert.ok((limit.max===undefined||finite(limit.max))&&(limit.min===undefined||finite(limit.min)),'上下限必须为有限数值');
    assert.ok(typeof limit.unit==='string'&&limit.unit.length>0,'限值必须声明单位');
    assert.ok(limit.min===undefined||limit.max===undefined||limit.min<=limit.max,'上下限顺序无效');
    const observed=metrics?.[metric],value=observed?.value;
    if(!finite(value)||observed.unit!==limit.unit)return {metric,status:'unavailable',value:finite(value)?value:null,unit:observed?.unit??null,limit};
    return {metric,value,unit:observed.unit,limit,status:(limit.max!==undefined&&value>limit.max)||(limit.min!==undefined&&value<limit.min)?'failed':'passed'};
  });
  const status=checks.some(c=>c.status==='failed')?'failed':checks.some(c=>c.status==='unavailable')?'unavailable':'passed';
  return {status,checks,exitCode:status==='passed'?0:1};
}

export function evaluateCompleteness({profile,groups}){
  assert.ok(['full','quick'].includes(profile),'未知性能协议模式');
  assert.ok(Array.isArray(groups),'groups必须为数组');
  const issues=[],map=new Map();
  for(const group of groups){
    if(!REQUIRED_GROUPS.includes(group.id)||map.has(group.id))issues.push({group:group.id,reason:'未知或重复测试组'});
    map.set(group.id,group);
    if(group.status!=='passed')issues.push({group:group.id,reason:'测试组未通过'});
    if(group.profile!==profile)issues.push({group:group.id,reason:'测试组模式不匹配'});
    if(!group.report||(group.report.status!==undefined&&group.report.status!=='passed'))issues.push({group:group.id,reason:'原始报告缺失或未通过'});
  }
  for(const id of REQUIRED_GROUPS)if(!map.has(id))issues.push({group:id,reason:'缺少完整组'});
  if(profile==='quick')issues.push({reason:'quick仅验证短流程，不是完整性能协议'});
  if(profile==='full'){
    const channels=map.get('channels')?.report;
    for(const id of ['B64','B128']){
      const scenario=channels?.scenarios?.find(row=>row.id===id);
      if(!scenario||scenario.status!=='passed'||scenario.rounds?.length!==3||scenario.rounds.some(round=>round.status!=='passed'||round.frames?.length!==128))issues.push({group:'channels',case:id,reason:'必须有三轮各128个完整测量帧'});
    }
    for(const axis of ['ordinary','highPrecision'])for(const mode of ['short','soak']){
      const report=map.get('monitoring-'+mode)?.report;
      const seeds=mode==='short'?[28,60]:[0];
      for(const seed of seeds){
        const run=report?.runs?.find(row=>row.configuration?.id===axis&&row.configuration.seedSamples===seed*48000);
        if(!run||!run.completedAt||!run.checkpoints?.length||run.checkpoints.some(point=>!finite(point.windowDurationMs)||point.windowDurationMs<6000))issues.push({group:'monitoring-'+mode,case:axis+'-'+seed,reason:'缺少已完成配置与完整六秒测量窗口'});
        else if(mode==='soak'&&(!finite(run.fullDurationMs)||run.fullDurationMs<600000||![60000,300000,600000].every(t=>run.checkpoints.some(point=>point.requestedCheckpointMs===t))))issues.push({group:'monitoring-soak',case:axis,reason:'必须真实运行十分钟并记录1/5/10分钟检查点'});
      }
    }
    const resources=map.get('resources')?.report;
    for(const id of RESOURCE_CASES)if(!resources?.cases?.some(row=>row.id===id&&row.status==='passed'))issues.push({group:'resources',case:id,reason:'缺少已通过资源子场景'});
  }
  const failed=groups.some(group=>group.status==='failed');
  return {status:failed?'failed':issues.length?'partial':'passed',profile,fullCoverage:!issues.length&&profile==='full',requiredGroups:[...REQUIRED_GROUPS],observedGroups:groups.map(group=>group.id),issues,exitCode:issues.length||failed?1:0};
}

export function evaluatePerformance({profile,groups,metrics={},limits}){
  const completeness=evaluateCompleteness({profile,groups}),acceptance=evaluateLimits(metrics,limits);
  const performanceAcceptance=acceptance.status==='passed'&&completeness.status!=='passed'?'unverified':acceptance.status;
  return {status:completeness.status==='failed'||acceptance.status==='failed'?'failed':completeness.status!=='passed'||acceptance.status==='unavailable'?'partial':'passed',
    executionStatus:groups.every(group=>group.status==='passed')?'passed':'failed',protocolCompleteness:completeness,
    performanceAcceptance,limits:acceptance,exitCode:Math.max(completeness.exitCode,acceptance.exitCode),
    qualification:'执行及协议通过不等于性能达标；没有显式限值时性能验收保持unconfigured，历史比值只报告。'};
}
