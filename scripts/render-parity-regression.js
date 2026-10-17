// Injected fixtures come from the actual Rust renderer, not copied JS formulas.
(async () => {
  const fixtures = __FIXTURES__;
  const libraryUrl=performance.getEntriesByType('resource').find(entry=>new URL(entry.name).pathname==='/src/font-library.ts').name;
  const fontLibrary=await import(libraryUrl);
  const { rasterize } = await import('/src/use-preview-backdrop.ts');
  async function compare(name, geometry, frame, sample) {
    const actual = await rasterize(fixtures.source, frame, geometry, new AbortController().signal);
    const ref = new Image(); ref.src = fixtures[name]; await ref.decode();
    const canvas = document.createElement('canvas'); canvas.width = actual.width; canvas.height = actual.height;
    const context = canvas.getContext('2d'); context.drawImage(ref, 0, 0, canvas.width, canvas.height);
    const a = actual.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const b = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0, max = 0, n = 0;
    for (let y = 0; y < canvas.height; y += 2) for (let x = 0; x < canvas.width; x += 2) {
      if (!sample(x, y)) continue;
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(a[(y * canvas.width + x) * 4 + c] - b[(y * canvas.width + x) * 4 + c]);
        sum += d; max = Math.max(max, d); n++;
      }
    }
    const result = { name, meanDifference: sum / n, maxDifference: max, samples: n };
    // WebKit quantizes its filter intermediates; allow a small bounded difference.
    if (!n || sum / n > 3 || max > 12) throw Error(JSON.stringify(result));
    return result;
  }
  const common = { color: '#ffffff', blur: 32, brightness: 75, radius: 0, shadow: 0 };
  const background = await compare('background', { width: 680, height: 580, photo: { x: 40, y: 40, width: 600, height: 400 } },
    { ...common, type: 'blur' }, (x, y) => x >= 80 && x < 600 && y >= 480 && y < 560);
  const shadow = await compare('shadow', { width: 680, height: 580, photo: { x: 80, y: 80, width: 520, height: 360 } },
    { ...common, type: 'solid', radius: 12, shadow: 40 }, (x, y) => x >= 80 && x < 600 && y >= 444 && y < 480);
  const strongShadow = await compare('strong_shadow', { width: 680, height: 580, photo: { x: 80, y: 80, width: 520, height: 360 } },
    { ...common, type: 'solid', radius: 12, shadow: 100 }, (x, y) => x >= 80 && x < 600 && y >= 444 && y < 540);
  const scaled = await compare('scaled_background', { width: 680, height: 580, photo: { x: 40, y: 40, width: 600, height: 400 } },
    { ...common, type: 'blur' }, (x, y) => x >= 80 && x < 600 && y >= 480 && y < 560);
  async function textBounds(name, rotation, fontFamily = 'LXGW WenKai TC, sans-serif', fontWeight = 400, textValue = '映框　50mm f/2.8', fontSize = 32, canvasWidth = 600, threshold = 16, opacity = 1) {
    const { ensureFontsLoaded, previewFontFamily } = fontLibrary;
    await ensureFontsLoaded([fontFamily]);
    await document.fonts.ready;
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:600px;height:400px';
    document.body.append(container);
    const stage = new window.Konva.Stage({ container, width: canvasWidth, height: 400 });
    const layer = new window.Konva.Layer();
    const {layoutWatermarkText,paintWatermarkText}=await import('/src/watermark-text.ts');
    const layout=layoutWatermarkText({fontFamily,fontSize,fontWeight},textValue);
    const node = new window.Konva.Text({ x: canvasWidth / 2, y: 200, text: textValue,
      fontFamily: previewFontFamily(fontFamily), fontSize, fontStyle: String(fontWeight), fill: '#000', rotation, opacity,
      width:layout.width,height:layout.height,sceneFunc:ctx=>paintWatermarkText(ctx,layout,'#000') });
    node.offset({ x: node.width() / 2, y: node.height() / 2 });
    layer.add(node); stage.add(layer); stage.draw();
    const preview = stage.toCanvas({ pixelRatio: 1 });
    const exported = new Image(); exported.src = fixtures[name]; await exported.decode();
    function alphaBounds(source,start=0,end=canvasWidth,opaque=false) {
      const canvas = document.createElement('canvas'); canvas.width = canvasWidth; canvas.height = 400;
      const context = canvas.getContext('2d'); context.drawImage(source, 0, 0);
      const pixels = context.getImageData(0, 0, canvasWidth, 400).data;
      let left = canvasWidth, top = 400, right = -1, bottom = -1;
      for (let y = 0; y < 400; y++) for (let x = Math.ceil(start); x < Math.floor(end); x++) {
        if (pixels[(y * canvasWidth + x) * 4 + (opaque ? 0 : 3)] <= threshold) continue;
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
      if (right < left || bottom < top) throw Error(`Missing ink: ${name}`);
      return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1,
        centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
    }
    const result = { name, preview: alphaBounds(preview), export: alphaBounds(exported) };
    if (textValue === '名字 ming 123' && fontSize === 48) {
      // Exercise the real thumbnail component, including logical geometry,
      // downscaling and JPEG encoding, alongside the Konva and Rust painters.
      const resource = path => performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname===path).name;
      const {default:React}=await import(resource('/node_modules/.vite/deps/react.js'));
      const {default:{createRoot}}=await import(resource('/node_modules/.vite/deps/react-dom_client.js'));
      const {TemplatePreview}=await import('/src/TemplatePreview.tsx');
      const {createDefaultDocument}=await import('/src/editor-model.ts');
      const {waitFor}=await import('/scripts/konva-test-utils.js');
      const source=document.createElement('canvas');source.width=600;source.height=400;source.getContext('2d').fillRect(0,0,600,400);
      const photo={id:'parity-card',path:'',fileName:'fixture.png',width:600,height:400,megapixels:.24,thumbnailDataUrl:source.toDataURL(),metadata:{}};
      const design=createDefaultDocument();design.frame.paddingX=0;design.frame.paddingY=0;
      for(const region of Object.values(design.regions)){region.enabled=false;region.extra=0;}
      delete design.distributions;delete design.alignments;
      design.layers=[{...design.layers[0],id:'signature',source:'custom',customValue:textValue,region:'canvas',x:.5,y:.5,fontFamily,fontWeight,fontSize:fontSize*2.5,rotation,color:'#fff',opacity,visible:true}];
      const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
      try{
        root.render(React.createElement(TemplatePreview,{template:{id:name,cover:photo.thumbnailDataUrl,layouts:{landscape:design}},photo}));
        await waitFor(()=>host.querySelector('img')?.complete,'Parity thumbnail missing');
        const card=document.createElement('canvas');card.width=600;card.height=400;
        card.getContext('2d').drawImage(host.querySelector('img'),0,0,600,400);
        result.thumbnail=alphaBounds(card,0,600,true);
        if(['left','top','right','bottom'].some(key=>Math.abs(result.thumbnail[key]-result.export[key])>3))throw Error(JSON.stringify(result));
      }finally{root.unmount();host.remove();}
    }
    if(textValue==='名字 ming 123' && rotation===0){
      const origin=300-layout.width/2;
      const prefix=value=>layoutWatermarkText({fontFamily,fontSize,fontWeight},value).width;
      const edges=[0,origin+prefix('名字 '),origin+prefix('名字 ming '),600];
      result.segmentCenters=edges.slice(0,-1).map((left,i)=>({preview:alphaBounds(preview,left,edges[i+1]).centerY,export:alphaBounds(exported,left,edges[i+1]).centerY}));
      if(result.segmentCenters.some(pair=>Math.abs(pair.preview-200)>1.5||Math.abs(pair.export-200)>1.5))throw Error(JSON.stringify(result));
    }
    if(name==='longcang_long') {
      const origin=canvasWidth/2-layout.width/2, edge=origin+layout.runs[1].x;
      result.segmentCenters=[alphaBounds(preview,origin,edge),alphaBounds(preview,edge,canvasWidth)].map(b=>b.centerY);
      result.exportSegmentCenters=[alphaBounds(exported,origin,edge),alphaBounds(exported,edge,canvasWidth)].map(b=>b.centerY);
      if([...result.segmentCenters,...result.exportSegmentCenters].some(y=>Math.abs(y-200)>1.5))throw Error(JSON.stringify(result));
    }
    stage.destroy(); container.remove();
    const widthError = Math.abs(result.preview.width - result.export.width);
    const heightError = Math.abs(result.preview.height - result.export.height);
    const centerError = Math.hypot(result.preview.centerX - result.export.centerX, result.preview.centerY - result.export.centerY);
    if (widthError > 4 || heightError > 4 || centerError > 3) throw Error(JSON.stringify({ ...result, widthError, heightError, centerError }));
    return result;
  }
  const text = await textBounds('text', 0);
  const textRotated = await textBounds('text_rotated', 90);
  const retiredSans = await textBounds('retired_sans', 0, 'DejaVu Sans, sans-serif');
  const systemMono = await textBounds('system_mono', 0, 'monospace');
  const manrope = await textBounds('manrope_mixed', 0, 'Manrope, LXGW WenKai TC, sans-serif');
  const manropeBold = await textBounds('manrope_bold', 0, 'Manrope, LXGW WenKai TC, sans-serif', 700);
  const serif = await textBounds('serif_mixed', 0, 'Cormorant Garamond, LXGW WenKai TC, serif', 600);
  const { importFont } = fontLibrary;
  const fontBytes = await (await fetch('/fonts/spacemono/SpaceMono-Regular.ttf')).arrayBuffer();
  const imported = await importFont(new File([fontBytes], 'SpaceMono.ttf'));
  const importedText = await textBounds('imported_mixed', 0, imported.value);
  const signatures=[];
  for(const [name,family] of [['allura_signature','Allura'],['cinzel_signature','Cinzel'],['sacramento_signature','Sacramento'],['cormorant_signature','Cormorant Garamond'],['longcang_signature','Long Cang'],['spacemono_signature','Space Mono']])signatures.push(await textBounds(name,0,family,400,'名字 ming 123',48));
  signatures.push(await textBounds('allura_signature_rotated',90,'Allura',400,'名字 ming 123',48));
  signatures.push(await textBounds('allura_signature_rotated_back',-90,'Allura',400,'名字 ming 123',48));
  signatures.push(await textBounds('allura_signature_translucent',0,'Allura',400,'名字 ming 123',48,600,16,.3));
  const edgeCases=[];
  for(const [name,family] of [['cinzel_alternating','Cinzel'],['allura_alternating','Allura'],['spacemono_alternating','Space Mono']])edgeCases.push(await textBounds(name,0,family,400,'A1'.repeat(12),32));
  edgeCases.push(await textBounds('allura_faint',0,'Allura',400,'.',8,600,0));
  edgeCases.push(await textBounds('longcang_long',0,'Long Cang',400,'名字'+'123'.repeat(100),80,9000));
  return { edgeCases, signatures, background, shadow, strongShadow, scaled, text, textRotated, retiredSans, systemMono, manrope, manropeBold, serif, importedText };
})();
