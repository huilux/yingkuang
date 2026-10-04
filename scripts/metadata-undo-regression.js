(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const root = document.querySelector('#root');
  [...root.querySelectorAll('[role="tab"]')].find(tab => tab.textContent.includes('水印')).click();
  await t.frame();
  root.querySelector('button[aria-label="选择图层 相机型号"]').click();
  await t.frame();
  const input = [...root.querySelectorAll('label')].find(label => label.textContent.includes('当前照片显示值')).querySelector('input');
  const original = input.value;
  t.change(input, 'Manual camera'); await t.frame();
  root.querySelector('button[aria-label="撤销"]').click(); await t.frame();
  t.assert(input.value === original, 'Undo did not restore original metadata display');
  root.querySelector('button[aria-label="重做"]').click(); await t.frame();
  t.assert(input.value === 'Manual camera', 'Redo lost manual metadata');
  root.querySelector('button[aria-label="撤销"]').click(); await t.frame();
  return { metadataUndo: true, metadataRedo: true };
})();
