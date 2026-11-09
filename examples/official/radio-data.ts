/** Original bounded RF fixtures and application-level detection/projection.
 * Values are not captured transmissions and are not a radio safety detector. */
export function radioSpectrum(frame:number,bins=512):Float32Array {
  const out=new Float32Array(bins);
  for(let i=0;i<bins;i++){
    const f=i/bins,noise=-103+3*Math.sin(i*2.17+frame*.31)+2*Math.cos(i*.73-frame*.19);
    const carrier=48*Math.exp(-(((f-.18)/.005)**2));
    const wifi=frame%80<65?38*Math.exp(-(((f-.43)/.055)**8)):0;
    const allocation=29*Math.exp(-(((f-.76)/.038)**8));
    const hopping=frame%4<2?39*Math.exp(-(((f-((Math.floor(frame/4)*.137)% .85+.06))/.0035)**2)):0;
    const unknown=frame%90>65?43*Math.exp(-(((f-.91)/.014)**2)):0;
    out[i]=noise+Math.max(carrier,wifi,allocation,hopping,unknown);
  }
  return out;
}
export interface DetectedRange {startBin:number;endBin:number;peak:number;frames:number}
export function spectrumRanges(rows:readonly ArrayLike<number>[],margin=12,smoothRadius=2){
  const bins=rows[0]?.length??0;
  if(rows.some(row=>row.length!==bins))throw new RangeError('Spectrum row lengths differ');
  const average=new Float64Array(bins),smooth=new Float64Array(bins);average.fill(NaN);smooth.fill(NaN);
  for(let i=0;i<bins;i++){let total=0,count=0;for(const row of rows)if(Number.isFinite(row[i])){total+=row[i];count++;}if(count)average[i]=total/count;}
  for(let i=0;i<bins;i++){let total=0,count=0;for(let j=Math.max(0,i-smoothRadius);j<=Math.min(bins-1,i+smoothRadius);j++)if(Number.isFinite(average[j])){total+=average[j];count++;}if(count)smooth[i]=total/count;}
  const sorted=Array.from(smooth).filter(Number.isFinite).sort((a,b)=>a-b),noise=sorted[Math.floor((sorted.length-1)*.2)]??NaN,threshold=noise+margin;
  const ranges:DetectedRange[]=[];let start=-1,peak=-Infinity;
  for(let i=0;i<=bins;i++){if(i<bins&&Number.isFinite(smooth[i])&&smooth[i]>threshold){if(start<0)start=i;peak=Math.max(peak,smooth[i]);}else if(start>=0){if(i-start>=2)ranges.push({startBin:start,endBin:i,peak,frames:1});start=-1;peak=-Infinity;}}
  return{average,smooth,noise,threshold,ranges};
}
export class RadioDetector {
  private rows:Float32Array[]=[];private tracks:DetectedRange[]=[];
  constructor(readonly window=8,readonly persistence=3){}
  push(row:ArrayLike<number>){this.rows.push(Float32Array.from(row));if(this.rows.length>this.window)this.rows.shift();const analysis=spectrumRanges(this.rows);
    this.tracks=analysis.ranges.map(range=>{const previous=this.tracks.find(old=>Math.min(old.endBin,range.endBin)>Math.max(old.startBin,range.startBin));return{...range,frames:(previous?.frames??0)+1};});
    return{...analysis,ranges:this.tracks.filter(range=>range.frames>=this.persistence).map(range=>({...range})),retainedRows:this.rows.length};
  }
  clear(){this.rows=[];this.tracks=[];}
}

/** Every source cell intersecting a display cell participates. NaN never
 * becomes zero; an entirely missing footprint stays missing. Source is read only. */
