type Vertex = readonly [number, number];
const square:readonly Vertex[]=[[-1,-1],[1,-1],[1,1],[-1,1]];
const triangle:readonly Vertex[]=[[0,4/3],[-2/Math.sqrt(3),-2/3],[2/Math.sqrt(3),-2/3]];
const diamond:readonly Vertex[]=[[0,-1],[1,0],[0,1],[-1,0]];
const cross:readonly Vertex[]=[[-.24,-1],[.24,-1],[.24,-.24],[1,-.24],[1,.24],[.24,.24],[.24,1],[-.24,1],[-.24,.24],[-1,.24],[-1,-.24],[-.24,-.24]];
const dash:readonly Vertex[]=[[-1,-.22],[1,-.22],[1,.22],[-1,.22]];
const arrow:readonly Vertex[]=[[0,-1],[1,0],[.24,0],[.24,1],[-.24,1],[-.24,0],[-1,0]];
const star:readonly Vertex[]=Array.from({length:10},(_,i)=>{const angle=-Math.PI/2+i*Math.PI/5,radius=i%2?.42:1;return[Math.cos(angle)*radius,Math.sin(angle)*radius] as const;});
const aliases:Record<string,number>={square:0,circle:1,triangle:2,cross:3,diamond:4,plus:5,minus:6,arrow:7,star:8};
function shapeIndex(shape:number|string){return typeof shape==='number'?shape:aliases[String(shape).toLowerCase()]??1;}
/** The original Canvas fill vertices; stroke sizing never rewrites the fill. */
export function pointShapeVertices(shape:number):readonly Vertex[]{return shape===0?square:shape===2?triangle:shape===4?diamond:shape===6?dash:shape===7?arrow:shape===8?star:cross;}
export const pointStrokeMiterLimit=10;
/** Star's GPU distance is Euclidean, hence its outward join is round. */
export function pointStrokeJoin(shape:number|string):CanvasLineJoin{return shapeIndex(shape)===8?'round':'miter';}
function miterReach(vertices:readonly Vertex[]){let reach=1;for(let i=0;i<vertices.length;i++){const p=vertices[(i+vertices.length-1)%vertices.length]!,v=vertices[i]!,n=vertices[(i+1)%vertices.length]!,ax=p[0]-v[0],ay=p[1]-v[1],bx=n[0]-v[0],by=n[1]-v[1],length=Math.hypot(ax,ay)*Math.hypot(bx,by);if(!(length>0))continue;const cosine=Math.max(-1,Math.min(1,(ax*bx+ay*by)/length)),sine=Math.sqrt(Math.max(0,(1-cosine)/2));reach=Math.max(reach,sine>0?1/sine:pointStrokeMiterLimit);}return Math.min(pointStrokeMiterLimit,reach);}
const reaches=Array.from({length:9},(_,shape)=>shape===1||shape===8?1:miterReach(pointShapeVertices(shape)));
/** Distance from a fill vertex to the furthest permitted outward join. */
export function pointStrokeReach(shape:number|string):number{return reaches[shapeIndex(shape)]??pointStrokeMiterLimit;}
/** Rotation-independent bound for every existing fill path and outward join. */
export function pointStrokeRadius(size:number,width:number,shape:number|string=1):number{return Math.max(0,size)*Math.SQRT1_2+(size>1?Math.max(0,width):0)*pointStrokeReach(shape)+2;}
// Feed the same vertex-derived join reach into the GPU sprite allocation.
// Shape distance/coverage itself remains unchanged.
export const pointStrokeExtentGLSL=`float pointStrokeExtent(int shape){${reaches.map((value,shape)=>`if(shape==${shape})return ${value.toFixed(16)};`).join('')}return ${pointStrokeMiterLimit.toFixed(1)};}`;
