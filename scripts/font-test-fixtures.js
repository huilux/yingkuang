// Derive a valid imported-font fixture from the licensed offline font instead
// of committing another binary. Preserve the original Latin glyph IDs.
export function unicodeCmap6Font(source) {
  const original = new DataView(source);
  let cmapEntry, cmap, head;
  for (let i = 0; i < original.getUint16(4); i++) {
    const entry = 12 + 16 * i, tag = original.getUint32(entry);
    if (tag === 0x636d6170) { cmapEntry = entry; cmap = original.getUint32(entry + 8); }
    if (tag === 0x68656164) head = original.getUint32(entry + 8);
  }
  let format4;
  for (let i = 0; i < original.getUint16(cmap + 2); i++) {
    const offset = cmap + original.getUint32(cmap + 8 + i * 8);
    if (original.getUint16(offset) === 4) { format4 = offset; break; }
  }
  if (format4 === undefined) throw Error('Fixture source needs a BMP cmap');
  const segments = original.getUint16(format4 + 6) / 2;
  const ends = format4 + 14, starts = ends + 2 * segments + 2;
  const deltas = starts + 2 * segments, ranges = deltas + 2 * segments;
  function glyph(code) {
    for (let i = 0; i < segments; i++) {
      if (code > original.getUint16(ends + 2 * i)) continue;
      if (code < original.getUint16(starts + 2 * i)) return 0;
      const delta = original.getInt16(deltas + 2 * i), range = original.getUint16(ranges + 2 * i);
      if (!range) return (code + delta) & 0xffff;
      const id = original.getUint16(ranges + 2 * i + range + 2 * (code - original.getUint16(starts + 2 * i)));
      return id ? (id + delta) & 0xffff : 0;
    }
    return 0;
  }
  const offset = Math.ceil(source.byteLength / 4) * 4, length = 12 + 10 + 256 * 2;
  const bytes = new ArrayBuffer(offset + Math.ceil(length / 4) * 4), data = new DataView(bytes);
  new Uint8Array(bytes).set(new Uint8Array(source));
  data.setUint16(offset + 2, 1); data.setUint16(offset + 4, 3); data.setUint16(offset + 6, 1); data.setUint32(offset + 8, 12);
  data.setUint16(offset + 12, 6); data.setUint16(offset + 14, length - 12); data.setUint16(offset + 20, 256);
  for (let code = 0; code < 256; code++) data.setUint16(offset + 22 + code * 2, glyph(code));
  const checksum = (start, size) => {
    let sum = 0;
    for (let i = start; i < start + size; i += 4) sum = (sum + data.getUint32(i)) >>> 0;
    return sum;
  };
  data.setUint32(cmapEntry + 4, checksum(offset, Math.ceil(length / 4) * 4));
  data.setUint32(cmapEntry + 8, offset); data.setUint32(cmapEntry + 12, length);
  data.setUint32(head + 8, 0);
  data.setUint32(head + 8, (0xb1b0afba - checksum(0, bytes.byteLength)) >>> 0);
  return bytes;
}
