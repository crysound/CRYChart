import type {RenderHost} from './contracts.js';
import {HeatmapSeries} from './series.js';
import {samplePolarHeatmapIntensity} from './render-heatmap.js';
import {polarInverseNormalized} from './polar-layout.js';
import type {PolarSolveMode, PolarSolveResult} from './polar-series.js';

export interface PolarHeatmapOptions {
  sectors:number;annuli:number;amplitudeStart?:number;amplitudeEnd?:number;amplitudeStep?:number;dataOrder?:'annuli'|'sectors';
}
export interface PolarHeatmapSolveResult {
  angle:number;amplitude:number;sector:number;annulus:number;intensity:number;lut:any;
  series:PolarHeatmapSeries;index:number;distanceSquared:number;cursorPosition:PolarSolveResult['cursorPosition'];
}

/** Polar intensities reuse the row-major grid store; only the projection is different. */
export class PolarHeatmapSeries extends HeatmapSeries {
  readonly polar=true;
  readonly sectors:number;
  readonly annuli:number;
  readonly polarDataOrder:'annuli'|'sectors';
  private readonly nodeAmplitudeStep:number;
  private cursorInterpolation=false;
  private cursorFormatter?: (...args:any[])=>any;
  constructor(chart:RenderHost,options:PolarHeatmapOptions){
    const {sectors,annuli}=options;
    if(!Number.isSafeInteger(sectors)||!Number.isSafeInteger(annuli)||sectors<1||annuli<1)throw new RangeError('Polar heatmap dimensions must be positive integers');
    const start=options.amplitudeStart??0,step=options.amplitudeEnd!==undefined?(options.amplitudeEnd-start)/annuli:options.amplitudeStep??0;
    if(!Number.isFinite(start)||!Number.isFinite(step))throw new RangeError('Polar heatmap amplitude coordinates must be finite');
    // This subclass normalizes both public orientations to row-major patches.
    // The base grid must not transpose those patches a second time.
    super(chart,{columns:sectors,rows:annuli,start:{x:0,y:start},step:{x:360/sectors,y:step},dataOrder:'rows'});
    this.sectors=sectors;this.annuli=annuli;this.polarDataOrder=options.dataOrder??'annuli';
    this.nodeAmplitudeStep=options.amplitudeEnd!==undefined?(annuli>1?(options.amplitudeEnd-start)/(annuli-1):0):options.amplitudeStep??0;
  }
  override invalidateIntensityValues(input:any){
    if(ArrayBuffer.isView(input))return super.invalidateIntensityValues(input);
    const patch=input&&!Array.isArray(input)&&Object.prototype.hasOwnProperty.call(input,'values');
    const values=patch?input.values:input,firstSector=patch?(input.iSector??0):0,firstAnnulus=patch?(input.iAnnulus??0):0;
    if(!Array.isArray(values)||![firstSector,firstAnnulus].every(v=>Number.isSafeInteger(v)&&v>=0))throw new TypeError('Polar heatmap update requires a matrix and nonnegative integer indices');
    const outer=values.length,inner=outer?values[0].length:0;
    if(!values.every((row:any)=>row!=null&&row.length===inner))throw new RangeError('Polar heatmap rows must have equal lengths');
    const width=this.polarDataOrder==='sectors'?outer:inner,height=this.polarDataOrder==='sectors'?inner:outer;
    if(firstSector+width>this.sectors||firstAnnulus+height>this.annuli)throw new RangeError('Polar heatmap update exceeds its dimensions');
    const rows=this.polarDataOrder==='sectors'?Array.from({length:height},(_,row)=>Array.from({length:width},(_,col)=>values[col][row])):values;
    return super.invalidateIntensityValues({iColumn:firstSector,iRow:firstAnnulus,values:rows});
  }
  getIntensityAt(angle:number,amplitude:number){
    if(!Number.isFinite(angle)||!Number.isFinite(amplitude)||this.step.y===0)return NaN;
    const sector=Math.floor(((angle%360)+360)%360/360*this.sectors),annulus=Math.floor((amplitude-this.start.y)/this.step.y);
    return annulus>=0&&annulus<this.annuli?this.data[annulus*this.sectors+sector]!:NaN;
  }
  getFillStyle(){return this.palette;}
  // Polar node data retains its empty-value semantics independently of the
  // rectangular fixed-grid clear contract.
  protected override getClearIntensityValue(){return NaN;}
  /** Retained amplitude nodes; the last node terminates the rendered ring strip. */
  getRadialNodeRange(){return{start:this.start.y,end:this.start.y+(this.annuli-1)*this.nodeAmplitudeStep};}
  getAmplitudeMin(){const range=this.getRadialNodeRange();return Math.min(range.start,range.end);}
  getAmplitudeMax(){const range=this.getRadialNodeRange();return Math.max(range.start,range.end);}
  /** @internal Canvas fallback uses the same original scalar interpolation as the GPU. */
  sampleRenderedIntensity(angle:number,amplitude:number){
    const range=this.getRadialNodeRange();return samplePolarHeatmapIntensity(this.data,this.sectors,this.annuli,angle/360*this.sectors,this.axisY.valueToFraction(amplitude),this.axisY.valueToFraction(range.start),this.axisY.valueToFraction(range.end),this.getIntensityInterpolation());
  }
  setCursorEnabled(value:boolean){this.cursorEnabled=value;return this;}
  getCursorEnabled(){return this.cursorEnabled;}
  setCursorInterpolationEnabled(value:boolean){this.cursorInterpolation=value;return this;}
  getCursorInterpolationEnabled(){return this.cursorInterpolation;}
  setCursorResultTableFormatter(value:(...args:any[])=>any){this.cursorFormatter=value;return this;}
  getCursorResultTableFormatter(){return this.cursorFormatter;}
  override solveNearest(from:{clientX:number;clientY:number},mode:PolarSolveMode='show-nearest'):any {
    if(!['show-nearest','show-all','show-pointed'].includes(mode))throw new RangeError('Interpolated polar heatmap hit testing is not implemented');
    if(this.disposed||!this.visible||!this.cursorEnabled||!this.nodeAmplitudeStep&&this.annuli>1)return undefined;
    const chart=this.chart as any,point=chart.translateCoordinate(from,chart.coordsAxis);
    if(!Number.isFinite(point.angle)||!Number.isFinite(point.amplitude))return undefined;
    const wrapped=((point.angle%360)+360)%360,sector=Math.round(wrapped/this.step.x)%this.sectors;
    // Unlike a rectangular cell's containing index, the public Polar cursor
    // resolves the nearest retained sample node. Out-of-range radial queries
    // clamp to the nearest end, rather than wrapping to the opposite ring.
    const annulus=this.annuli===1?0:Math.max(0,Math.min(this.annuli-1,Math.round((point.amplitude-this.start.y)/this.nodeAmplitudeStep)));
    const angle=sector*this.step.x,amplitude=this.start.y+annulus*this.nodeAmplitudeStep,index=annulus*this.sectors+sector;
    const target=chart.translateCoordinate({angle,amplitude},chart.coordsClient),distanceSquared=(target.clientX-from.clientX)**2+(target.clientY-from.clientY)**2;
    return{angle,amplitude,sector,annulus,intensity:this.data[index],lut:this.palette?.getLUT?.()??this.palette?.lut,series:this,index,distanceSquared,cursorPosition:chart.getPolarCursorPosition({angle,amplitude},this.axisY)} satisfies PolarHeatmapSolveResult;
  }
  solveNearestFromScreen(location:{clientX:number;clientY:number}):{series:PolarHeatmapSeries;angleDeg:number;amplitude:number;intensity:number;iSector:number;iAnnulus:number}|undefined{
    const chart=this.chart as any,canvas=chart.overlay;if(!canvas||!this.cursorEnabled||!this.visible||this.disposed||this.step.y===0)return undefined;
    const rect=canvas.getBoundingClientRect(),layout=chart.getPolarLayout();if(!(layout.dataRadius>0))return undefined;
    const inverse=polarInverseNormalized(layout,{x:location.clientX-rect.left,y:location.clientY-rect.top}),fraction=inverse.fraction;
    if(fraction>1)return undefined;
    const angle=(((inverse.angleRadians*180/Math.PI-chart.getAngleOrigin())*(chart.getClockwise()?-1:1))%360+360)%360,amplitude=this.axisY.fractionToValue(fraction),range=this.getRadialNodeRange(),row=this.nodeAmplitudeStep?(amplitude-range.start)/this.nodeAmplitudeStep:0,column=angle/360*this.sectors;
    const intensity=samplePolarHeatmapIntensity(this.data,this.sectors,this.annuli,column,fraction,this.axisY.valueToFraction(range.start),this.axisY.valueToFraction(range.end),this.cursorInterpolation?this.getIntensityInterpolation():'disabled');
    if(!Number.isFinite(intensity))return undefined;return {series:this,angleDeg:angle,amplitude,intensity,iSector:Math.floor(column),iAnnulus:Math.max(0,Math.min(this.annuli-1,Math.floor(row)))};
  }
}
