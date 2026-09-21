#!/usr/bin/env python3
"""Run browser regression scripts in Tauri's Linux rendering engine.

Requires system PyGObject, WebKitGTK 4.1 and a running Vite dev server:
    xvfb-run -a python3 scripts/run-webkit-regressions.py http://127.0.0.1:1422
"""
import json
from pathlib import Path
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

scripts = Path(__file__).resolve().parent
checks = ["backdrop-cache-regression.js", "canvas-regression.js", "zoom-regression.js", "zoom-range-regression.js", "slider-anchor-regression.js", "wheel-input-regression.js", "wheel-boundary-regression.js", "drag-regression.js", "browser-import-regression.js", "zoom-regression.js", "import-regression.js", "restore-regression.js"]
if len(sys.argv) > 2:
    checks = sys.argv[2:]
result = 1
manager = WebKit2.UserContentManager()
manager.register_script_message_handler("regression")


def received(_manager, message):
    global result
    report = json.loads(message.get_js_value().to_string())
    print(json.dumps(report, ensure_ascii=False), flush=True)
    result = 0 if report.get("ok") else 1
    Gtk.main_quit()


manager.connect("script-message-received::regression", received)
view = WebKit2.WebView(user_content_manager=manager)
window = Gtk.Window()
window.set_default_size(1440, 920)
window.add(view)
window.show_all()


def loaded(_view, event):
    if event != WebKit2.LoadEvent.FINISHED:
        return
    sources = json.dumps([{ "name": name, "source": (scripts / name).read_text() } for name in checks])
    javascript = """
    (async () => {
      while (!document.querySelector('.design-canvas')) await new Promise(r => setTimeout(r, 20));
      const reports = [];
      for (const check of CHECKS) {
        try { reports.push({name: check.name, report: await (0, eval)(check.source)}); }
        catch (error) { throw new Error(check.name + ': ' + String(error)); }
      }
      return reports;
    })().then(reports => window.webkit.messageHandlers.regression.postMessage(JSON.stringify({ok: true, reports})),
      error => window.webkit.messageHandlers.regression.postMessage(JSON.stringify({ok: false, error: String(error)})));
    """.replace("CHECKS", sources)
    view.evaluate_javascript(javascript, -1, None, None, None, None, None)


def timeout():
    print("WebKit regression timed out", file=sys.stderr)
    Gtk.main_quit()
    return False


view.connect("load-changed", loaded)
view.load_uri(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:1422")
GLib.timeout_add_seconds(45, timeout)
Gtk.main()
sys.exit(result)
