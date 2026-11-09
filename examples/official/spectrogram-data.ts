import {spectrum} from '../signals';

/** Hann-windowed STFT; output cells retain every window and non-negative FFT bin. */
export function shortTimeSpectrum(samples:ArrayLike<number>,sampleRate:number,fftSize=1024,hop=256,floorDB=-100){
  if(!Number.isSafeInteger(fftSize)||fftSize<4||(fftSize&(fftSize-1))!==0||!Number.isSafeInteger(hop)||hop<1||!Number.isFinite(sampleRate)||sampleRate<=0||samples.length<fftSize)throw new RangeError('Invalid STFT dimensions');
  const columns=1+Math.floor((samples.length-fftSize)/hop),rows=fftSize/2+1,values=new Float32Array(columns*rows),window=new Float64Array(fftSize),weighted=new Float64Array(fftSize);
  let gain=0;for(let i=0;i<fftSize;i++){window[i]=.5-.5*Math.cos(2*Math.PI*i/(fftSize-1));gain+=window[i];}gain/=fftSize;
  for(let col=0;col<columns;col++){
    for(let i=0;i<fftSize;i++)weighted[i]=samples[col*hop+i]*window[i];
    const bins=spectrum(weighted,sampleRate);
    for(let row=0;row<rows;row++)values[row*columns+col]=Math.max(floorDB,20*Math.log10(Math.max(Number.MIN_VALUE,bins[row].y/gain)));
  }
  return{values,columns,rows,sampleRate,fftSize,hop,timeStep:hop/sampleRate,frequencyStep:sampleRate/fftSize,window:'Hann',floorDB};
}

/** Projection slices are exact reads of a row-major matrix, without resampling. */
export function matrixProjection(values:Float32Array,columns:number,rows:number,column:number,row:number){
  if(values.length!==columns*rows||!Number.isInteger(column)||!Number.isInteger(row)||column<0||column>=columns||row<0||row>=rows)throw new RangeError('Projection outside matrix');
  return{horizontal:values.slice(row*columns,(row+1)*columns),vertical:Float32Array.from({length:rows},(_,y)=>values[y*columns+column]),value:values[row*columns+column]};
}

/** Independent spectral fixture: two noisy frequency bands, with deterministic phase. */
export function spectralColumn(rows:number,phase:number,random:()=>number,maximum=75){
  return Float32Array.from({length:rows},(_,i)=>{
    const f=i/rows,low=Math.exp(-(((f-.17-.03*Math.sin(phase*.7))/.18)**2)),high=Math.exp(-(((f-.64-.045*Math.sin(phase*.23))/.09)**2)),noise=.35+.65*random();
    return Math.max(0,Math.min(maximum,maximum*(.02+.88*low*noise+.65*high*noise)));
  });
}
