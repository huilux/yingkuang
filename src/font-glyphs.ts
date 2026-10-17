/** Read Unicode cmap coverage without depending on system font fallback. */
export function fontGlyphCoverage(bytes: ArrayBuffer): (character: string) => boolean {
  const data = new DataView(bytes);
  const valid = (offset: number, length: number) => offset >= 0 && offset + length <= data.byteLength;
  if (!valid(0, 12)) throw new Error("字体字形索引不完整");
  let cmap = -1, cmapEnd = 0;
  for (let i = 0; i < data.getUint16(4); i++) {
    const entry = 12 + i * 16;
    if (!valid(entry, 16)) throw new Error("字体字形索引不完整");
    if (data.getUint32(entry) === 0x636d6170) {
      const offset = data.getUint32(entry + 8), length = data.getUint32(entry + 12);
      if (valid(offset, length) && length >= 4) { cmap = offset; cmapEnd = offset + length; }
    }
  }
  if (cmap < 0) throw new Error("字体缺少 Unicode 字形索引");
  const tables: ((code: number) => boolean)[] = [];
  const inCmap = (offset: number, length: number) => offset >= cmap && length >= 0 && offset + length <= cmapEnd;
  const count = data.getUint16(cmap + 2);
  for (let i = 0; i < count; i++) {
    const entry = cmap + 4 + i * 8;
    if (!inCmap(entry, 8)) throw new Error("字体字形索引不完整");
    const platform = data.getUint16(entry), encoding = data.getUint16(entry + 2);
    if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue;
    const offset = cmap + data.getUint32(entry + 4);
    if (!inCmap(offset, 2)) continue;
    const format = data.getUint16(offset);
    if (format === 0 && inCmap(offset, 262) && data.getUint16(offset + 2) >= 262 && inCmap(offset, data.getUint16(offset + 2))) {
      tables.push(code => code < 256 && data.getUint8(offset + 6 + code) !== 0);
    } else if (format === 2 && inCmap(offset, 526)) {
      const length = data.getUint16(offset + 2);
      if (!inCmap(offset, length) || length < 526) continue;
      tables.push(code => {
        if (code > 0xffff) return false;
        const high = code >>> 8, low = code & 255;
        const key = data.getUint16(offset + 6 + high * 2);
        if ((high !== 0 && key === 0) || key % 8 !== 0) return false;
        const header = offset + 518 + key;
        if (header + 8 > offset + length) return false;
        const first = data.getUint16(header), count = data.getUint16(header + 2);
        if (low < first || low - first >= count) return false;
        const address = header + 6 + data.getUint16(header + 6) + (low - first) * 2;
        if (address < offset || address + 2 > offset + length) return false;
        const glyph = data.getUint16(address);
        return glyph !== 0 && ((glyph + data.getInt16(header + 4)) & 0xffff) !== 0;
      });
    } else if (format === 6 && inCmap(offset, 10)) {
      const length = data.getUint16(offset + 2), first = data.getUint16(offset + 6), count = data.getUint16(offset + 8);
      if (!inCmap(offset, length) || 10 + count * 2 > length || first + count > 0x10000) continue;
      tables.push(code => code >= first && code - first < count && data.getUint16(offset + 10 + (code - first) * 2) !== 0);
    } else if (format === 10 && inCmap(offset, 20)) {
      const length = data.getUint32(offset + 4), first = data.getUint32(offset + 12), count = data.getUint32(offset + 16);
      if (!inCmap(offset, length) || 20 + count * 2 > length || first + count > 0x110000) continue;
      tables.push(code => code >= first && code - first < count && data.getUint16(offset + 20 + (code - first) * 2) !== 0);
    } else if (format === 4 && inCmap(offset, 14)) {
      const length = data.getUint16(offset + 2), segments = data.getUint16(offset + 6) / 2;
      if (!inCmap(offset, length) || !Number.isInteger(segments) || segments < 1 || 16 + segments * 8 > length) continue;
      const ends = offset + 14, starts = ends + segments * 2 + 2;
      const deltas = starts + segments * 2, ranges = deltas + segments * 2;
      tables.push(code => {
        if (code > 0xffff) return false;
        let low = 0, high = segments;
        while (low < high) { const middle = (low + high) >>> 1; if (data.getUint16(ends + middle * 2) < code) low = middle + 1; else high = middle; }
        if (low === segments || code < data.getUint16(starts + low * 2)) return false;
        const range = data.getUint16(ranges + low * 2), delta = data.getInt16(deltas + low * 2);
        if (!range) return ((code + delta) & 0xffff) !== 0;
        const address = ranges + low * 2 + range + (code - data.getUint16(starts + low * 2)) * 2;
        if (address < offset || address + 2 > offset + length) return false;
        const glyph = data.getUint16(address);
        return glyph !== 0 && ((glyph + delta) & 0xffff) !== 0;
      });
    } else if ((format === 12 || format === 13) && inCmap(offset, 16)) {
      const length = data.getUint32(offset + 4), groups = data.getUint32(offset + 12);
      if (!inCmap(offset, length) || 16 + groups * 12 > length) continue;
      tables.push(code => {
        let low = 0, high = groups;
        while (low < high) { const middle = (low + high) >>> 1; if (data.getUint32(offset + 16 + middle * 12 + 4) < code) low = middle + 1; else high = middle; }
        if (low === groups) return false;
        const group = offset + 16 + low * 12, first = data.getUint32(group);
        if (code < first) return false;
        const glyph = data.getUint32(group + 8);
        return (format === 13 ? glyph : glyph + code - first) !== 0;
      });
    }
  }
  if (!tables.length) throw new Error("字体缺少可用的 Unicode 字形索引");
  return character => { const code = character.codePointAt(0); return code !== undefined && tables.some(has => has(code)); };
}
