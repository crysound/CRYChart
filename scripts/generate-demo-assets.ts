import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'examples/data');
const seed = 20261109;
const generator = 'scripts/generate-demo-assets.ts';
const assets: Array<{file: string; bytes: number; sha256: string; kind: string; generator: string; seed: number}> = [];

async function save(file: string, data: Buffer | string) {
  const bytes = typeof data === 'string' ? Buffer.from(data) : data;
  await writeFile(resolve(output, file), bytes);
  assets.push({file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), kind: 'deterministic-synthetic-data', generator, seed});
}

async function pointCloud(file: string, count: number, rgb: boolean, point: (index: number) => [number, number, number]) {
  const bytes = Buffer.alloc(4 + count * (rgb ? 9 : 6));
  bytes.writeUInt32LE(count, 0);
  for (let index = 0; index < count; index++) {
    const values = point(index);
    for (let dimension = 0; dimension < 3; dimension++) bytes.writeInt16LE(Math.round(values[dimension]), 4 + (dimension * count + index) * 2);
    if (rgb) {
      const offset = 4 + count * 6;
      bytes[offset + index] = 45 + index % 63;
      bytes[offset + count + index] = 95 + index % 113;
      bytes[offset + count * 2 + index] = 25 + index % 57;
    }
  }
  await save(file, bytes);
}

await mkdir(output, {recursive: true});
await pointCloud('lidar-city-buildings.bin', 584308, false, index => {
  const building = index >> 11, face = (index >> 7) % 4, u = index % 128 / 127, v = (index >> 9) % 4 / 3;
  const cx = building % 17 * 1600 - 9600, cz = Math.floor(building / 17) * 1400 - 13000;
  const height = 1300 + building * 911 % 5700;
  return [cx + (face < 2 ? u * 800 : face === 2 ? 0 : 800), v * height, cz + (face < 2 ? face * 800 : u * 800)];
});
await pointCloud('lidar-city-vegetation.bin', 853604, true, index => {
  const tree = index >> 7, phase = index % 128, angle = phase * 2.399963229728653;
  const crown = (phase * 53 % 128) / 127, radius = (180 + tree % 120) * Math.sqrt(1 - crown * crown);
  return [tree * 173 % 28000 - 10000 + radius * Math.cos(angle), 300 + tree % 400 + crown * 1200, tree * 307 % 24000 - 13000 + radius * Math.sin(angle)];
});
await pointCloud('lidar-terrain.bin', 1139662, false, index => {
  if (index === 0) return [1661, -111, 5287];
  if (index === 1139661) return [5694, 1104, 9296];
  const u = index % 1024 / 1023, v = Math.floor(index / 1024) % 1113 / 1112;
  const elevation = Math.max(0, Math.min(1, .35 + .3 * Math.sin(u * Math.PI * 5) * Math.cos(v * Math.PI * 4) + .35 * v));
  return [1661 + u * 4033, -111 + elevation * 1215, 5287 + v * 4009];
});
const round = (value: number) => Math.round(value * 100) / 100;
const air = Array.from({length: 684}, (_, index) => ({
  datetime_utc: new Date(Date.UTC(2025, 0, 1) + index * 3600000).toISOString(),
  pm25: round(12 + 5 * Math.sin(index / 19) + 2 * Math.cos(index / 7)),
  no2: round(35 + 11 * Math.cos(index / 23) + 4 * Math.sin(index / 11)),
}));
await save('synthetic-air-quality.json', JSON.stringify(air) + '\n');
const spectrum = {kind: 'deterministic-synthetic-spectrum', sampleRate: 24000, bins: 308, channels: [0, 1].map(channel => Array.from({length: 308}, (_, bin) => round(-90 + 65 * Math.exp(-(((bin - 18 - channel * 12) / 6) ** 2)) + 14 * Math.exp(-(((bin - 80 - channel * 20) / 13) ** 2))))) };
await save('stereo-spectrum-demo.json', JSON.stringify(spectrum) + '\n');
await writeFile(resolve(output, '3d-data-provenance.json'), JSON.stringify({schemaVersion: 2, kind: 'deterministic-synthetic-data', generator, seed, description: 'Original procedural city surfaces, tree crowns, terrain, hourly demonstration measurements and stereo spectral peaks. These are illustrative data, not captured surveys or sensor recordings.', assets}, null, 2) + '\n');
console.log(JSON.stringify({assets: assets.length, bytes: assets.reduce((sum, asset) => sum + asset.bytes, 0), seed}));
