/** Records the WebGL boundary; it deliberately does not simulate shader pixels. */
export class RecordingLineGL {
  [name: string]: any;
  calls: { name: string; args: any[] }[] = [];
  created: { kind: string; id: number }[] = [];
  deleted = new Set<object>();
  failure?: string;
  throwOn?: string;
  lost = false;
  drawingBufferHeight = 600;
  pixelStore = new Map<number, number | boolean>();

  constructor() {
    const constants =
      "VERTEX_SHADER FRAGMENT_SHADER COMPILE_STATUS LINK_STATUS MAX_TEXTURE_SIZE TEXTURE0 TEXTURE_2D RG32F RG FLOAT TEXTURE_MIN_FILTER TEXTURE_MAG_FILTER TEXTURE_WRAP_S TEXTURE_WRAP_T NEAREST CLAMP_TO_EDGE UNPACK_ALIGNMENT UNPACK_ROW_LENGTH UNPACK_SKIP_PIXELS UNPACK_SKIP_ROWS UNPACK_FLIP_Y_WEBGL UNPACK_PREMULTIPLY_ALPHA_WEBGL SCISSOR_TEST BLEND SRC_ALPHA ONE_MINUS_SRC_ALPHA ONE CULL_FACE TRIANGLE_STRIP ARRAY_BUFFER DYNAMIC_COPY TRANSFORM_FEEDBACK TRANSFORM_FEEDBACK_BUFFER RASTERIZER_DISCARD POINTS INTERLEAVED_ATTRIBS";
    constants.split(" ").forEach((name, i) => {
      this[name] = i + 1;
    });
    [8, 7, 2, 3, true, true].forEach((value, i) => {
      this.pixelStore.set(this.UNPACK_ALIGNMENT + i, value);
    });
    for (const name of [
      "shaderSource",
      "compileShader",
      "attachShader",
      "linkProgram",
      "transformFeedbackVaryings",
      "bindTexture",
      "activeTexture",
      "texStorage2D",
      "texParameteri",
      "viewport",
      "scissor",
      "enable",
      "disable",
      "blendFuncSeparate",
      "useProgram",
      "bindVertexArray",
      "uniform4f",
      "uniform2f",
      "uniform1f",
      "uniform4fv",
      "uniform1i",
      "bindBuffer",
      "bufferData",
      "enableVertexAttribArray",
      "vertexAttribDivisor",
      "vertexAttribPointer",
      "bindTransformFeedback",
      "bindBufferRange",
      "bindBufferBase",
      "endTransformFeedback",
    ]) {
      this[name] = (...args: any[]) => this.record(name, ...args);
    }
  }
  of(name: string) {
    return this.calls
      .filter((call) => call.name === name)
      .map((call) => call.args);
  }
  private record(name: string, ...args: any[]) {
    this.calls.push({ name, args });
    if (this.throwOn === name) throw new Error(`Injected ${name} failure`);
  }
  private allocate(kind: string, method: string) {
    this.record(method);
    if (this.failure === method) return null;
    const value = { kind, id: this.created.length + 1 };
    this.created.push(value);
    return value;
  }
  createProgram() {
    return this.allocate("program", "createProgram");
  }
  createShader() {
    return this.allocate("shader", "createShader");
  }
  createVertexArray() {
    return this.allocate("vao", "createVertexArray");
  }
  createTransformFeedback() {
    return this.allocate("feedback", "createTransformFeedback");
  }
  createBuffer() {
    return this.allocate("buffer", "createBuffer");
  }
  createTexture() {
    return this.allocate("texture", "createTexture");
  }
  deleteProgram(value: object) {
    this.deleted.add(value);
    this.record("deleteProgram", value);
  }
  deleteShader(value: object) {
    this.deleted.add(value);
    this.record("deleteShader", value);
  }
  deleteVertexArray(value: object) {
    this.deleted.add(value);
    this.record("deleteVertexArray", value);
  }
  deleteTransformFeedback(value: object) {
    this.deleted.add(value);
    this.record("deleteTransformFeedback", value);
  }
  deleteBuffer(value: object) {
    this.deleted.add(value);
    this.record("deleteBuffer", value);
  }
  deleteTexture(value: object) {
    this.deleted.add(value);
    this.record("deleteTexture", value);
  }
  getShaderParameter() {
    return this.failure !== "compile";
  }
  getProgramParameter() {
    return this.failure !== "link";
  }
  getShaderInfoLog() {
    return null;
  }
  getProgramInfoLog() {
    return null;
  }
  getUniformLocation(_program: object, name: string) {
    return { name };
  }
  getParameter(name: number) {
    return name === this.MAX_TEXTURE_SIZE ? 4 : this.pixelStore.get(name);
  }
  pixelStorei(name: number, value: number | boolean) {
    this.pixelStore.set(name, value);
  }
  isContextLost() {
    return this.lost;
  }
  texSubImage2D(...args: any[]) {
    this.record("texSubImage2D", ...args.slice(0, -1), args.at(-1).slice());
  }
  drawArrays(...args: any[]) {
    this.record("drawArrays", ...args);
  }
  beginTransformFeedback(...args: any[]) {
    this.record("beginTransformFeedback", ...args);
  }
}
