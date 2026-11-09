import type {Interval} from './contracts.js';

export type HeatmapCleaning={minDataPointCount:number|undefined}|{maxDataPointCount:number|undefined}|undefined;
export interface HeatmapStreamUpdate {changed:boolean;full:boolean;firstPhysical:number;physicalCount:number;}

/** A scrolling grid stores columns/rows by absolute sample index. Missing future
 * samples repeat the previous vector; callers can insert NaN to create gaps.
 * Retention and allocation are independent: a minimum is never a hard limit.
 */
export class HeatmapStream {
  data:Float32Array;
  capacity:number;
  first=0;
  next=0;
  private hardLimit:number|undefined;
  private minimum:number|undefined;
  private cleaning:HeatmapCleaning;
  constructor(readonly resolution:number,readonly dimension:'columns'|'rows',fixedCapacity?:number){
    if(!Number.isSafeInteger(resolution)||resolution<1||fixedCapacity!==undefined&&(!Number.isSafeInteger(fixedCapacity)||fixedCapacity<1))throw new RangeError('Heatmap dimensions must be positive integers');
    this.capacity=fixedCapacity??32;this.hardLimit=fixedCapacity;
    this.data=new Float32Array(this.capacity*resolution);this.data.fill(NaN);
  }
  get columns(){return this.dimension==='columns'?this.capacity:this.resolution;}
  get rows(){return this.dimension==='rows'?this.capacity:this.resolution;}
  get offset(){return this.first%this.capacity;}
  private address(absolute:number,cell:number,capacity=this.capacity){const slot=absolute%capacity;return this.dimension==='columns'?cell*capacity+slot:slot*this.resolution+cell;}
  getValue(absolute:number,cell:number){return absolute>=this.first&&absolute<this.next&&cell>=0&&cell<this.resolution?this.data[this.address(absolute,cell)]:undefined;}
  getCleaning():HeatmapCleaning{return this.cleaning?{...this.cleaning}:undefined;}
  configure(value:HeatmapCleaning,interval:Interval,start:number,step:number):HeatmapStreamUpdate{
    const maximum=value&&'maxDataPointCount'in value?value.maxDataPointCount:undefined;
    const minimum=value&&'minDataPointCount'in value?value.minDataPointCount:undefined;
    for(const n of [maximum,minimum])if(n!==undefined&&(!Number.isFinite(n)||n<1||!Number.isSafeInteger(Math.ceil(n))))throw new RangeError('Heatmap cleaning count must be a positive finite number');
    this.hardLimit=maximum===undefined?undefined:Math.ceil(maximum);this.minimum=minimum===undefined?undefined:Math.ceil(minimum);this.cleaning=value?{...value}:undefined;
    return this.write(this.next,[],interval,start,step);
  }
  write(index:number,vectors:readonly ArrayLike<number>[],interval:Interval,start:number,step:number):HeatmapStreamUpdate{
    if(!Number.isSafeInteger(index)||index<0||!Number.isSafeInteger(index+vectors.length))throw new RangeError('Heatmap sample index must be a safe nonnegative integer');
    if(!Array.isArray(vectors)||vectors.some(row=>!row||!Number.isSafeInteger(row.length)||row.length!==this.resolution))throw new RangeError('Each scrolling heatmap sample must match its resolution');
    const end=vectors.length?Math.max(this.next,index+vectors.length):this.next;
    let first=this.first;
    if(this.hardLimit!==undefined)first=Math.max(first,end-this.hardLimit);
    if(this.minimum!==undefined&&step!==0&&Number.isFinite(step)){
      const visibleFirst=Math.floor(Math.min((interval.start-start)/step,(interval.end-start)/step));
      if(Number.isFinite(visibleFirst))first=Math.max(first,Math.min(end-this.minimum,visibleFirst));
    }
    first=Math.max(0,Math.min(end,first));
    const retained=end-first;
    let capacity=this.capacity;
    if(retained>capacity)capacity=Math.max(retained,capacity*2);
    if(this.hardLimit!==undefined)capacity=Math.min(capacity,this.hardLimit);
    if(this.minimum!==undefined&&capacity>Math.max(64,retained*4))capacity=Math.max(32,2**Math.ceil(Math.log2(Math.max(1,retained))));
    capacity=Math.max(1,capacity);
    const hasFuture=end>this.next,previous=hasFuture&&index>this.next&&this.next>this.first?Float32Array.from({length:this.resolution},(_,cell)=>this.data[this.address(this.next-1,cell)]!):undefined;
    const resized=capacity!==this.capacity;
    if(resized){
      // Allocate and copy before publishing the replacement buffer.
      const replacement=new Float32Array(capacity*this.resolution);replacement.fill(NaN);
      for(let sample=Math.max(first,this.first);sample<this.next;sample++)for(let cell=0;cell<this.resolution;cell++)replacement[this.address(sample,cell,capacity)]=this.data[this.address(sample,cell)]!;
      this.data=replacement;this.capacity=capacity;
    }
    let physicalMin=Infinity,physicalMax=-Infinity,touched=0,wrapped=false;
    const touch=(sample:number)=>{const slot=sample%this.capacity;physicalMin=Math.min(physicalMin,slot);physicalMax=Math.max(physicalMax,slot);touched++;};
    if(!resized&&first>this.first){
      for(let sample=this.first;sample<Math.min(first,this.next);sample++){for(let cell=0;cell<this.resolution;cell++)this.data[this.address(sample,cell)]=NaN;touch(sample);if(touched>=this.capacity)break;}
    }
    const writeStart=Math.max(first,Math.min(index,this.next)),writeEnd=vectors.length?index+vectors.length:this.next;
    if(writeEnd>writeStart){
      wrapped=Math.floor(writeStart/this.capacity)!==Math.floor((writeEnd-1)/this.capacity);
      for(let sample=writeStart;sample<writeEnd;sample++){
        const vector=sample<index?previous:vectors[sample-index];
        for(let cell=0;cell<this.resolution;cell++)this.data[this.address(sample,cell)]=vector?.[cell]??NaN;
        touch(sample);
      }
    }
    const changed=resized||first!==this.first||end!==this.next||touched>0;
    this.first=first;this.next=end;
    return{changed,full:resized||wrapped||touched>=this.capacity,firstPhysical:Number.isFinite(physicalMin)?physicalMin:0,physicalCount:Number.isFinite(physicalMax)?physicalMax-physicalMin+1:0};
  }
  clear(){this.data.fill(NaN);this.first=0;this.next=0;}
  dispose(){this.data=new Float32Array(0);this.first=0;this.next=0;}
}
