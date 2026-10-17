(async()=>{
  const t=await import('/scripts/konva-test-utils.js');
  const url=name=>performance.getEntriesByType('resource').find(entry=>entry.name.includes(`/deps/${name}.js?`)).name;
  const {default:React}=await import(url('react'));
  const {default:{createRoot}}=await import(url('react-dom_client'));
  const {EditorCanvas}=await import('/src/EditorCanvas.tsx');
  const {createDefaultDocument}=await import('/src/editor-model.ts');
  const libraryUrl=performance.getEntriesByType('resource').find(entry=>new URL(entry.name).pathname==='/src/font-library.ts').name;
  const {ensureFontsLoaded,builtinFonts}=await import(libraryUrl);
  const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;z-index:9000';document.body.append(host);
  const root=createRoot(host),results=[];
  function bounds(canvas,start=0,end=canvas.width){
    const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let top=canvas.height,bottom=-1,left=canvas.width,right=-1;
    for(let y=0;y<canvas.height;y++)for(let x=Math.ceil(start);x<Math.floor(end);x++)if(data[(y*canvas.width+x)*4+3]>32){top=Math.min(top,y);bottom=Math.max(bottom,y);left=Math.min(left,x);right=Math.max(right,x);}
    return {left,top,right,bottom,centerX:(left+right+1)/2,centerY:(top+bottom+1)/2};
  }
  try{
    const photo={id:'font-alignment',path:'',fileName:'fixture.jpg',width:1000,height:700,megapixels:.7,thumbnailDataUrl:'/demo.jpg',metadata:{}};
    for(const family of ['Allura','Cinzel','Sacramento','Cormorant Garamond','Long Cang','Space Mono']){
      const font=builtinFonts.find(font=>font.family===family);
      await ensureFontsLoaded([font.value]);
      for(const text of ['名字','名字 ming','名字 ming 123','名字ming123']){
        const design=createDefaultDocument();design.frame.paddingX=0;design.frame.paddingY=0;
        design.layers=[{...design.layers[0],id:'signature',name:'签名',source:'custom',customValue:text,region:'canvas',x:.5,y:.5,fontFamily:font.value,fontSize:80,color:'#fff',opacity:1,rotation:0,visible:true}];
        delete design.distributions;delete design.alignments;
        root.render(React.createElement(EditorCanvas,{photo,document:design,selectedLayerIds:['signature'],snapEnabled:false,onZoomChange(){},onSelectionChange(){},onLayersCommit(){}}));
        const ctx=await t.context(host);await t.frame();
        const node=ctx.world.findOne('#signature');
        await t.waitFor(()=>node.findOne('Text')?.text()===text,'Text not ready');
        const canvas=node.toCanvas({x:node.x()-400,y:node.y()-150,width:800,height:300,pixelRatio:1});
        const ink=bounds(canvas);
        const entry={family,text,...ink,centerOffset:ink.centerY-150};
        if(text==='名字 ming 123'){
          const {layoutWatermarkText}=await import('/src/watermark-text.ts');
          const layer=design.layers[0],layout=layoutWatermarkText(layer,text),origin=400-layout.width/2;
          const split1=origin+layoutWatermarkText(layer,'名字 ').width;
          const split2=origin+layoutWatermarkText(layer,'名字 ming ').width;
          const centers=[bounds(canvas,0,split1).centerY,bounds(canvas,split1,split2).centerY,bounds(canvas,split2,canvas.width).centerY];
          entry.segmentCenters=centers;
          entry.mixedCenterDifference=Math.max(...centers)-Math.min(...centers);
          t.assert(entry.mixedCenterDifference<=1.5,`Chinese, English and digits are vertically misaligned: ${JSON.stringify(entry)}`);
        }
        results.push(entry);
      }
    }
    const chinese=results.filter(result=>result.text==='名字');
    const drift=Math.max(...chinese.map(result=>result.centerOffset))-Math.min(...chinese.map(result=>result.centerOffset));
    t.assert(drift<=1,`Changing Latin font moves unchanged Chinese inside the selection: ${JSON.stringify({drift,results})}`);
    t.assert(results.every(result=>Math.abs(result.centerOffset)<=1),`Text ink is not centered in its element: ${JSON.stringify(results)}`);
    return {chineseStable:true,inkCentered:true,results};
  }finally{root.unmount();host.remove();}
})();