export function maxHeatmapProjection(data:Float32Array,columns:number,rows:number,view:{x0:number;x1:number;y0:number;y1:number},width:number,height:number){
  if(data.length!==columns*rows||![columns,rows,width,height].every(v=>Number.isSafeInteger(v)&&v>0)||!Object.values(view).every(Number.isFinite)||view.x1<=view.x0||view.y1<=view.y0)throw new RangeError('Invalid heatmap projection geometry');
  const values=new Float32Array(width*height);values.fill(NaN);const bounds:Array<{x0:number;x1:number;y0:number;y1:number}>=[];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const x0=Math.max(0,Math.floor(view.x0+x/width*(view.x1-view.x0))),x1=Math.min(columns,Math.ceil(view.x0+(x+1)/width*(view.x1-view.x0))),y0=Math.max(0,Math.floor(view.y0+y/height*(view.y1-view.y0))),y1=Math.min(rows,Math.ceil(view.y0+(y+1)/height*(view.y1-view.y0)));
    let maximum=-Infinity,found=false;for(let j=y0;j<y1;j++)for(let i=x0;i<x1;i++){const value=data[j*columns+i];if(Number.isFinite(value)){maximum=Math.max(maximum,value);found=true;}}
    if(found)values[y*width+x]=maximum;if(width*height<=64)bounds.push({x0,x1,y0,y1});
  }
  return{values,width,height,bounds,view:{...view}};
}
export function aggregationColumn(index:number,bins=1024){const out=new Float32Array(bins);for(let i=0;i<bins;i++)out[i]=-95+4*Math.sin(index*.19+i*.7);out[(index*37+17)%bins]=-15;out[(index*53+501)%bins]=-28;return out;}

export interface SaleRecord {region:string;category:string;subcategory:string;month:number;revenue:number;profit:number;orders:number}
export function regionalSales():SaleRecord[]{const result:SaleRecord[]=[];['Americas','Europe','Asia'].forEach((region,r)=>['Technology','Home','Sports'].forEach((category,c)=>['Standard','Premium'].forEach((label,s)=>{for(let month=0;month<24;month++){const orders=60+((month*17+r*31+c*23+s*11)%110),price=80+c*65+s*120,revenue=orders*price,profit=Math.round(revenue*(.18+.03*c+.02*s));result.push({region,category,subcategory:`${category} ${label}`,month,revenue,profit,orders});}})));return result;}
export function summarizeSales(data:readonly SaleRecord[],path:readonly string[]=[]){const selected=data.filter(row=>[row.region,row.category,row.subcategory].every((part,i)=>path[i]===undefined||path[i]===part));const total={revenue:0,profit:0,orders:0,aov:0};const monthly=Array.from({length:24},()=>({revenue:0,profit:0})),categories=new Map<string,{revenue:number;profit:number}>(),subcategories=new Map<string,number>();
  for(const row of selected){total.revenue+=row.revenue;total.profit+=row.profit;total.orders+=row.orders;monthly[row.month].revenue+=row.revenue;monthly[row.month].profit+=row.profit;const category=categories.get(row.category)??{revenue:0,profit:0};category.revenue+=row.revenue;category.profit+=row.profit;categories.set(row.category,category);subcategories.set(row.subcategory,(subcategories.get(row.subcategory)??0)+row.revenue);}total.aov=total.orders?total.revenue/total.orders:0;
  return{count:selected.length,total,monthly,categories:[...categories].map(([name,value])=>({name,...value})),top:[...subcategories].map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value).slice(0,5)};
}
export function drillingSample(time:number){const critical=time%80>=50&&time%80<65;return{time,depth:3450+time*.009,east:Math.sin(time/70)*22,north:time*.19,rop:24+8*Math.sin(time*.08),wob:12+3*Math.cos(time*.06),torque:critical?36+2*Math.sin(time):19+5*Math.sin(time*.11),speed:130+18*Math.cos(time*.07),flowIn:2300+70*Math.sin(time*.09),flowOut:critical?2080:2280+60*Math.sin(time*.09),pressure:critical?4350:3280+160*Math.sin(time*.04),gamma:55+25*Math.sin(time*.03),vibration:critical?.85:.22+.08*Math.sin(time*.13)};}
export function drillingAlerts(sample:ReturnType<typeof drillingSample>){return[...(sample.torque>32?['HIGH TORQUE']:[]),...(sample.flowIn-sample.flowOut>150?['FLOW LOSS']:[]),...(sample.pressure>4000?['HIGH PRESSURE']:[])];}
