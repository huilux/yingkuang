(async () => {
  const slider = document.querySelector('input[aria-label="画布缩放"]');
  const viewport = document.querySelector('.canvas-viewport');
  const canvas = document.querySelector('.design-canvas');
  const scale = document.querySelector('.preview-scale');
  if (!(slider instanceof HTMLInputElement) || !viewport || !canvas || !scale) {
    throw new Error('画布回归检查找不到必需元素');
  }

  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  ).set;
  setValue.call(slider, '40');
  slider.dispatchEvent(new Event('change', { bubbles: true }));
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const viewportRect = viewport.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const canvasStyle = getComputedStyle(canvas);
  const scaleStyle = getComputedStyle(scale);
  const centerDelta = {
    x: canvasRect.left + canvasRect.width / 2 - (viewportRect.left + viewport.clientWidth / 2),
    y: canvasRect.top + canvasRect.height / 2 - (viewportRect.top + viewport.clientHeight / 2),
  };
  const currentExport = [...document.querySelectorAll('button')]
    .some((button) => button.textContent.includes('导出当前'));
  const failures = [];
  if (canvasStyle.overflowX !== 'hidden' || canvasStyle.overflowY !== 'hidden') {
    failures.push(`画布未裁切：${canvasStyle.overflowX}/${canvasStyle.overflowY}`);
  }
  if (scaleStyle.transitionProperty.includes('width') && scaleStyle.transitionDuration !== '0s') {
    failures.push(`缩放仍有宽度动画：${scaleStyle.transitionDuration}`);
  }
  if (Math.abs(centerDelta.x) > 2 || Math.abs(centerDelta.y) > 2) {
    failures.push(`画布未居中：x=${centerDelta.x.toFixed(1)}, y=${centerDelta.y.toFixed(1)}`);
  }
  if (!currentExport) failures.push('缺少“导出当前照片”入口');

  let zoomMutations = 0;
  const observer = new MutationObserver((records) => {
    zoomMutations += records.filter((record) => record.attributeName === 'style').length;
  });
  observer.observe(scale, { attributes: true, attributeFilter: ['style'] });
  for (let index = 0; index < 24; index += 1) {
    viewport.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100,
    }));
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  observer.disconnect();
  // One React commit writes the three inline preview style properties.
  if (zoomMutations > 3) failures.push(`一组滚轮事件触发了 ${zoomMutations} 次缩放样式写入`);

  viewport.scrollLeft = 0;
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const zoomedCanvasRect = canvas.getBoundingClientRect();
  const leftReachable = zoomedCanvasRect.left >= viewportRect.left - 1;
  if (!leftReachable) failures.push(`放大后画布左边不可达：left=${zoomedCanvasRect.left.toFixed(1)}`);

  const report = {
    centerDelta,
    overflow: `${canvasStyle.overflowX}/${canvasStyle.overflowY}`,
    transition: `${scaleStyle.transitionProperty} ${scaleStyle.transitionDuration}`,
    currentExport,
    zoomMutations,
    leftReachable,
    zoomedScrollWidth: viewport.scrollWidth,
    failures,
  };
  if (failures.length) throw new Error(JSON.stringify(report));
  return report;
})();
