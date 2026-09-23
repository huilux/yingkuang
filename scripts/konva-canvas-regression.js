(async () => {
  const tests = await import('/scripts/konva-test-utils.js');
  return { canvas: await tests.canvasCheck(), zoom: await tests.zoomCheck(), cache: await tests.cacheCheck(), drag: await tests.dragCheck(), editing: await tests.editingCheck() };
})();
