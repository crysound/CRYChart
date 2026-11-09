import test from 'node:test';
import assert from 'node:assert/strict';
import {triangulateScatter3D, type MeshVertex3D} from '../src/mesh3d.js';

type Point = MeshVertex3D & {value?: number};
const rng = (seed: number) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) + .5) / 4294967296;
// Independent oracle: parse exact base-2 strings, then evaluate integer
// determinants by fraction-free elimination (not the implementation formulas).
function exactCoordinates(points: Point[]) {
  const strings=points.map(p=>[p.x.toString(2),p.z.toString(2)]),digits=Math.max(...strings.flat().map(s=>s.split('.')[1]?.length??0));
  return strings.map(pair=>pair.map(s=>{const negative=s.startsWith('-'),[whole,fraction='']=(negative?s.slice(1):s).split('.');return(negative?-1n:1n)*BigInt('0b'+whole+fraction.padEnd(digits,'0'));}));
}
function determinant(input: bigint[][]): bigint {
  const m=input.map(row=>row.slice());let divisor=1n,sign=1n;
  for(let k=0;k<m.length-1;k++){if(m[k][k]===0n){const row=m.findIndex((v,i)=>i>k&&v[k]!==0n);if(row<0)return 0n;[m[k],m[row]]=[m[row],m[k]];sign=-sign;}const pivot=m[k][k];for(let i=k+1;i<m.length;i++){for(let j=k+1;j<m.length;j++)m[i][j]=(m[i][j]*pivot-m[i][k]*m[k][j])/divisor;m[i][k]=0n;}divisor=pivot;}
  return sign*m.at(-1)!.at(-1)!;
}
function validate(input: Point[]) {
  const saved = input.map(p => ({...p})), retained: Point[] = [], seen = new Set<string>();
  for (const p of input) if ([p.x, p.y, p.z].every(Number.isFinite) && !seen.has(`${p.x}|${p.z}`)) {seen.add(`${p.x}|${p.z}`); retained.push(p);}
  const geometry = triangulateScatter3D(input), indices = Array.from(geometry.indices!), positions = Array.from(geometry.positions);
  assert.deepEqual(input, saved, 'Triangulation cannot mutate original coordinates or attributes');
  assert.deepEqual(positions, retained.flatMap(p => [p.x, p.y, p.z]));
  assert.deepEqual(Array.from(geometry.values!), retained.map(p => Math.fround(p.value ?? p.y)));
  if (retained.length < 3) {assert.equal(indices.length, 0); return {triangles: 0, boundary: 0, area: 0};}
  const minX = Math.min(...retained.map(p => p.x)), minZ = Math.min(...retained.map(p => p.z));
  const span = Math.max(Math.max(...retained.map(p => p.x)) - minX, Math.max(...retained.map(p => p.z)) - minZ);
  const points = retained.map((p, id) => ({x: (p.x - minX) / span, z: (p.z - minZ) / span, id}));
  const exact=exactCoordinates(retained),orient=(a: number,b: number,c: number)=>determinant([a,b,c].map(id=>[...exact[id],1n]));
  const cross = (a: typeof points[number], b: typeof points[number], c: typeof points[number]) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const sorted = [...points].sort((a,b) => retained[a.id].x-retained[b.id].x || retained[a.id].z-retained[b.id].z);
  if (points.every(p => orient(sorted[0].id, sorted.at(-1)!.id, p.id) === 0n)) {assert.equal(indices.length, 0); return {triangles: 0, boundary: 0, area: 0};}
  // Retain source points on hull edges: a triangulation must use them too.
  const half = (list: typeof points) => {const out: typeof points = []; for (const p of list) {while (out.length > 1 && orient(out.at(-2)!.id, out.at(-1)!.id, p.id) < 0n) out.pop(); out.push(p);} return out;};
  const hull = half(sorted).slice(0,-1).concat(half([...sorted].reverse()).slice(0,-1));
  const edgeKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
  const expectedBoundary = new Set(hull.map((p,i) => edgeKey(p.id, hull[(i+1)%hull.length].id))), edges = new Map<string, number>(), edgeFaces=new Map<string,number[][]>(), faces = new Set<string>(), used = new Set<number>();
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const ids = indices.slice(i,i+3), [a,b,c] = ids.map(id => points[id]);
    assert.ok(ids.every(id => Number.isInteger(id) && id >= 0 && id < points.length));
    assert.equal(new Set(ids).size, 3); ids.forEach(id => used.add(id));
    const key = [...ids].sort((a,b) => a-b).join(','); assert.ok(!faces.has(key), 'No duplicate face'); faces.add(key);
    const signed = cross(a,b,c); assert.ok(orient(...ids as [number,number,number])>0n, 'Every original face is exactly nondegenerate and CCW'); area += Math.abs(signed) / 2;
    for (let j=0;j<3;j++) {const key=edgeKey(ids[j],ids[(j+1)%3]);edges.set(key,(edges.get(key)??0)+1);const list=edgeFaces.get(key)??[];list.push(ids);edgeFaces.set(key,list);}
  }
  const actualBoundary = new Set([...edges].filter(([,n]) => n===1).map(([edge]) => edge));
  assert.deepEqual(actualBoundary, expectedBoundary, 'Native mesh boundary is the complete independently computed convex hull');
  assert.ok([...edges.values()].every(n => n===1 || n===2), 'Manifold edge incidence');
  assert.equal(used.size, points.length, 'Every unique finite original sample participates');
  assert.equal(points.length - edges.size + faces.size, 1, 'Euler invariant of one triangulated disk');
  assert.equal(faces.size, 2*points.length - 2 - hull.length);
  // For a complete convex triangulated disk, local empty-circle legality on
  // every internal edge is equivalent to a global Delaunay triangulation.
  for(const [key,pair]of edgeFaces)if(pair.length===2){const ids=pair[0],other=pair[1].find(id=>!ids.includes(id))!;const det=determinant([...ids,other].map(id=>{const [x,z]=exact[id];return[x,z,x*x+z*z,1n];}));assert.ok(det<=0n,`Exact original empty-circle determinant on edge ${key}`);}
  const hullArea = Math.abs(hull.reduce((sum,p,i) => sum+p.x*hull[(i+1)%hull.length].z-p.z*hull[(i+1)%hull.length].x,0))/2;
  assert.ok(Math.abs(area-hullArea) <= Math.max(Number.MIN_VALUE,hullArea)*1e-11, `All hull area is covered: ${area} / ${hullArea}`);
  return {triangles: faces.size, boundary: hull.length, area: area*span*span};
}

