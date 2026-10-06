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
checks = ["konva-canvas-regression.js", "multi-selection-regression.js", "precision-regression.js", "drag-persistence-regression.js", "current-canvas-batch-regression.js", "export-document-regression.js", "export-workflow-regression.js", "export-retry-regression.js", "photo-detail-regression.js", "browser-import-regression.js", "editor-photo-loading-regression.js", "import-regression.js", "restore-regression.js", "session-failure-regression.js", "modal-regression.js", "metadata-undo-regression.js", "template-save-regression.js", "export-improvements-regression.js", "photo-relink-regression.js", "missing-photo-removal-regression.js", "storage-recovery-regression.js", "template-import-regression.js", "editing-guards-regression.js", "batch-filter-regression.js", "export-filename-regression.js", "parameter-picker-regression.js", "export-feedback-regression.js", "slider-undo-regression.js"]
if len(sys.argv) > 2:
    checks = sys.argv[2:]

result = 1
current_check = "page load"
timeout_id = None
manager = WebKit2.UserContentManager()
manager.register_script_message_handler("regression")


def timeout():
    print(f"WebKit regression timed out during {current_check}", file=sys.stderr, flush=True)
    Gtk.main_quit()
    return False


def arm_timeout():
    global timeout_id
    if timeout_id is not None:
        GLib.source_remove(timeout_id)
    timeout_id = GLib.timeout_add_seconds(45, timeout)


def received(_manager, message):
    global result, current_check
    report = json.loads(message.get_js_value().to_string())
    print(json.dumps(report, ensure_ascii=False), flush=True)
    if report.get("running"):
        current_check = report["running"]
        arm_timeout()
        return
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
      const started = performance.now();
      while (!document.querySelector('.design-canvas')) {
        if (performance.now() - started > 10000) throw new Error('Editor not ready: ' + document.body.innerText.slice(0, 500));
        await new Promise(r => setTimeout(r, 20));
      }
      const reports = [];
      for (const check of CHECKS) {
        window.webkit.messageHandlers.regression.postMessage(JSON.stringify({running: check.name}));
        try { reports.push({name: check.name, report: await (0, eval)(check.source)}); }
        catch (error) { throw new Error(check.name + ': ' + String(error)); }
      }
      return reports;
    })().then(reports => window.webkit.messageHandlers.regression.postMessage(JSON.stringify({ok: true, reports})),
      error => window.webkit.messageHandlers.regression.postMessage(JSON.stringify({ok: false, error: String(error)})));
    """.replace("CHECKS", sources)
    view.evaluate_javascript(javascript, -1, None, None, None, None, None)


view.connect("load-changed", loaded)
def load_failed(_view, _event, uri, error):
    print(f"Unable to load {uri}: {error.message}", file=sys.stderr, flush=True)
    Gtk.main_quit()
    return True


view.connect("load-failed", load_failed)
view.load_uri(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:1422")
arm_timeout()
Gtk.main()
sys.exit(result)
