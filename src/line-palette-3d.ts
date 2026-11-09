import type {LUT} from './core/styles.js';
import {writeColor} from './series-attributes.js';

/** A three-dimensional line is split at raw LUT boundaries before normalization is drawn. */
export function colorMappedLine3D(positions:Float32Array,values:ArrayLike<number>,lut:LUT):{positions:Float32Array;colors:Float32Array}{
  const count=positions.length/3;
  if(!Number.isInteger(count)||values.length!==count)throw new RangeError('3D palette values must match all XYZ samples');
  const vertices:number[]=[],colors:number[]=[],steps=lut.getSteps(),interpolate=lut.getInterpolation();
  const emit=(x:number,y:number,z:number,value:number)=>{vertices.push(x,y,z);writeColor(colors,colors.length,lut.getColor(value));};
  if(count===1)emit(positions[0]!,positions[1]!,positions[2]!,values[0]!);
  for(let i=1;i<count;i++){
    const offset=(i-1)*3,ax=positions[offset]!,ay=positions[offset+1]!,az=positions[offset+2]!,bx=positions[offset+3]!,by=positions[offset+4]!,bz=positions[offset+5]!,a=values[i-1]!,b=values[i]!;
    if(![ax,ay,az,bx,by,bz].every(Number.isFinite)){emit(NaN,NaN,NaN,NaN);continue;}
    const ts=[0,...(Number.isFinite(a)&&Number.isFinite(b)&&a!==b?steps.map(step=>(step.value-a)/(b-a)).filter(t=>t>0&&t<1):[]),1].sort((x,y)=>x-y);
    for(let j=1;j<ts.length;j++){
      const t0=ts[j-1]!,t1=ts[j]!,mid=a+(b-a)*(t0+t1)/2;
      emit(ax+(bx-ax)*t0,ay+(by-ay)*t0,az+(bz-az)*t0,interpolate?a+(b-a)*t0:mid);
      emit(ax+(bx-ax)*t1,ay+(by-ay)*t1,az+(bz-az)*t1,interpolate?a+(b-a)*t1:mid);
    }
  }
  return{positions:new Float32Array(vertices),colors:new Float32Array(colors)};
}
