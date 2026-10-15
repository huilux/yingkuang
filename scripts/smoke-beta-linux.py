"""Check an extracted deb's native window under Xvfb; no interactive acceptance claim."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

root = Path(sys.argv[1]).resolve()
executable = root / 'usr/bin/yingkuang'
if not executable.is_file():
    raise RuntimeError('deb application executable missing')
env = dict(os.environ)
env['XDG_CONFIG_HOME'] = str(root / 'smoke-config')
env['XDG_DATA_HOME'] = str(root / 'smoke-data')
with (root / 'startup.log').open('w') as log:
    process = subprocess.Popen([str(executable)], stdout=log, stderr=log, env=env)
    found = False
    try:
        for _ in range(60):
            if process.poll() is not None:
                raise RuntimeError(f'Application exited during startup: {process.returncode}')
            probe = subprocess.run(['xdotool', 'search', '--onlyvisible', '--pid', str(process.pid), '--name', '映框'], capture_output=True, timeout=5)
            if probe.returncode == 0 and probe.stdout.strip():
                found = True
                break
            time.sleep(0.5)
        if not found:
            raise RuntimeError('Native application window not observed')
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
Path('test-output/beta-smoke-linux-x64.json').write_text(json.dumps({
    'platform': 'linux-x64', 'packageCheck': 'passed', 'startup': 'passed',
    'method': 'deb extraction, native window observed under Xvfb on Ubuntu 22.04',
    'installation': 'deb payload extracted; system installation and uninstall not tested',
    'interactiveAcceptance': 'pending',
}, indent=2) + '\n')
