import {FontSettings,type FillStyle} from './core/styles.js';

interface PreparedCell {
  text:string; lines:string[]; font:FontSettings; fill:string; symbol?:string;
  symbolSize:number; symbolGap:number; width:number; height:number; lineHeight:number;
  ascent:number; descent:number; textWidth:number; column:number; x:number; y:number;
}
interface PreparedRow {cells:PreparedCell[];top:number;height:number;fill?:string;}
export interface ResultTableLayout {
  rich:boolean;width:number;height:number;padding:number;plainText:string;
  contentWidth:number;rows:PreparedRow[];
}

const css=(style:any,fallback='transparent'):string=>style?.kind==='empty'?'rgba(0, 0, 0, 0)':style?.getColor?.()?.toCSS?.()??style?.color?.toCSS?.()??(typeof style==='string'?style:fallback);
const colorCSS=(color:any):string|undefined=>color?.toCSS?.()??color?.toRGBAString?.()??(typeof color?.getR==='function'?`rgba(${color.getR()}, ${color.getG()}, ${color.getB()}, ${color.getA()/255})`:undefined);
function componentSymbol(cell:any,component:any):string|undefined{
  if(cell.componentColor!==undefined)return colorCSS(cell.componentColor);
  if(cell.componentFillStyle!==undefined)return css(cell.componentFillStyle);
  // Public style accessors support line and filled-figure component cells.
  // Transparent area/default fills do not hide a line's actual stroke colour.
  for(const fill of [component?.getDominantStyle?.(),component?.getFillStyle?.(),component?.getStrokeStyle?.()?.getFillStyle?.()]){
    const color=fill?.getColor?.();if(color&&(color.getA?.()??255)>0)return colorCSS(color);
  }
  return undefined;
}
function resolvedFont(base:FontSettings,override:any):FontSettings{
  if(!override)return base;
  const values:any={size:base.size,family:base.family,weight:base.weight,style:base.style,variant:base.variant};
  for(const key of ['size','family','weight','style','variant'])if(override[key]!==undefined)values[key]=override[key];
  return new FontSettings(values);
}

/** A per-draw snapshot: component names and cell getters are read just once. */
export function prepareResultTableLayout(ctx:CanvasRenderingContext2D,content:any[][],font:FontSettings,fill:FillStyle,padding:number):ResultTableLayout{
  const rich=content.some(row=>row.some(cell=>cell!==null&&typeof cell==='object'));
  ctx.save();
  try{
    ctx.font=font.toCSS();
    if(!rich){
      const plainText=content.map(row=>row.map(cell=>String(cell??'')).join('    ')).join('\n'),lines=plainText.split('\n');
      const contentWidth=Math.max(1,...lines.map(line=>ctx.measureText(line).width));
      return{rich:false,plainText,width:contentWidth+padding*2,height:lines.length*font.size*1.35+padding*2,padding,contentWidth,rows:[]};
    }
    // Canvas ascent/descent depend on textBaseline. Rich drawing uses the
    // alphabetic baseline, so measurement must use that same coordinate frame.
    ctx.textBaseline='alphabetic';
    const columnCount=Math.max(1,...content.map(row=>row.length)),columnWidths=new Array<number>(columnCount).fill(0),gap=ctx.measureText(' ').width;
    let spanningWidth=1;
    const rows:PreparedRow[]=content.map(row=>{
      let rowFill:string|undefined;
      const cells:PreparedCell[]=row.map((value,index)=>{
        const cell=value!==null&&typeof value==='object'?value:{text:String(value??'')};
        const component=cell.component??(typeof cell.getName==='function'?cell:undefined);
        const text=String(cell.text??component?.getName?.()??''),cellFont=resolvedFont(font,cell.font);
        ctx.font=cellFont.toCSS();const lines=text.split('\n'),metrics=lines.map(line=>ctx.measureText(line));
        const ascent=Math.max(0,...metrics.map(metric=>Number.isFinite(metric.actualBoundingBoxAscent)?metric.actualBoundingBoxAscent:cellFont.size*.8));
        const descent=Math.max(0,...metrics.map(metric=>Number.isFinite(metric.actualBoundingBoxDescent)?metric.actualBoundingBoxDescent:cellFont.size*.2));
        const lineHeight=Math.max(cellFont.size*1.35,ascent+descent),textWidth=Math.max(0,...metrics.map(metric=>metric.width));
        const symbol=component?componentSymbol(cell,component):undefined,symbolSize=symbol===undefined?0:cellFont.size*.7,symbolGap=symbolSize?ctx.measureText(' ').width:0;
        const width=textWidth+symbolSize+symbolGap,height=Math.max(lines.length*lineHeight,symbolSize);
        const column=row.length>1&&index===row.length-1?columnCount-1:index;
        if(row.length===1)spanningWidth=Math.max(spanningWidth,width);else columnWidths[column]=Math.max(columnWidths[column]!,width);
        if(rowFill===undefined&&cell.rowFillStyle!==undefined)rowFill=css(cell.rowFillStyle);
        return{text,lines,font:cellFont,fill:css(cell.fillStyle??fill),symbol,symbolSize,symbolGap,width,height,lineHeight,ascent,descent,textWidth,column,x:0,y:0};
      });
      return{cells,top:0,height:Math.max(font.size*1.35,...cells.map(cell=>cell.height)),fill:rowFill};
    });
    const columnsWidth=columnWidths.reduce((sum,value)=>sum+value,0)+gap*(columnCount-1),contentWidth=Math.max(1,columnsWidth,spanningWidth);
    columnWidths[columnCount-1]!+=contentWidth-columnsWidth;
    const positions:number[]=[];let columnX=0;
    for(const width of columnWidths){positions.push(columnX);columnX+=width+gap;}
    let top=0;
    for(const row of rows){row.top=top;top+=row.height;for(const cell of row.cells){
      cell.x=row.cells.length===1?0:positions[cell.column]!+(cell.column===columnCount-1?columnWidths[cell.column]!-cell.width:0);
      cell.y=row.top+(row.height-cell.height)/2;
    }}
    return{rich:true,width:contentWidth+padding*2,height:top+padding*2,padding,plainText:'',contentWidth,rows};
  }finally{ctx.restore();}
}

/** Draw exactly the measured cells; no source rows, names or fonts are reread. */
export function drawResultTableCells(ctx:CanvasRenderingContext2D,layout:ResultTableLayout,left:number,top:number):void{
  const x=left+layout.padding,y=top+layout.padding;
  ctx.textAlign='left';ctx.textBaseline='alphabetic';
  for(const row of layout.rows){
    if(row.fill!==undefined){ctx.fillStyle=row.fill;ctx.fillRect(x,y+row.top,layout.contentWidth,row.height);}
    for(const cell of row.cells){
      const atX=x+cell.x,atY=y+cell.y;
      if(cell.symbol!==undefined){ctx.fillStyle=cell.symbol;ctx.beginPath();ctx.arc(atX+cell.symbolSize/2,atY+cell.height/2,cell.symbolSize/2,0,Math.PI*2);ctx.fill();}
      ctx.font=cell.font.toCSS();ctx.fillStyle=cell.fill;
      for(let line=0;line<cell.lines.length;line++)ctx.fillText(cell.lines[line]!,atX+cell.symbolSize+cell.symbolGap,atY+line*cell.lineHeight+(cell.lineHeight-cell.ascent-cell.descent)/2+cell.ascent);
    }
  }
}
