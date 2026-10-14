#!/usr/bin/env python3
"""Verify production CSP and assets in WebKitGTK after npm run build.
Run: xvfb-run -a python3 scripts/check-csp.py
"""
import functools
import http.server
import json
from pathlib import Path
import threading
import gi

gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

root = Path(__file__).resolve().parent.parent
policy = json.loads((root / 'src-tauri/tauri.conf.json').read_text())['app']['security']['csp']
assert isinstance(policy, dict), 'Production CSP must be enabled'
assert (root / 'dist/index.html').is_file(), 'Run npm run build first'
header = '; '.join(f'{key} {value}' for key, value in policy.items())

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Content-Security-Policy', header)
        super().end_headers()

    def log_message(self, *_args):
        pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(root / 'dist')))
threading.Thread(target=server.serve_forever, daemon=True).start()
manager = WebKit2.UserContentManager()
manager.register_script_message_handler('result')
result = 1

def received(_manager, message):
    global result
    report = json.loads(message.get_js_value().to_string())
    print(json.dumps(report, ensure_ascii=False), flush=True)
    result = 0 if report.get('ok') else 1
    Gtk.main_quit()

manager.connect('script-message-received::result', received)
view = WebKit2.WebView.new_with_user_content_manager(manager)
window = Gtk.Window()
window.set_default_size(1440, 920)
window.add(view)
window.show_all()

def loaded(_view, event):
    if event != WebKit2.LoadEvent.FINISHED:
        return
    view.evaluate_javascript(r"""
    (async () => {
      const assert = (value, message) => { if (!value) throw new Error(message); };
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 200 && !document.querySelector('.design-canvas'); i++) await wait(50);
      assert(document.querySelector('.design-canvas'), 'Production editor did not load');
      const loadImage = src => new Promise((resolve, reject) => { const img = new Image(); img.onload = resolve; img.onerror = () => reject(new Error('Image blocked')); img.src = src; });
      const response = await fetch('/demo.jpg'); assert(response.ok, 'Demo fetch failed');
      const blob = URL.createObjectURL(await response.blob());
      await loadImage(blob); URL.revokeObjectURL(blob);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
      await loadImage(canvas.toDataURL());
      const font = new FontFace('CSP fixture', 'url(/fonts/spacemono/SpaceMono-Regular.ttf)');
      document.fonts.add(await font.load());
      const violations = [];
      document.addEventListener('securitypolicyviolation', e => violations.push(e.effectiveDirective));
      const script = document.createElement('script'); script.textContent = 'window.__cspUnsafeRan = true'; document.body.append(script);
      let evalBlocked = false; try { new Function('return 1')(); } catch { evalBlocked = true; }
      let remoteBlocked = false; try { await fetch('https://example.invalid/csp-probe'); } catch { remoteBlocked = true; }
      await wait(100);
      assert(!window.__cspUnsafeRan, 'Inline script executed');
      assert(evalBlocked, 'Dynamic code execution allowed');
      assert(remoteBlocked && violations.includes('connect-src'), 'Remote connection not blocked by CSP');
      assert(violations.some(v => v.startsWith('script-src')), 'Script CSP violation missing');
      return {ok:true, editor:true, blobAndDataImages:true, offlineFont:true, inlineScriptBlocked:true, evalBlocked, remoteBlocked};
    })().then(r => window.webkit.messageHandlers.result.postMessage(JSON.stringify(r)), e => window.webkit.messageHandlers.result.postMessage(JSON.stringify({ok:false,error:String(e)})));
    """, -1, None, None, None, None, None)

view.connect('load-changed', loaded)
view.load_uri(f'http://127.0.0.1:{server.server_port}')
def timeout():
    print('CSP check timed out', flush=True)
    Gtk.main_quit()
    return False
GLib.timeout_add_seconds(30, timeout)
Gtk.main()
server.shutdown()
raise SystemExit(result)
