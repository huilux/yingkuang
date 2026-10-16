"""Exercise the unmodified AppImage's real decoding/export IPC through WebDriver.

No file dialog or IPC is mocked. This supplements native window checks, not full
manual editing/upgrade or clean-distribution acceptance.
"""
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zlib

from renderer import stop_process_group

root = Path(__file__).resolve().parents[2]
package = Path(sys.argv[1]).resolve()
report = Path(sys.argv[2])
wayland = '--wayland' in sys.argv[3:]
with tempfile.TemporaryDirectory(prefix='yingkuang-native-') as directory:
    work = Path(directory)
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    photo = work / '原生 测试.png'
    photo.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 96, 64, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress((b'\0' + bytes([90, 150, 210]) * 96) * 64)) + chunk(b'IEND', b''))
    display_photo = work / '24MP 显示测试.png'
    row = b'\0' + bytes([240, 16, 32]) * 3000 + bytes([16, 208, 224]) * 3000
    display_photo.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 6000, 4000, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(row * 4000)) + chunk(b'IEND', b''))
    output = work / '导出 结果'; output.mkdir()
    env = dict(os.environ, TAURI_WEBVIEW_AUTOMATION='true')
    if wayland:
        runtime = work / 'runtime'; runtime.mkdir(mode=0o700)
        env.update(XDG_RUNTIME_DIR=str(runtime), WAYLAND_DISPLAY='yingkuang-native-test', XDG_SESSION_TYPE='wayland')
        env.pop('DISPLAY', None)
        env.pop('GDK_BACKEND', None)  # Exercise the launcher's automatic selection.
    else:
        env['GDK_BACKEND'] = 'x11'
    for name in ['CONFIG', 'DATA', 'CACHE']:
        env[f'XDG_{name}_HOME'] = str(work / name.lower())
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]
    endpoint = f'http://127.0.0.1:{port}'
    def request(method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(endpoint + path, data, {'Content-Type': 'application/json'}, method=method)
        try:
            with urllib.request.urlopen(req, timeout=150) as response:
                value = json.load(response)['value']
        except urllib.error.HTTPError as error:
            raise RuntimeError(error.read().decode()) from error
        if isinstance(value, dict) and 'error' in value:
            raise RuntimeError(value)
        return value
    with (work / 'driver.log').open('w') as log:
        driver = None
        compositor = None
        session = None
        try:
            if wayland:
                help_text = subprocess.check_output(['weston', '--help'], text=True)
                backend = ['--backend=headless', '--renderer=pixman'] if '--renderer=NAME' in help_text else ['--backend=headless-backend.so', '--use-pixman']
                compositor = subprocess.Popen(['weston', *backend, '--no-config', '--socket=yingkuang-native-test', '--width=3840', '--height=2160', '--scale=2', '--idle-time=0'], stdout=log, stderr=log, env=env, start_new_session=True)
                for _ in range(100):
                    if compositor.poll() is not None: raise RuntimeError('Wayland test compositor exited')
                    if (runtime / 'yingkuang-native-test').exists(): break
                    time.sleep(.1)
                else: raise RuntimeError('Wayland test display did not become ready')
            driver = subprocess.Popen(['WebKitWebDriver', f'--port={port}'], stdout=log, stderr=log, env=env, start_new_session=True)
            for _ in range(60):
                if driver.poll() is not None: raise RuntimeError('WebKitWebDriver exited: ' + (work / 'driver.log').read_text())
                try:
                    request('GET', '/status'); break
                except (urllib.error.URLError, ConnectionError): time.sleep(.25)
            else:
                raise RuntimeError('WebKitWebDriver did not become ready')
            result = request('POST', '/session', {'capabilities': {'alwaysMatch': {'webkitgtk:browserOptions': {'binary': str(package), 'args': ['--appimage-extract-and-run']}}}})
            session = result['sessionId']
            request('POST', f'/session/{session}/timeouts', {'script': 120000})
            def execute(script, args):
                return request('POST', f'/session/{session}/execute/async', {'script': script, 'args': args})
            display_checks = execute('''const [path, highDpi, templateCount, done] = arguments;
                (async () => {
                  const invoke = window.__TAURI_INTERNALS__.invoke;
                  const waitFor = async (check, label) => {
                    const start = performance.now();
                    while (!check()) {
                      if (performance.now() - start > 30000) throw Error(label);
                      await new Promise(resolve => setTimeout(resolve, 25));
                    }
                  };
                  await waitFor(() => localStorage.getItem('yingkuang-session-v2') && [...document.querySelectorAll('button')].some(b => b.textContent.includes('添加照片') && !b.disabled), 'Editor not ready');
                  await invoke('plugin:event|emit', {event:'tauri://drag-drop',payload:{paths:[path],position:{x:20,y:30}}});
                  const stage = () => window.Konva?.stages.find(s => s.findOne('.preview-photo'));
                  await waitFor(() => (stage()?.findOne('.preview-photo').image().naturalWidth ?? 0) >= 4096 && document.querySelectorAll('.template-card .template-preview img').length === templateCount && !document.querySelector('.canvas-photo-status'), '24 MP photo and five template previews not ready');
                  const samples = [];
                  for (const card of document.querySelectorAll('.template-card')) {
                    const image = card.querySelector('.template-preview img'); await image.decode();
                    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
                    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
                    const pixel = [...ctx.getImageData(Math.round(canvas.width*.3), Math.round(canvas.height*.4), 1, 1).data];
                    if (!(pixel[0] > 180 && pixel[1] < 90 && pixel[2] < 90)) throw Error('Photo missing from template '+card.querySelector('strong').textContent+': '+pixel);
                    samples.push({name:card.querySelector('strong').textContent,pixel});
                  }
                  const cssWidth = stage().width(), backingWidth = stage().content.querySelector('canvas').width;
                  if (Math.abs(backingWidth-cssWidth*devicePixelRatio) > 1) throw Error('Canvas did not match display pixel ratio');
                  if (highDpi && devicePixelRatio !== 2) throw Error('Native Wayland 2x scaling not applied: '+devicePixelRatio);
                  if (highDpi) {
                    document.querySelector('[aria-label="最大化窗口"]').click();
                    await waitFor(() => document.querySelector('[aria-label="还原窗口"]'), 'Native maximize did not complete');
                    document.querySelector('[aria-label="还原窗口"]').click();
                    await waitFor(() => document.querySelector('[aria-label="最大化窗口"]'), 'Native restore did not complete');
                  }
                  return {passed:true,templatePhotoPreviews:'passed',editorBitmapWidth:stage().findOne('.preview-photo').image().naturalWidth,devicePixelRatio,cssWidth,backingWidth,samples};
                })().then(done,error=>done({passed:false,reason:String(error)}));''', [str(display_photo), wayland, len(json.loads((root / 'src/data/builtin-templates.json').read_text())['templates'])])
            if not display_checks.get('passed'): raise RuntimeError(display_checks)
            resized = request('POST', f'/session/{session}/window/rect', {'width':1200,'height':800})
            if (resized['width'], resized['height']) != (1200, 800): raise RuntimeError('Native window size did not change')
            display_checks['windowSizing'] = 'passed'
            templates = json.loads((root / 'src/data/builtin-templates.json').read_text())
            document = next(t for t in templates['templates'] if t['id'] == templates['defaultTemplateId'])['layouts']['landscape']
            settings = {'directory': str(output), 'format': 'jpeg', 'quality': 92, 'size': 'original', 'longEdge': 6000, 'noUpscale': False, 'metadata': 'basic', 'includeGps': False, 'suffix': '-native', 'collision': 'number', 'pngCompression': 'standard'}
            result = execute('''const [path, document, settings, done] = arguments;
                (async () => {
                  const invoke = window.__TAURI_INTERNALS__.invoke;
                  const photos = await invoke('inspect_images', {paths:[path]});
                  if (photos.length !== 1 || photos[0].width !== 96 || photos[0].height !== 64) throw Error('PNG import dimensions');
                  const preview = await invoke('load_editor_photo', {path});
                  if (!preview.startsWith('data:image/')) throw Error('Native preview missing');
                  const request = {items:[{path,document,overrides:{},crop:{x:0,y:0,width:1,height:1,rotation:90}}],settings};
                  const unrotated = await invoke('preflight_export', {request:{...request,items:[{...request.items[0],crop:{...request.items[0].crop,rotation:0}}]}});
                  const preflight = await invoke('preflight_export', {request});
                  if (unrotated.largestWidth === preflight.largestWidth && unrotated.largestHeight === preflight.largestHeight) throw Error('Rotation was not applied');
                  if (!preflight.ready) throw Error(JSON.stringify(preflight));
                  const summary = await invoke('export_images', {request});
                  if (summary.succeeded !== 1 || summary.failed !== 0) throw Error(JSON.stringify(summary));
                  done({passed:true,width:preflight.largestWidth,height:preflight.largestHeight});
                })().catch(error=>done({passed:false,error:String(error)}));''', [str(photo), document, settings])
            if not result.get('passed'): raise RuntimeError(result)
            jpeg, = output.glob('*.jpg')
            assert jpeg.read_bytes().startswith(b'\xff\xd8')
            dimensions = result
            result = execute('''const [path, document, settings, dimensions, done] = arguments;
                (async () => {
                  const invoke = window.__TAURI_INTERNALS__.invoke;
                  const photos = await invoke('inspect_images', {paths:[path]});
                  if (photos.length !== 1 || photos[0].width !== dimensions.width || photos[0].height !== dimensions.height) throw Error('JPEG reimport/export dimensions differ from rotated preflight');
                  settings.format='png';
                  const summary = await invoke('export_images', {request:{items:[{path,document,overrides:{}}],settings}});
                  if (summary.succeeded !== 1 || summary.failed !== 0) throw Error(JSON.stringify(summary));
                  done({passed:true});
                })().catch(error=>done({passed:false,error:String(error)}));''', [str(jpeg), document, settings, dimensions])
            if not result.get('passed'): raise RuntimeError(result)
            png, = output.glob('*.png')
            assert png.read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
            catalog = json.loads((root / 'src/font-catalog.json').read_text())
            families = [font['value'] for font in catalog] + ['Manrope, LXGW WenKai TC, sans-serif', 'LXGW WenKai TC, sans-serif']
            result = execute('''const [path, document, settings, families, done] = arguments;
                (async () => {
                  const invoke = window.__TAURI_INTERNALS__.invoke;
                  document.layers=[{name:'离线字体',source:'custom',customValue:'映框　© ® 50mm',region:'canvas',x:0.5,y:0.5,fontFamily:families[0],fontSize:20,fontWeight:400,color:'#000000',opacity:1,rotation:0,visible:true}];
                  settings.format='png';
                  for (const [index,family] of families.entries()) {
                    document.layers[0].fontFamily=family;settings.suffix='-offline-'+index;
                    const request={items:[{path,document,overrides:{}}],settings};
                    const preflight=await invoke('preflight_export',{request});
                    if (!preflight.ready) throw Error(family+': '+JSON.stringify(preflight));
                    const summary=await invoke('export_images',{request});
                    if (summary.succeeded!==1 || summary.failed!==0) throw Error(family+': '+JSON.stringify(summary));
                  }
                  document.layers[0].fontFamily='Long Cang';document.layers[0].customValue='體';
                  const preflight=await invoke('preflight_export',{request:{items:[{path,document,overrides:{}}],settings}});
                  if (preflight.ready || !preflight.errors.some(error=>error.includes('字符'))) throw Error('Missing glyph was not reported');
                  done({passed:true});
                })().catch(error=>done({passed:false,error:String(error)}));''', [str(photo), document, settings, families])
            if not result.get('passed'): raise RuntimeError(result)
            assert len(list(output.glob('*-offline-*.png'))) == len(families)
        except Exception:
            print((work / 'driver.log').read_text(), file=sys.stderr)
            raise
        finally:
            if session:
                try: request('DELETE', f'/session/{session}')
                except (RuntimeError, urllib.error.URLError): pass
            if driver: stop_process_group(driver)
            if compositor: stop_process_group(compositor)
report.write_text(json.dumps({'nativePhotoProcessing': 'passed', 'displayBackend': 'wayland' if wayland else 'x11', 'displayChecks': display_checks, 'offlineFontFamilies': [font['family'] for font in catalog], 'legacyFontMigration': 'passed', 'missingGlyphPreflight': 'passed', 'checks': ['24 MP import and 4096px editor bitmap', 'all five template photo pixels', 'canvas display pixel ratio and native window sizing', 'PNG import and preview', '90 degree rotation and native JPEG export', 'JPEG reimport and native PNG export', 'Chinese and space paths', 'shipped default template and font resources', 'all selected offline fonts with Chinese and symbol fallback', 'retired family names and missing-glyph preflight'], 'method': 'Unmodified release AppImage launched by WebKitWebDriver with Tauri automation enabled only via the test process environment. Real Rust IPC; no dialogs or file processing mocked.'}, indent=2) + '\n')
print('AppImage real PNG/JPEG decoding, rotation, default template/font rendering and native exports passed')
