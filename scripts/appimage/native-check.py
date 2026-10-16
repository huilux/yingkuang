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

root = Path(__file__).resolve().parents[2]
package = Path(sys.argv[1]).resolve()
report = Path(sys.argv[2])
with tempfile.TemporaryDirectory(prefix='yingkuang-native-') as directory:
    work = Path(directory)
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    photo = work / '原生 测试.png'
    photo.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 96, 64, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress((b'\0' + bytes([90, 150, 210]) * 96) * 64)) + chunk(b'IEND', b''))
    output = work / '导出 结果'; output.mkdir()
    env = dict(os.environ, TAURI_WEBVIEW_AUTOMATION='true')
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
        driver = subprocess.Popen(['WebKitWebDriver', f'--port={port}'], stdout=log, stderr=log, env=env)
        session = None
        try:
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
            driver.terminate(); driver.wait(timeout=15)
report.write_text(json.dumps({'nativePhotoProcessing': 'passed', 'offlineFontFamilies': [font['family'] for font in catalog], 'legacyFontMigration': 'passed', 'missingGlyphPreflight': 'passed', 'checks': ['PNG import and preview', '90 degree rotation and native JPEG export', 'JPEG reimport and native PNG export', 'Chinese and space paths', 'shipped default template and font resources', 'all selected offline fonts with Chinese and symbol fallback', 'retired family names and missing-glyph preflight'], 'method': 'Unmodified release AppImage launched by WebKitWebDriver with Tauri automation enabled only via the test process environment. Real Rust IPC; no dialogs or file processing mocked.'}, indent=2) + '\n')
print('AppImage real PNG/JPEG decoding, rotation, default template/font rendering and native exports passed')
