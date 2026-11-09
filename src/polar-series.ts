import type {Axis} from './axis.js';
import type {RenderHost} from './contracts.js';
import type {Color} from './core/styles.js';
import {PointLineAreaSeries, type SeriesOptions} from './series.js';
import {ComponentHighlightState} from './component-highlight.js';

export interface PolarPoint {readonly angle:number;readonly amplitude:number;readonly color?:Color;}
export type PolarSolveMode='show-nearest'|'show-all'|'show-pointed';
export interface PolarSeriesHost extends RenderHost {
  readonly coordsClient:any;readonly coordsPixel:any;
  translatePoint(point:any,source:any,target:any):any;
  projectPolarPoint(point:PolarPoint,axis?:Axis):{x:number;y:number};
  getPolarCursorPosition(point:PolarPoint,axis:Axis):PolarSolveResult['cursorPosition'];
}
export interface PolarSolveResult extends PolarPoint {
  readonly series:PolarSeries;
  readonly cursorPosition:{pointMarker:{x:number;y:number};pointMarkerScale:any;resultTable:{x:number;y:number};resultTableScale:any};
  /** @internal Retained index and distance for chart-level selection. */
  readonly index:number;readonly distanceSquared:number;
}
export type PolarSeriesCursorFormatter=(hit:PolarSolveResult,before:any[][])=>any[][]|undefined;

/** Polar points keep their original degree/amplitude values in ordinary columns.
 * Coordinate conversion belongs to the chart, independently of data storage. */
export class PolarSeries extends PointLineAreaSeries {
  private cursorFormattingOverride?:PolarSeriesCursorFormatter;
  private readonly polarHighlight=new ComponentHighlightState();
  constructor(readonly polarChart:PolarSeriesHost,options:SeriesOptions={},kind='line'){super(polarChart,options,kind);}
  override setHighlight(value:boolean|number):this{
    this.assertAlive();super.setHighlight(this.polarHighlight.set(value));return this;
  }
  setAnimationHighlight(enabled:boolean):this{
    this.assertAlive();this.polarHighlight.setAnimation(enabled);this.chart.invalidate();return this;
  }
  getAnimationHighlight(){return this.polarHighlight.getAnimation();}
  /** @internal Only Polar's existing scheduled chart frame advances this state. */
  advanceHighlight(timestamp:number){this.polarHighlight.advance(timestamp,this.visible&&!this.disposed&&this.getSampleCount()>0);}
  /** @internal No per-series timer or RAF is created. */
  hasPendingHighlight(){return this.polarHighlight.pending(this.visible&&!this.disposed&&this.getSampleCount()>0);}
  /** @internal Rendering resolves colors without changing public styles. */
  getHighlightStrength(){return this.polarHighlight.strength();}
  /** @internal A draw failure must not leave a retrying animation loop. */
  cancelHighlightAnimation(){this.polarHighlight.cancel();}
  /** @internal Hidden charts resume from a fresh pulse instead of elapsed hidden time. */
  suspendHighlightAnimation(){this.polarHighlight.suspend();}
  override setVisible(value:boolean){if(!value)this.polarHighlight.suspend();return super.setVisible(value);}
  override add(points:any|any[]){
    const list=Array.isArray(points)?points:[points];
    return super.add(list.map(point=>({...point,x:point.angle??point.x,y:point.amplitude??point.y})));
  }
  setData(points:readonly PolarPoint[]):this{
    this.assertAlive();
    if(!Array.isArray(points))throw new TypeError('Polar data must be an array of points');
    // Read user values before changing the bound data set; a throwing accessor
    // cannot clear a previously rendered curve.
    const x=new Float64Array(points.length),y=new Float64Array(points.length),colors:number[]=[];
    let hasColor=false;
    for(let i=0;i<points.length;i++){
      const point=points[i]!;x[i]=Number(point.angle);y[i]=Number(point.amplitude);
      const color=point.color;colors.push(color?.toUint32?.()??NaN);hasColor ||= color!==undefined;
    }
    if(hasColor)this.ensureAttributeColumns(['color']);
    this.dataSet.replaceSamples({[this.mapping.x!]:x,[this.mapping.y!]:y,...(hasColor?{[this.mapping.color!]:colors}:{})});
    return this;
  }
  getData():PolarPoint[]{return this.getPoints().map(point=>({angle:point.x,amplitude:point.y,...(point.color?{color:point.color}:{})}));}
  setCursorFormattingOverride(formatter:PolarSeriesCursorFormatter|undefined):this{
    if(formatter!==undefined&&typeof formatter!=='function')throw new TypeError('Cursor formatter must be a function');
    this.cursorFormattingOverride=formatter;this.chart.invalidate();return this;
  }
  getCursorFormattingOverride(){return this.cursorFormattingOverride;}
  /** @internal The chart supplies fresh rows for every hit. */
  formatCursorRows(hit:PolarSolveResult,before:any[][]):any[][]|undefined{return this.cursorFormattingOverride?this.cursorFormattingOverride(hit,before):before;}
  solveNearest(from:{clientX:number;clientY:number},mode:PolarSolveMode='show-nearest'):PolarSolveResult|undefined{
    if(!this.visible||this.disposed||!this.cursorEnabled)return undefined;
    if(!['show-nearest','show-all','show-pointed'].includes(mode))throw new RangeError('Interpolated polar hit testing is not implemented');
    const at=this.polarChart.translatePoint(from,this.polarChart.coordsClient,this.polarChart.coordsPixel);
    if(!Number.isFinite(at.x)||!Number.isFinite(at.y))return undefined;
    let nearest:PolarSolveResult|undefined;
    for(let index=0;index<this.getSampleCount();index++){
      const point=this.getSample(index),angle=point.x,amplitude=point.y;
      if(!Number.isFinite(angle)||!Number.isFinite(amplitude))continue;
      const pixel=this.polarChart.projectPolarPoint({angle,amplitude},this.axisY),distanceSquared=(at.x-pixel.x)**2+(at.y-pixel.y)**2;
      if(nearest&&distanceSquared>=nearest.distanceSquared)continue;
      nearest={angle,amplitude,color:point.color,series:this,index,distanceSquared,cursorPosition:this.polarChart.getPolarCursorPosition({angle,amplitude,color:point.color},this.axisY)};
    }
    return nearest;
  }
  override dispose(){this.polarHighlight.cancel();this.cursorFormattingOverride=undefined;return super.dispose();}
}
export class PolarLineSeries extends PolarSeries {}
export class PolarPointSeries extends PolarSeries {}
export class PolarPointLineSeries extends PolarSeries {}