test('0918 all 800 samples cover the original convex hull including the three formerly missing edge faces', () => {
  const random = rng(918), points = Array.from({length:800}, () => {const x=random()*50,z=random()*4-2,peak=Math.exp(-(((x-46)/5)**2)-((z-1.4)/.6)**2);return{x,z,y:.012+.068*peak+.012*random()**8+.002*Math.sin(x*.25+z),value:.0113*peak};});
  const result=validate(points); assert.equal(result.triangles,1581); assert.equal(result.boundary,17); assert.ok(Math.abs(result.area-195.5193043453619)<2e-11);
});

test('very flat hull faces remain present instead of being discarded as synthetic-boundary residue', () => {
  const points=Array.from({length:45},(_,i)=>({x:i,z:(i%2?1:-1)*1e-12+(i/44)**2*1e-13,y:i,value:i/44})); validate(points);
  validate([{x:0,y:1,z:0},{x:10,y:2,z:0},{x:9,y:3,z:1e-14},{x:3,y:4,z:1},{x:0,y:5,z:1},{x:1,y:6,z:1e-15}]);
});

test('uniform scale and translation preserve topology and original source precision', () => {
  const random=rng(71),base=Array.from({length:60},(_,i)=>({x:Math.round(random()*10000)/16,z:Math.round(random()*10000)/16,y:i,value:i+.125}));
  let count: number|undefined;
  for (const scale of [2**-400,1,2**400]) {const result=validate(base.map(p=>({...p,x:(p.x+1024)*scale,z:(p.z-2048)*scale})));if(count!==undefined)assert.equal(result.triangles,count);count=result.triangles;}
});

