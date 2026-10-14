import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Check the distributed JPEG header without requiring an image tool in CI.
test('demo image is a compact baseline JPEG without private metadata', () => {
  const data = readFileSync(new URL('../public/demo.jpg', import.meta.url));
  assert.equal(data.readUInt16BE(0), 0xffd8);
  assert.ok(data.length <= 600 * 1024, 'Demo exceeds 600 KiB');
  let dimensions;
  let scan = false;
  for (let offset = 2; offset < data.length;) {
    assert.equal(data[offset], 0xff, 'Invalid JPEG marker');
    const marker = data[offset + 1];
    if (marker === 0xda) { scan = true; break; }
    const length = data.readUInt16BE(offset + 2);
    assert.ok(length >= 2 && offset + 2 + length <= data.length);
    // Permit JFIF only; reject EXIF/XMP, ICC, IPTC, MPF, and comments.
    assert.ok(!(marker >= 0xe1 && marker <= 0xef) && marker !== 0xfe,
      `Unexpected metadata marker ${marker.toString(16)}`);
    if (marker === 0xc0) dimensions = [data.readUInt16BE(offset + 7), data.readUInt16BE(offset + 5)];
    offset += 2 + length;
  }
  assert.ok(scan && dimensions, 'Expected baseline JPEG with dimensions');
  assert.ok(dimensions.every(value => value > 0 && value <= 1920));
  assert.equal(data.readUInt16BE(data.length - 2), 0xffd9);
});
