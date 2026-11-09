/** Browser-owned image sources accepted by the public custom-icon API. */
export type ImageFillSource = TexImageSource | undefined;
export interface IconProperties {type: 'icon'; width: number | undefined; height: number | undefined;}

function dimension(value: number | undefined): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0))
    throw new RangeError('Icon dimensions must be finite and positive');
}
function sourceSize(source: ImageFillSource): {width:number;height:number} {
  if (!source) return {width:1,height:1};
  const image = source as unknown as {naturalWidth?:number;naturalHeight?:number;videoWidth?:number;videoHeight?:number;displayWidth?:number;displayHeight?:number;width?:number;height?:number};
  const width=image.naturalWidth??image.videoWidth??image.displayWidth??image.width;
  const height=image.naturalHeight??image.videoHeight??image.displayHeight??image.height;
  if (!(width!>0) || !(height!>0) || !Number.isFinite(width) || !Number.isFinite(height))
    throw new RangeError('Custom icon source must have positive, ready image dimensions');
  return {width:width!,height:height!};
}

/** Immutable size styles share the caller's image; disposal never closes that image. */
export class Icon implements IconProperties {
  readonly type='icon' as const;
  readonly width:number|undefined;
  readonly height:number|undefined;
  private readonly state:{source:ImageFillSource;disposed:boolean;listeners:Set<()=>void>;canvasSource?:CanvasImageSource};
  /** @internal Icons are normally created by chart.engine.addCustomIcon. */
  constructor(source:ImageFillSource, opts:Partial<IconProperties>={}, private readonly owner?:IconRegistry) {
    dimension(opts.width);dimension(opts.height);sourceSize(source);
    if (opts.type!==undefined && opts.type!=='icon') throw new TypeError('Unsupported custom icon type');
    this.width=opts.width;this.height=opts.height;
    this.state={source,disposed:false,listeners:new Set()};
    Object.freeze(this);
  }
  getWidth():number|undefined{return this.width;}
  getHeight():number|undefined{return this.height;}
  setWidth(width:number|undefined):Icon{return this.derive({width,height:this.height});}
  setHeight(height:number|undefined):Icon{return this.derive({width:this.width,height});}
  setSize(width:number,height:number):Icon{return this.derive({width,height});}
  private derive(opts:Partial<IconProperties>):Icon {
    if(this.state.disposed)throw new Error('Custom icon has been disposed');
    return this.owner?this.owner.add(this.state.source,opts):new Icon(this.state.source,opts);
  }
  /** @internal Resolved CSS pixel dimensions; public getters retain their original option values. */
  getRasterSize():{width:number;height:number} {
    const source=sourceSize(this.state.source);
    const width=this.width??(this.height===undefined?source.width:this.height*source.width/source.height);
    const height=this.height??(this.width===undefined?source.height:this.width*source.height/source.width);
    return {width,height};
  }
  /** @internal Borrowed image; undefined means blank or disposed. */
  getSource():ImageFillSource{return this.state.disposed?undefined:this.state.source;}
  /** @internal Canvas drawImage does not directly accept ImageData. */
  getCanvasSource():CanvasImageSource|undefined {
    const source=this.getSource();if(!source)return undefined;
    if(typeof ImageData!=='undefined' && source instanceof ImageData){
      if(!this.state.canvasSource){
        const canvas=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(source.width,source.height):typeof document!=='undefined'?document.createElement('canvas'):undefined;
        if(!canvas)throw new Error('ImageData icons require a Canvas2D image surface');
        canvas.width=source.width;canvas.height=source.height;
        const ctx=canvas.getContext('2d') as CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D|null;
        if(!ctx)throw new Error('Canvas2D image conversion is unavailable');
        ctx.putImageData(source,0,0);this.state.canvasSource=canvas;
      }
      return this.state.canvasSource;
    }
    return source as CanvasImageSource;
  }
  /** @internal Release notifications let each renderer delete its own texture promptly. */
  onDispose(listener:()=>void):()=>void {
    if(this.state.disposed){listener();return()=>{};}
    this.state.listeners.add(listener);return()=>{this.state.listeners.delete(listener);};
  }
  isDisposed():boolean{return this.state.disposed;}
  dispose():this {
    if(this.state.disposed)return this;
    this.state.disposed=true;this.state.source=undefined;this.state.canvasSource=undefined;
    const errors:unknown[]=[];
    for(const listener of [...this.state.listeners]){try{listener();}catch(error){errors.push(error);}}
    this.state.listeners.clear();try{this.owner?.release(this);}catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(errors,'Custom icon disposal failed');
    return this;
  }
}

/** @internal One registry belongs to one chart engine, including all derived styles. */
export class IconRegistry {
  private readonly icons=new Set<Icon>();
  private disposed=false;
  constructor(private readonly changed:()=>void=()=>{}){}
  add(source:ImageFillSource,opts:Partial<IconProperties>={}):Icon {
    if(this.disposed)throw new Error('Custom icon engine has been disposed');
    const icon=new Icon(source,opts,this);this.icons.add(icon);this.changed();return icon;
  }
  release(icon:Icon):void {if(this.icons.delete(icon))this.changed();}
  dispose():void {if(this.disposed)return;this.disposed=true;const errors:unknown[]=[];for(const icon of [...this.icons]){try{icon.dispose();}catch(error){errors.push(error);}}this.icons.clear();if(errors.length)throw new AggregateError(errors,'Custom icon engine disposal failed');}
}
