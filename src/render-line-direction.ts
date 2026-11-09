/** Experimental alternative for the existing solid-line rasterizer. It changes
 * the order of floating-point operations, so its pixels must not be described
 * as identical to the projected-subtraction path without an actual comparison.
 * Both paths preserve every submitted source point and use the same AA fragment.
 */
export type LineDirectionMode = 'projected' | 'relative';

/** Conservative per-segment bounds for the explicit coverage-union candidate.
 * The original miter experiment below remains available for historical probes;
 * it is not used by this shader. Coordinates are relative framebuffer pixels. */
export const lineCapsuleVertex = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec2 a_start;
layout(location=1) in vec2 a_end;
uniform vec4 u_domain;
uniform vec2 u_size;
uniform float u_width;
flat out vec2 v_lineStart;
flat out vec2 v_lineEnd;
flat out float v_valid;
bool finite(vec2 p){return !any(isnan(p))&&!any(isinf(p));}
void main(){
  vec2 a=(a_start-u_domain.xy)/u_domain.zw*u_size;
  vec2 b=(a_end-u_domain.xy)/u_domain.zw*u_size;
  vec2 delta=b-a;
  bool valid=finite(a_start)&&finite(a_end)&&finite(a)&&finite(b)&&finite(delta);
  float scale=max(abs(delta.x),abs(delta.y));
  vec2 tangent=scale>0.?normalize(delta/scale):vec2(1.,0.);
  vec2 normal=vec2(-tangent.y,tangent.x);
  bool ending=gl_VertexID%2==1;
  float side=gl_VertexID<2?-1.:1.;
  vec2 pixel=(ending?b:a)+(normal*side+tangent*(ending?1.:-1.))*(u_width*.5+1.);
  v_lineStart=a;v_lineEnd=b;v_valid=valid?1.:0.;
  gl_Position=valid?vec4(pixel/u_size*2.-1.,0.,1.):vec4(2.,2.,2.,1.);
}`;

export const lineCoverageFragment = `#version 300 es
precision highp float;
uniform vec2 u_plotOrigin;
uniform float u_width;
flat in vec2 v_lineStart;
flat in vec2 v_lineEnd;
flat in float v_valid;
out vec4 color;
void main(){
  if(v_valid<.5)discard;
  vec2 pixel=gl_FragCoord.xy-u_plotOrigin,delta=v_lineEnd-v_lineStart;
  float scale=max(abs(delta.x),abs(delta.y)),t=0.;
  if(scale>0.){vec2 direction=delta/scale;t=clamp(dot((pixel-v_lineStart)/scale,direction)/dot(direction,direction),0.,1.);}
  float distance=length(pixel-mix(v_lineStart,v_lineEnd,t));
  float coverage=clamp(u_width*.5+.5-distance,0.,1.);
  if(coverage<=0.)discard;
  color=vec4(coverage,0.,0.,1.);
}`;

/** The direct renderer and transform-feedback cache deliberately share this
 * exact expression order. Deltas are formed before viewport translation. This
 * makes the offset calculation independent of pan at an unchanged pixel scale.
 */
export const relativeLineDirectionGLSL = `
vec2 lineDelta(vec2 center,vec2 neighbor){
  return (center-neighbor)*(2.0*u_size/u_domain.zw);
}
bool lineNeighbor(vec2 neighbor,vec2 delta){
  return finite(neighbor)&&dot(delta,delta)>0.0000000001;
}
vec4 lineOffsets(vec2 previous,vec2 center,vec2 next){
  vec2 incoming=lineDelta(center,previous),outgoing=lineDelta(next,center);
  bool hasPrevious=lineNeighbor(previous,incoming),hasNext=lineNeighbor(next,outgoing);
  vec2 incomingNormal=hasPrevious?vec2(-incoming.y,incoming.x)/length(incoming):vec2(0.,1.);
  vec2 outgoingNormal=hasNext?vec2(-outgoing.y,outgoing.x)/length(outgoing):incomingNormal;
  if(!hasPrevious)incomingNormal=outgoingNormal;
  vec2 sum=incomingNormal+outgoingNormal;
  vec2 miter=length(sum)>.00001?normalize(sum):incomingNormal;
  miter/=max(.25,dot(miter,incomingNormal));
  vec2 cap=vec2(0.);
  if(!hasPrevious&&hasNext)cap-=outgoing/length(outgoing);
  if(hasPrevious&&!hasNext)cap+=incoming/length(incoming);
  vec2 scale=(u_width+2.)/u_size;
  return finite(center)?vec4((-miter+cap)*scale,(miter+cap)*scale):vec4(0.);
}
`;

export const relativeLineVertex = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec2 a_previous;
layout(location=1) in vec2 a_center;
layout(location=2) in vec2 a_next;
uniform vec4 u_domain;
uniform vec2 u_size;
uniform float u_width;
flat out vec2 v_lineStart;
flat out vec2 v_lineEnd;
flat out float v_valid;
bool finite(vec2 p){return !any(isnan(p))&&!any(isinf(p));}
vec2 project(vec2 p){return (p-u_domain.xy)/u_domain.zw*2.0-1.0;}
${relativeLineDirectionGLSL}
void main(){
  vec2 p=project(a_center),before=project(a_previous);
  vec4 offsets=lineOffsets(a_previous,a_center,a_next);
  vec2 offset=gl_VertexID%2==0?offsets.xy:offsets.zw;
  v_lineStart=(before+1.)*.5*u_size;
  v_lineEnd=(p+1.)*.5*u_size;
  v_valid=finite(a_center)&&lineNeighbor(a_previous,lineDelta(a_center,a_previous))?1.:0.;
  gl_Position=finite(a_center)?vec4(p+offset,0.,1.):vec4(2.,2.,2.,1.);
}`;

