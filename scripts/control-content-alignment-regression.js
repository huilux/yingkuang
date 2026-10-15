// Measure visible glyphs rather than only the surrounding control boxes.
(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  await document.fonts.ready;
  const root = document.querySelector('#root');
  const failures = [];
  const measurements = [];
  for (const label of ['导出当前', '批量导出']) {
    const button = [...root.querySelectorAll('.header-actions .button')].find(button => button.textContent.trim() === label);
    const text = [...button.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    const range = document.createRange(); range.selectNodeContents(text);
    const textBox = range.getBoundingClientRect(), box = button.getBoundingClientRect();
    const icon = button.querySelector('svg').getBoundingClientRect();
    const style = getComputedStyle(button), context = document.createElement('canvas').getContext('2d');
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const metrics = context.measureText(label);
    const inkCenter = textBox.top + metrics.fontBoundingBoxAscent + (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) / 2;
    const center = box.top + box.height / 2;
    const offset = inkCenter - center;
    measurements.push({label, glyphOffset: offset, iconOffset: icon.top + icon.height / 2 - center});
    // Font metrics can round the ink baseline to half a CSS pixel. The
    // unmodified beta.1 also measures 0.5px with the Linux CJK fallback font.
    if (Math.abs(offset) > .5 + 1e-6) failures.push(`${label}中文字形偏移 ${offset}px`);
    t.near(icon.top + icon.height / 2, center, `${label} icon not centered`, .3);
    const contentLeft = Math.min(textBox.left, icon.left), contentRight = Math.max(textBox.right, icon.right);
    t.near((contentLeft + contentRight) / 2, box.left + box.width / 2, `${label} content not horizontally centered`, .5);
  }
  [...root.querySelectorAll('.header-actions .button')].find(button => button.textContent.trim() === '导出当前').click(); await t.frame();
  const size = root.querySelector('.export-dialog select[aria-label="成品尺寸"]'), savedSize = size.value;
  size.value = 'long-edge'; size.dispatchEvent(new Event('change', {bubbles:true})); await t.frame();
  for (const label of root.querySelectorAll('.export-dialog .check-field')) {
    const input = label.querySelector('input'), title = label.querySelector('strong') ?? label.querySelector('span');
    const inputBox = input.getBoundingClientRect(), titleBox = title.getBoundingClientRect();
    const offset = inputBox.top + inputBox.height / 2 - titleBox.top - titleBox.height / 2;
    const name = title.textContent.trim();
    measurements.push({label:name, checkboxOffset:offset, fontSize:getComputedStyle(title).fontSize});
    if (Math.abs(offset) > .5) failures.push(`${name}复选框与首行文字偏移 ${offset}px`);
    if (getComputedStyle(title).fontSize !== '12px') failures.push(`${name}字号不一致`);
  }
  size.value = savedSize; size.dispatchEvent(new Event('change', {bubbles:true})); await t.frame();
  root.querySelector('.export-dialog button[aria-label="关闭"]').click(); await t.frame();
  if (failures.length) throw new Error(JSON.stringify({measurements, failures}));
  return {measurements, centeredGlyphs:true, checkboxFirstLinesAligned:true};
})();
