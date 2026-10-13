// Reproduce live number changes and a stationary crop frame through the real dialog.
(async () => {
  const t=await import('/scripts/konva-test-utils.js');
  const moduleUrl=name=>performance.getEntriesByType('resource').find(e=>e.name.includes(`/deps/${name}.js?`)).name;
  const {default:React}=await import(moduleUrl('react'));
  const {default:{createRoot}}=await import(moduleUrl('react-dom_client'));
  const {default:CropEditor}=await import('/src/CropEditor.tsx');
  const {cropPixels}=await import('/src/photo-crop.ts');
  const {rotatedPhotoBitmap}=await import('/src/photo-transform.ts');
  const source=document.createElement('canvas'); source.width=600; source.height=400;
  const c=source.getContext('2d'); c.fillStyle='#f02010'; c.fillRect(0,0,300,400); c.fillStyle='#1030f0'; c.fillRect(300,0,300,400);
  const photo={id:'rotation-interaction',path:'',fileName:'rotation.png',width:600,height:400,thumbnailDataUrl:source.toDataURL(),metadata:{},crop:{x:.2,y:.2,width:.5,height:.5}};
  const host=document.createElement('div'); host.style.cssText='position:fixed;inset:0;z-index:2000'; document.body.append(host);
  const root=createRoot(host);
  const field=label=>host.querySelector(`input[aria-label="${label}"]`);
  const selection=()=>{const r=host.querySelector('.crop-selection').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
  const bitmap=()=>{const c=host.querySelector('.crop-photo-surface canvas');return Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data).join(',');};
  const failures=[];
  let applied;
  try {
    root.render(React.createElement(CropEditor,{photo,onApply:crop=>{applied=crop;},onCancel:()=>{}}));
    await t.waitFor(()=>field('水平校正角度') && host.querySelector('.crop-photo-surface canvas').width===600 && host.querySelector('.crop-photo-surface canvas').height===400,'Dialog photo failed to paint'); await t.frame();
    const angle=field('水平校正角度'), before=bitmap(); angle.focus(); t.change(angle,12.5); await t.frame();
    if(Number(field('水平校正滑块').value)!==12.5 || bitmap()===before) failures.push('Angle number input does not rotate the image until blur/click');
    angle.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})); await t.frame();
    t.assert(Number(field('水平校正滑块').value)===0 && bitmap()===before,'Escape failed to undo live number preview');
    angle.focus(); t.change(angle,12.5); await t.frame();
    angle.blur(); await t.frame();
    const frame=selection(), slider=field('水平校正滑块'); slider.focus();
    for(const value of [20,-15,30,12.5]) {
      t.change(slider,value); await t.frame(); const now=selection();
      if(Object.keys(frame).some(k=>Math.abs(frame[k]-now[k])>.6)) {failures.push(`Crop frame moves/resizes while rotating: ${JSON.stringify({before:frame,after:now,angle:value})}`); break;}
    }
    t.assert(!failures.length,failures.join('\n'));
    // Zoom must stay under user control throughout an angle edit.
    host.querySelector('[aria-label="放大裁切视图"]').click(); await t.frame();
    const zoomed=selection(); slider.focus();
    for(const value of [-45,45,0,12.5]) {
      t.change(slider,value); await t.frame(); const now=selection();
      for(const key of Object.keys(zoomed)) t.near(now[key],zoomed[key],`Rotation reset zoom or moved crop ${key}`,.1);
    }
    // Invalid/incomplete drafts are safe, and blur restores the angle at focus.
    angle.focus(); t.change(angle,7.5); await t.frame(); t.change(angle,''); await t.frame(); angle.blur(); await t.frame();
    t.near(Number(slider.value),12.5,'Invalid input retained an unintended preview',.001);
    // The selected pixels after Apply must match the pixels shown inside the fixed frame.
    const dialogBitmap=host.querySelector('.crop-photo-surface canvas');
    const readout=[Number(field('选区宽度').value),Number(field('选区高度').value)];
    [...host.querySelectorAll('button')].find(b=>b.textContent.trim()==='应用调整').click(); await t.frame();
    const output=cropPixels({...photo,crop:applied});
    t.assert(output.width===readout[0] && output.height===readout[1],'Applied crop ignored actual output dimensions');
    const rotated=rotatedPhotoBitmap(source,photo.width,photo.height,applied.rotation);
    const final=document.createElement('canvas'); final.width=300; final.height=200;
    const finalContext=final.getContext('2d'); finalContext.drawImage(rotated,output.x,output.y,output.width,output.height,0,0,300,200);
    const previewContext=dialogBitmap.getContext('2d');
    for(const x of [.15,.5,.85]) for(const y of [.15,.5,.85]) {
      const a=previewContext.getImageData(Math.floor(120+x*300),Math.floor(80+y*200),1,1).data;
      const b=finalContext.getImageData(Math.floor(x*300),Math.floor(y*200),1,1).data;
      for(let channel=0;channel<4;channel++) t.near(a[channel],b[channel],'Applied image differs from fixed frame preview',8);
    }
    const saved={...applied};
    root.render(React.createElement(CropEditor,{key:'reopened',photo:{...photo,crop:saved},onApply:crop=>{applied=crop;},onCancel:()=>{}})); await t.frame();
    [...host.querySelectorAll('button')].find(b=>b.textContent.trim()==='应用调整').click(); await t.frame();
    t.assert(JSON.stringify(applied)===JSON.stringify(saved),'Reopening and applying changed the crop');
    // Locked crop ratios remain stable throughout straightening as well.
    host.querySelector('[aria-label="裁切比例"]').click(); await t.frame();
    [...host.querySelectorAll('[role=option]')].find(o=>o.textContent.trim()==='1:1').click(); await t.frame();
    const locked=selection(), range=field('水平校正滑块'); range.focus();
    for(const value of [-20,30,0]) {
      t.change(range,value); await t.frame(); const now=selection();
      for(const key of Object.keys(locked)) t.near(now[key],locked[key],`Rotation changed locked crop ${key}`,.1);
      t.near(Number(field('选区宽度').value),Number(field('选区高度').value),'Rotation broke square output',1);
    }
    return {liveAngleWhileFocused:true,stationaryCropFrame:true,escapeRestoresPreview:true,invalidInputSafe:true,zoomPreserved:true,appliedPixelsMatchPreview:true,reopenPreservesCrop:true,lockedRatio:true};
  } finally {root.unmount();host.remove();}
})();
