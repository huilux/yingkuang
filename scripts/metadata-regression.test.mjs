import test from 'node:test';
import assert from 'node:assert/strict';
import * as editorModel from '../src/editor-model.ts';

const photo = {
  id: 'metadata-regression',
  path: '/tmp/PANA.JPG',
  fileName: 'PANA.JPG',
  width: 6000,
  height: 4000,
  megapixels: 24,
  thumbnailDataUrl: '',
  metadata: {
    capturedAt: '2026:07:24 17:30:23',
    make: 'Panasonic',
    model: 'DC-S5M2',
    'exif:BodySerialNumber': 'ABC123',
  },
};

test('拍摄时间只格式化日期分隔符，保留时分秒冒号', () => {
  const layer = { source: 'capturedAt', name: '拍摄时间' };
  assert.equal(editorModel.resolveLayerText(layer, photo), '2026-07-24 17:30:23');
});

test('添加参数覆盖原型常用字段并说明元数据来源', () => {
  const options = editorModel.metadataOptionsForPhoto?.(photo);
  assert.ok(options, 'metadataOptionsForPhoto should expose photo-aware metadata choices');
  const expected = [
    'camera', 'make', 'model', 'lens', 'focalLength', 'aperture', 'shutter', 'iso',
    'capturedAt', 'capturedDate', 'capturedTime', 'exposureBias', 'whiteBalance',
    'meteringMode', 'exposureProgram', 'focalLength35mm', 'artist', 'copyright',
    'fileName', 'dimensions', 'exif:BodySerialNumber', 'custom',
  ];
  for (const source of expected) {
    const option = options.find(item => item.source === source);
    assert.ok(option, `missing metadata option: ${source}`);
    assert.ok(option.sourceLabel, `missing source label: ${source}`);
  }
  assert.match(
    options.find(item => item.source === 'camera').sourceLabel,
    /Make.*Model/,
  );
  assert.equal(
    options.find(item => item.source === 'exif:BodySerialNumber').sourceLabel,
    'EXIF BodySerialNumber',
  );
});

test('clearing a display value does not recover original metadata, including whitespace', () => {
  for (const value of ['', '   ']) {
    assert.equal(editorModel.resolveLayerText({ source: 'model', name: '型号' }, { ...photo, overrides: { model: value } }), '未读取到型号');
  }
});
