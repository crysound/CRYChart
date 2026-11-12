import {FontSettings} from './core/styles.js';

/** Resolve HTML text CSS once per semantic font. Canvas rendering and capture
 * use the same resolved font; public FontSettings remain unchanged. */
export class CssTextFonts {
  private readonly probe:HTMLElement;
  private readonly fonts=new Map<string,FontSettings>();
  private readonly observer?:MutationObserver;
  private readonly removeFontListener?:()=>void;
  private disposed=false;
  constructor(root:HTMLElement,changed:()=>void){
    const documentRef=root.ownerDocument;
    this.probe=documentRef.createElement('span');
    this.probe.className='crychart-text';this.probe.setAttribute('aria-hidden','true');
    this.probe.style.cssText='position:absolute;left:-10000px;top:0;visibility:hidden;pointer-events:none;white-space:pre';
    root.append(this.probe);
    const Observer=documentRef.defaultView?.MutationObserver;
    const refresh=()=>{if(!this.disposed){this.fonts.clear();changed();}};
    if(Observer){
      const previousStyle=documentRef.createElement('span').style;
      this.observer=new Observer(records=>{
        const affectsFont=records.some(record=>{
          if(record.target!==root||record.attributeName!=='style')return true;
          previousStyle.cssText=record.oldValue??'';
          const keys=new Set<string>();for(let n=0;n<previousStyle.length;n++)keys.add(previousStyle[n]!);for(let n=0;n<root.style.length;n++)keys.add(root.style[n]!);
          // Background and cursor are renderer-owned and cannot affect font
          // resolution. Preserve observation of caller-supplied root fonts or
          // custom properties, without adding a repaint after background work.
          return [...keys].some(key=>!key.startsWith('background')&&key!=='cursor'&&(previousStyle.getPropertyValue(key)!==root.style.getPropertyValue(key)||previousStyle.getPropertyPriority(key)!==root.style.getPropertyPriority(key)));
        });
        if(affectsFont)refresh();
      });
      for(const node of new Set([documentRef.documentElement,documentRef.body,root.parentElement].filter((node):node is HTMLElement=>!!node)))this.observer.observe(node,{attributes:true,attributeFilter:['class','style']});
      this.observer.observe(root,{attributes:true,attributeFilter:['class','style'],attributeOldValue:true});
    }
    if(documentRef.fonts?.addEventListener){documentRef.fonts.addEventListener('loadingdone',refresh);this.removeFontListener=()=>documentRef.fonts.removeEventListener('loadingdone',refresh);}
  }
  resolve(font:FontSettings):FontSettings{
    if(this.disposed)return font;
    const key=font.toCSS(),cached=this.fonts.get(key);if(cached)return cached;
    this.probe.style.font=key;
    const style=this.probe.ownerDocument.defaultView?.getComputedStyle(this.probe),size=Number.parseFloat(style?.fontSize??'');
    const result=style?new FontSettings({size:Number.isFinite(size)&&size>0?size:font.size,family:style.fontFamily||font.family,weight:style.fontWeight||font.weight,style:style.fontStyle||font.style,variant:style.fontVariant||font.variant}):font;
    this.fonts.set(key,result);return result;
  }
  dispose(){if(!this.disposed){this.disposed=true;this.observer?.disconnect();this.removeFontListener?.();this.fonts.clear();this.probe.remove();}}
}