export const relativeCachedLineVertex = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec2 a_previous;
layout(location=1) in vec2 a_center;
layout(location=2) in vec2 a_offset;
uniform vec4 u_domain;
uniform vec2 u_size;
uniform float u_width;
flat out vec2 v_lineStart;
flat out vec2 v_lineEnd;
flat out float v_valid;
bool finite(vec2 p){return !any(isnan(p))&&!any(isinf(p));}
vec2 project(vec2 p){return (p-u_domain.xy)/u_domain.zw*2.0-1.0;}
${relativeLineDirectionGLSL}
void main(){
  vec2 p=project(a_center),before=project(a_previous);
  v_lineStart=(before+1.)*.5*u_size;
  v_lineEnd=(p+1.)*.5*u_size;
  v_valid=finite(a_center)&&lineNeighbor(a_previous,lineDelta(a_center,a_previous))?1.:0.;
  gl_Position=finite(a_center)?vec4(p+a_offset,0.,1.):vec4(2.,2.,2.,1.);
}`;

export const relativeOffsetVertex = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec2 a_previous;
layout(location=1) in vec2 a_center;
layout(location=2) in vec2 a_next;
uniform vec4 u_domain;
uniform vec2 u_size;
uniform float u_width;
out vec4 v_offsets;
bool finite(vec2 p){return !any(isnan(p))&&!any(isinf(p));}
${relativeLineDirectionGLSL}
void main(){
  v_offsets=lineOffsets(a_previous,a_center,a_next);
  gl_Position=vec4(0.,0.,0.,1.);
}`;

type Pair = readonly [number, number];

/** Float64 geometry oracle for the existing miter/cap rule. It is independent
 * of the GPU cache and its raster output. Returned offsets are clip-space pairs
 * [left.x,left.y,right.x,right.y]; multiply by half the pixel size for pixels.
 * The oracle does not turn a pixel difference into an equivalence claim.
 */
export function lineDirectionOracle(previous: Pair, center: Pair, next: Pair, span: Pair, size: Pair, width: number): [number, number, number, number] {
  if (!center.every(Number.isFinite)) return [0, 0, 0, 0];
  if (![...span, ...size, width].every(Number.isFinite) || span.some(value => value === 0) || size.some(value => value <= 0) || width <= 0)
    throw new RangeError('Line geometry requires finite nonzero spans and positive pixel sizes');
  const delta = (a: Pair, b: Pair): [number, number] => [(a[0] - b[0]) * 2 * size[0] / span[0], (a[1] - b[1]) * 2 * size[1] / span[1]];
  const incoming = delta(center, previous), outgoing = delta(next, center);
  const incomingLength = Math.hypot(...incoming), outgoingLength = Math.hypot(...outgoing);
  const hasPrevious = previous.every(Number.isFinite) && incomingLength * incomingLength > 1e-10;
  const hasNext = next.every(Number.isFinite) && outgoingLength * outgoingLength > 1e-10;
  let a: [number, number] = hasPrevious ? [-incoming[1] / incomingLength, incoming[0] / incomingLength] : [0, 1];
  const b: [number, number] = hasNext ? [-outgoing[1] / outgoingLength, outgoing[0] / outgoingLength] : a;
  if (!hasPrevious) a = b;
  const sum: [number, number] = [a[0] + b[0], a[1] + b[1]], sumLength = Math.hypot(...sum);
  const miter = sumLength > 1e-5 ? [sum[0] / sumLength, sum[1] / sumLength] : a;
  const denominator = Math.max(.25, miter[0]! * a[0] + miter[1]! * a[1]);
  const mx = miter[0]! / denominator, my = miter[1]! / denominator;
  let cx = 0, cy = 0;
  if (!hasPrevious && hasNext) {cx -= outgoing[0] / outgoingLength; cy -= outgoing[1] / outgoingLength;}
  if (hasPrevious && !hasNext) {cx += incoming[0] / incomingLength; cy += incoming[1] / incomingLength;}
  const sx = (width + 2) / size[0], sy = (width + 2) / size[1];
  return [(-mx + cx) * sx, (-my + cy) * sy, (mx + cx) * sx, (my + cy) * sy];
}
