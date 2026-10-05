(async () => {
 const t = await import('/scripts/konva-test-utils.js');
 const ctx = await t.context();
 document.getElementById('tab-watermark').click(); await t.frame();
 const node = ctx.world.findOne('.watermark-layer');
 await t.zoom(ctx,100); await t.centerNode(ctx,node);
 const point=t.screen(ctx,node); t.mouse(ctx.content,'mousedown',point); t.mouse(window,'mouseup',point,0); await t.frame();
 const before = {x:node.x(),y:node.y()};
 const tab = document.getElementById('tab-watermark'); tab.focus();
 tab.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
 await t.frame();
 t.assert(document.getElementById('tab-template').getAttribute('aria-selected') === 'true','Tab did not change');
 t.near(node.x(),before.x,'Tab navigation moved selected watermark',.001);
 t.near(node.y(),before.y,'Tab navigation moved selected watermark vertically',.001);
 document.getElementById('tab-watermark').click(); await t.frame();
 for (const axis of ['X','Y']) {
  const input=document.querySelector(`input[aria-label="${axis} 坐标"]`);
  const oldValue=input.value;
  for (const invalid of ['1e308','-1e308']) {
   input.focus();t.change(input,invalid);await t.frame();input.blur();await t.frame();
   t.assert(input.value === oldValue,`Unsupported ${axis} coordinate entered the document`);
  }
 }
 t.near(node.x(),before.x,'Unsupported coordinate moved the watermark',.001);
 t.near(node.y(),before.y,'Unsupported coordinate moved the watermark vertically',.001);
 const input=document.querySelector('input[aria-label="X 坐标"]');
 input.focus();t.change(input,-25);await t.frame();input.blur();await t.frame();
 t.assert(Number(input.value) === -25,'Valid off-canvas coordinate was rejected');
 document.querySelector('button[aria-label="撤销"]').click();await t.frame();
 t.near(node.x(),before.x,'Off-canvas coordinate undo failed',.001);
 ctx.viewport.focus();
 ctx.viewport.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true})); await t.frame();
 t.near(node.x(),before.x+1,'Canvas keyboard nudge stopped working',.001);
 document.querySelector('button[aria-label="撤销"]').click(); await t.frame();
 t.near(node.x(),before.x,'Canvas nudge undo failed',.001);
 await t.fit(ctx);
 return {tabNavigationPreservedPosition:true,unsupportedCoordinateRejected:true,canvasNudgeAndUndo:true};
})()
