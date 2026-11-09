// This isolated diagnostic page measures WebGL buffer allocation calls. These
// counters exclude textures, driver overhead and process RSS; they are not a
// benchmark and are deliberately absent from the chart library.
type Entry = {
  buffers: Map<WebGLBuffer, number>;
  created: number;
  deleted: number;
};
const contexts = new WeakMap<WebGL2RenderingContext, Entry>();
const entry = (gl: WebGL2RenderingContext) => {
  let value = contexts.get(gl);
  if (!value) {
    value = { buffers: new Map(), created: 0, deleted: 0 };
    contexts.set(gl, value);
  }
  return value;
};
export function installGpuMeter() {
  const proto = WebGL2RenderingContext.prototype,
    create = proto.createBuffer,
    remove = proto.deleteBuffer,
    allocate = proto.bufferData;
  proto.createBuffer = function () {
    const buffer = create.call(this);
    if (buffer) {
      const e = entry(this);
      e.created++;
      e.buffers.set(buffer, 0);
    }
    return buffer;
  };
  proto.deleteBuffer = function (buffer: WebGLBuffer | null) {
    if (buffer) {
      const e = entry(this);
      if (e.buffers.delete(buffer)) e.deleted++;
    }
    remove.call(this, buffer);
  };
  proto.bufferData = function (
    this: WebGL2RenderingContext,
    ...args: Parameters<WebGL2RenderingContext["bufferData"]>
  ) {
    Reflect.apply(allocate, this, args);
    const target = args[0];
    const binding =
      target === this.ARRAY_BUFFER
        ? this.ARRAY_BUFFER_BINDING
        : target === this.ELEMENT_ARRAY_BUFFER
          ? this.ELEMENT_ARRAY_BUFFER_BINDING
          : target === this.COPY_READ_BUFFER
            ? this.COPY_READ_BUFFER_BINDING
            : target === this.COPY_WRITE_BUFFER
              ? this.COPY_WRITE_BUFFER_BINDING
              : target === this.PIXEL_PACK_BUFFER
                ? this.PIXEL_PACK_BUFFER_BINDING
                : target === this.PIXEL_UNPACK_BUFFER
                  ? this.PIXEL_UNPACK_BUFFER_BINDING
                  : target === this.TRANSFORM_FEEDBACK_BUFFER
                    ? this.TRANSFORM_FEEDBACK_BUFFER_BINDING
                    : target === this.UNIFORM_BUFFER
                      ? this.UNIFORM_BUFFER_BINDING
                      : undefined;
    if (binding === undefined) return;
    const buffer = this.getParameter(binding) as WebGLBuffer | null;
    if (buffer)
      entry(this).buffers.set(
        buffer,
        this.getBufferParameter(target, this.BUFFER_SIZE),
      );
  } as WebGL2RenderingContext["bufferData"];
}
export function getGpuBufferStats(
  gl: WebGL2RenderingContext | undefined | null,
) {
  if (!gl) return { created: 0, deleted: 0, liveBuffers: 0, allocatedBytes: 0 };
  const e = entry(gl);
  return {
    created: e.created,
    deleted: e.deleted,
    liveBuffers: e.buffers.size,
    allocatedBytes: [...e.buffers.values()].reduce((a, b) => a + b, 0),
  };
}