test('duplicate XZ keeps the first source sample and nonfinite inputs do not corrupt the finite hull', () => {
  const points=[{x:0,y:5,z:0,value:2},{x:2,y:6,z:0,value:3},{x:2,y:7,z:2,value:4},{x:0,y:8,z:2,value:5},{x:1,y:9,z:1,value:6},{x:1,y:900,z:1,value:900},{x:NaN,y:1,z:2},{x:1,y:Infinity,z:0}];
  const result=validate(points);assert.equal(result.triangles,4);assert.equal(result.area,4);
});

test('collinear, vertical, fewer-than-three and empty inputs preserve samples without inventing triangles', () => {
  for(const points of [[],[{x:1,y:1,z:2}],[{x:0,y:1,z:0},{x:2,y:2,z:2}],Array.from({length:10},(_,i)=>({x:i,y:i*3,z:i*2})),Array.from({length:10},(_,i)=>({x:5,y:i*3,z:i}))]) assert.equal(validate(points).triangles,0);
});

test('collinear boundary vertices and cocircular grid cells retain a complete nonoverlapping mesh', () => {
  const points=Array.from({length:49},(_,i)=>({x:i%7,z:Math.floor(i/7),y:i,value:i}));validate(points);
  const first=triangulateScatter3D(points),second=triangulateScatter3D(points);assert.deepEqual(first.indices,second.indices,'Repeated input gives deterministic diagonals');
});

test('different insertion orders produce a valid convex-hull Delaunay mesh without changing native vertex order', () => {
  for(let seed=1;seed<=8;seed++){const random=rng(seed),points=Array.from({length:70},(_,i)=>({x:random()*7,z:random(),y:i,value:i}));validate(points);validate([...points].reverse());}
});

function validateIntegerPredicates(input: Array<[number, number]>) {
  const points=input.map(([x,z])=>({x,y:0,z})),geometry=triangulateScatter3D(points),p=input.map(([x,z])=>({x:BigInt(x),z:BigInt(z)})),faces=Array.from(geometry.indices!);
  assert.deepEqual(Array.from(geometry.positions),points.flatMap(p=>[p.x,p.y,p.z]));
  for(let i=0;i<faces.length;i+=3){const ids=faces.slice(i,i+3),[a,b,c]=ids.map(id=>p[id]);assert.ok((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x)>0n,'Original coordinates, not normalized approximations, give every face positive area');
    for(let j=0;j<p.length;j++){if(ids.includes(j))continue;const d=p[j],x=a.x-d.x,z=a.z-d.z,xx=b.x-d.x,zz=b.z-d.z,xxx=c.x-d.x,zzz=c.z-d.z;assert.ok((x*x+z*z)*(xx*zzz-zz*xxx)-(xx*xx+zz*zz)*(x*zzz-z*xxx)+(xxx*xxx+zzz*zzz)*(x*zz-z*xx)<=0n,'Exact original-coordinate empty circle');}}
  return faces;
}

test('distant outlier cannot create a false angle among exactly collinear local coordinates', () => {
  const faces=validateIntegerPredicates([[-1e16,0],[0,0],[1,1],[2,2]]);assert.equal(faces.length,6);assert.ok(!Array.from({length:faces.length/3},(_,i)=>faces.slice(i*3,i*3+3)).some(f=>f.every(i=>i!==0)));
});

test('distant outlier cannot change an exactly cocircular local determinant', () => {
  for(const outlier of [-1e16,-1e100]){
    const faces=validateIntegerPredicates([[outlier,0],[5,0],[3,4],[0,5],[-3,4]]);assert.equal(faces.length,12);
  }
});

test('finite source coordinates remain triangulable even when their floating-point span overflows', () => {
  for(const scale of [1e-300,1e308]){const p=[{x:-scale,y:0,z:-scale},{x:scale,y:1,z:-scale},{x:scale,y:2,z:scale},{x:-scale,y:3,z:scale}],g=triangulateScatter3D(p);assert.equal(g.indices!.length,6);assert.deepEqual(Array.from(g.positions),p.flatMap(v=>[v.x,v.y,v.z]));}
});
