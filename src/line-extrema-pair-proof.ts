import type {DataSetXY,AffineColumnRun} from './core/data.js';
import {getColumnOrder,getColumnFinite} from './data-order.js';
import {readSourceCertificate,certifySourceDelta,type SourceCertificate} from './core/line-delta-certificate.js';
import type {LineBlockRequest} from './line-block-cache.js';
export interface ExtremaPairProof {readonly enabled:boolean;readonly reason:string;readonly identity:object;readonly revision:number;readonly epoch:number;readonly first:number;readonly next:number;}
interface UniformState {certificate:SourceCertificate;xKey:string;yKey:string;step:number;tail:AffineColumnRun;fullChecks:number;incrementalChecks:number;unchangedChecks:number;lastRunVisits:number;totalRunVisits:number;lastBinarySteps:number;}
const issued=new WeakSet<object>(),uniforms=new WeakMap<DataSetXY,UniformState>(),watched=new WeakSet<DataSetXY>();
const copyRun=(run:AffineColumnRun):AffineColumnRun=>({firstIndex:run.firstIndex,start:run.start,step:run.step,count:run.count});
function invalidateOnSourceChange(data:DataSetXY):void{const state=uniforms.get(data),certificate=readSourceCertificate(data);if(data.isDisposed()){uniforms.delete(data);watched.delete(data);return;}if(state&&(!certificate||certificate.tainted||certificate.producer!==state.certificate.producer||certificate.lineage!==state.certificate.lineage||certificate.epoch!==state.certificate.epoch))uniforms.delete(data);}
export function getExtremaPairProofWork(data:DataSetXY){const state=uniforms.get(data);return state?{fullChecks:state.fullChecks,incrementalChecks:state.incrementalChecks,unchangedChecks:state.unchangedChecks,lastRunVisits:state.lastRunVisits,totalRunVisits:state.totalRunVisits,lastBinarySteps:state.lastBinarySteps,ownedSourceArrays:0,sourceViewsRetained:false}:undefined;}
export function proveExtremaPair(data:DataSetXY,xKey:string,yKey:string):ExtremaPairProof {
  const next=data.getNextSampleIndex(),first=next-data.getSampleCount();
  const value={enabled:false,reason:'unproved',identity:data,revision:data.revision,epoch:data.getContentEpoch(),first,next};
  const certificate=readSourceCertificate(data,{revision:value.revision,epoch:value.epoch,first,next});
  let visits=0,binarySteps=0;
  const done=(reason:string,enabled=false,step?:number,tail?:AffineColumnRun,path:'full'|'incremental'|'unchanged'='full')=>{
    value.reason=reason;value.enabled=enabled;issued.add(value);
    if(enabled&&certificate&&step!==undefined&&tail){const old=uniforms.get(data);uniforms.set(data,{certificate,xKey,yKey,step,tail:copyRun(tail),fullChecks:(old?.fullChecks??0)+Number(path==='full'),incrementalChecks:(old?.incrementalChecks??0)+Number(path==='incremental'),unchangedChecks:(old?.unchangedChecks??0)+Number(path==='unchanged'),lastRunVisits:visits,totalRunVisits:(old?.totalRunVisits??0)+visits,lastBinarySteps:binarySteps});if(!watched.has(data)){watched.add(data);data.onChange(invalidateOnSourceChange);}}
    else uniforms.delete(data);
    return Object.freeze(value);
  };
  if(!certificate||certificate.tainted)return done('producer-unproved-or-tainted');
  const x=data.getColumnRuns(xKey),y=data.getColumnRuns(yKey);
  if(x.kind!=='affine'||y.kind!=='dense')return done('not-affine-x-and-dense-y');
  // X still needs complete ordering. Y only consumes complete finite evidence;
  // do not compute unused Y ordering or populate the ordinary order cache.
  if(!getColumnOrder(data,xKey).strict||!getColumnOrder(data,xKey).finite||!getColumnFinite(data,yKey).finite)return done('nonfinite-or-not-strict');
  const cached=uniforms.get(data);
  if(cached&&cached.xKey===xKey&&cached.yKey===yKey){
    const proven=certifySourceDelta(data,cached.certificate,{revision:value.revision,epoch:value.epoch,first,next}).delta;
    if(proven){
      if(proven.kind==='unchanged')return done('finite-uniform-dense',true,cached.step,cached.tail,'unchanged');
      let low=x.runStart,high=x.runs.length;
      while(low<high){binarySteps++;const middle=low+Math.floor((high-low)/2),run=x.runs[middle]!;if(run.firstIndex+run.count<=proven.previous.next)low=middle+1;else high=middle;}
      let previous=cached.tail,covered=proven.previous.next,valid=true;
      for(let index=low;index<x.runs.length;index++){
        const run=x.runs[index]!;if(run.firstIndex>=next)break;visits++;
        if(!(run.step>0)||!Number.isFinite(run.step)||!Number.isFinite(run.start)||!Object.is(cached.step,run.step)){valid=false;break;}
        if(run.firstIndex<covered){
          // A producer can extend its previous affine span. Reuse requires the
          // same original rounded expression, not a rebased equivalent formula.
          if(index!==low||run.firstIndex!==cached.tail.firstIndex||!Object.is(run.start,cached.tail.start)||run.count<cached.tail.count){valid=false;break;}
        }else if(run.firstIndex!==covered||run.firstIndex!==previous.firstIndex+previous.count||!Object.is(run.start,previous.start+(run.firstIndex-previous.firstIndex)*run.step)){valid=false;break;}
        covered=Math.max(covered,Math.min(next,run.firstIndex+run.count));previous=run;
      }
      if(valid&&covered===next)return done('finite-uniform-dense',true,cached.step,previous,'incremental');
    }
  }
  // The original complete proof is the fallback. Preserve its exact expression
  // order, Object.is boundaries, first/end clipping and rejection decisions.
  let previous:typeof x.runs[number]|undefined,step:number|undefined,covered=first;
  for(let index=x.runStart;index<x.runs.length;index++){
    const run=x.runs[index]!;visits++;if(run.firstIndex+run.count<=first)continue;if(run.firstIndex>=next)break;
    if(!(run.step>0)||!Number.isFinite(run.step)||!Number.isFinite(run.start)||step!==undefined&&!Object.is(step,run.step))return done('nonuniform-affine-step');
    if(run.firstIndex>covered||previous&&(!Object.is(run.start,previous.start+(run.firstIndex-previous.firstIndex)*run.step)||run.firstIndex!==previous.firstIndex+previous.count))return done('affine-gap-or-start-expression-change');
    covered=Math.max(covered,Math.min(next,run.firstIndex+run.count));previous=run;step=run.step;
  }
  return covered===next&&step!==undefined&&previous?done('finite-uniform-dense',true,step,previous):done('incomplete-affine-window');
}
export function acceptsExtremaPair(proof:ExtremaPairProof|undefined,source:LineBlockRequest['source']):boolean {
  return !!proof&&issued.has(proof)&&proof.enabled&&proof.identity===source.identity&&proof.revision===source.revision&&proof.epoch===source.contentEpoch&&proof.first===source.firstSampleIndex&&proof.next===source.nextSampleIndex&&source.x.kind==='affine'&&source.y.kind==='dense';
}
