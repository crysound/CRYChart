import type {Axis} from './axis.js';

export type SolveNearestMode='show-nearest'|'show-all'|'show-pointed';
export interface CoordinateClient {clientX:number;clientY:number;}
export interface CursorHitPositionXY {
  pointMarker:{x:number;y:number;color?:unknown};pointMarkerScale:any;
  resultTable:{x:number;y:number};resultTableScale:any;
}
export interface SolveResultXY {
  readonly axisX:Axis;readonly axisY:Axis;readonly series:any;
  readonly x:number;readonly y:number;readonly cursorPosition:CursorHitPositionXY;
  /** @internal Screen-space ordering, not a source data value. */
  readonly distanceSquared:number;
}
export interface SolveResultHeatmap extends SolveResultXY {readonly column:number;readonly row:number;readonly intensity:number;readonly lut:any;}
export interface CursorTargetChangedEvent<T=SolveResultXY> {hit:T|undefined;hits:T[]|undefined;mouseLocation:CoordinateClient;}
export type SeriesCursorFormatter=(hit:any,before:any[][])=>any[][]|undefined;
export function validateSolveMode(mode:string):asserts mode is SolveNearestMode{
  if(!['show-nearest','show-all','show-pointed'].includes(mode))throw new RangeError('Interpolated cursor solving is not implemented');
}
export function xyCursorHit(series:any,point:{x:number;y:number},from:CoordinateClient,extras:Record<string,any>={}):SolveResultXY{
  const chart=series.chart,scale={x:series.axisX,y:series.axisY},pixel=chart.translatePoint(point,scale,chart.coordsPixel),at=chart.translatePoint(from,chart.coordsClient,chart.coordsPixel);
  return{...extras,...point,series,axisX:series.axisX,axisY:series.axisY,distanceSquared:(pixel.x-at.x)**2+(pixel.y-at.y)**2,
    cursorPosition:{pointMarker:{x:point.x,y:point.y},pointMarkerScale:scale,resultTable:{x:point.x,y:point.y},resultTableScale:scale}};
}
function cursorRowsForHit(hit:SolveResultXY):any[][]{
  const heat='intensity'in hit?hit as SolveResultHeatmap:undefined;
  // A missing intensity has no valid palette color. Leave it unmarked rather
  // than giving NaN the appearance of an in-range measurement.
  const color=heat&&Number.isFinite(heat.intensity)?heat.lut?.getColor?.(heat.intensity):undefined;
  const coordinateRow=(axis:Axis,value:number,fallback:string):any[]=>{
    const title=axis.getTitle()||(heat?fallback:'');
    const cell={text:axis.formatCursorValue(value),font:{weight:'bold'}};
    return title?[title,'',cell]:[cell];
  };
  const rows:any[][]=[[{component:hit.series,...(color?{componentColor:color}:{})}],coordinateRow(hit.axisX,hit.x,'X'),coordinateRow(hit.axisY,hit.y,'Y')];
  if(heat){
    const value=heat.intensity,units=heat.lut?.getUnits?.()??'';
    const formatted=Number.isFinite(value)?value.toFixed(1):String(value);
    rows.push(['Value','',{text:formatted+(units?` ${units}`:''),font:{weight:'bold'}}]);
  }
  return rows;
}
function componentColor(series:any):unknown{
  for(const fill of [series?.getDominantStyle?.(),series?.getFillStyle?.(),series?.getStrokeStyle?.()?.getFillStyle?.()]){
    const color=fill?.getColor?.();if(color&&(color.getA?.()??255)>0)return color;
  }
  return undefined;
}
function formatSeriesRows(hit:SolveResultXY,rows:any[][]):any[][]{
  return (typeof hit.series.formatCursorRows==='function'?hit.series.formatCursorRows(hit,rows):rows)??[];
}
export function defaultXYCursorRows(_chart:any,hit:SolveResultXY,hits:SolveResultXY[]):any[][]{
  const selected=hits.length?hits:[hit];
  // A shared X heading applies only when every selected series declares a
  // monotonic X column. Unordered data and mixed schemas keep each hit's full
  // coordinate rows. Nearest mode therefore depends on the selected hit only.
  const sharedAxis=selected.every(item=>{
    const series=item.series,key=series.getDataMapping?.().x,pattern=series.getDataSet?.().schema?.[key]?.pattern;
    return item.axisX===hit.axisX&&!('intensity'in item)&&(pattern==='progressive'||pattern==='regressive');
  });
  if(!sharedAxis)return selected.flatMap(item=>formatSeriesRows(item,cursorRowsForHit(item)));
  const rows=selected.flatMap(item=>formatSeriesRows(item,[[{component:item.series,componentColor:componentColor(item.series)},'',{text:item.axisY.formatCursorValue(item.y),font:{weight:'bold'}}]]));
  return rows.length?[[{text:hit.axisX.formatCursorValue(hit.x)}],...rows]:[];
}
