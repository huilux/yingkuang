#!/usr/bin/env python3
"""Assert the dev URL mounts the app, including when proxy variables are set.

Run with a running dev server:
  NO_PROXY=localhost,127.0.0.1,::1 no_proxy=localhost,127.0.0.1,::1 \
    xvfb-run -a python3 scripts/webkit-startup-regression.py http://localhost:1420
"""
import json
import sys
import gi

gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, WebKit2, GLib  # noqa: E402

result = 1
errors = []
manager = WebKit2.UserContentManager()
manager.register_script_message_handler('startup')
manager.connect('script-message-received::startup', lambda _manager, message: errors.append(message.get_js_value().to_string()))
manager.add_script(WebKit2.UserScript.new("""
window.addEventListener('error', e => window.webkit.messageHandlers.startup.postMessage(String(e.message)));
window.addEventListener('unhandledrejection', e => window.webkit.messageHandlers.startup.postMessage(String(e.reason)));
""", WebKit2.UserContentInjectedFrames.TOP_FRAME, WebKit2.UserScriptInjectionTime.START, None, None))
view = WebKit2.WebView(user_content_manager=manager)
window = Gtk.Window()
window.set_default_size(1200, 800)
window.add(view)
window.show_all()


def evaluated(webview, task, _data):
    global result
    try:
        report = json.loads(webview.evaluate_javascript_finish(task).to_string())
        report['errors'] = errors
        result = 0 if report.get('mounted') and not errors else 1
        print(json.dumps(report, ensure_ascii=False), flush=True)
    except Exception as error:
        print(str(error), file=sys.stderr)
    Gtk.main_quit()


def loaded(webview, event):
    if event != WebKit2.LoadEvent.FINISHED:
        return

    def sample():
        webview.evaluate_javascript("JSON.stringify({url:location.href,title:document.title,mounted:!!document.querySelector('#root .canvas-viewport')})",
                                    -1, None, None, None, evaluated, None)
        return False

    GLib.timeout_add(4000, sample)


def failed(_view, _event, uri, error):
    print(f'Unable to load {uri}: {error.message}', file=sys.stderr, flush=True)
    Gtk.main_quit()
    return True


def timeout():
    print('Startup timed out before the app mounted', file=sys.stderr, flush=True)
    Gtk.main_quit()
    return False


view.connect('load-changed', loaded)
view.connect('load-failed', failed)
view.load_uri(sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:1420')
GLib.timeout_add_seconds(15, timeout)
Gtk.main()
sys.exit(result)
