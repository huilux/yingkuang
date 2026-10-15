"""Install and remove the real deb on the CI runner; verify its native window."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time

root = Path(__file__).resolve().parent.parent
package = Path(sys.argv[1]).resolve()
commit = os.environ['GITHUB_SHA']
assert re.fullmatch(r'[a-f0-9]{40}', commit)


def run(*command, check=True):
    result = subprocess.run(command, capture_output=True, text=True, timeout=600)
    if check and result.returncode:
        raise RuntimeError(f'{command[0]} failed ({result.returncode}):\n{result.stdout}\n{result.stderr}')
    return result


name = run('dpkg-deb', '--field', str(package), 'Package').stdout.strip()
assert re.fullmatch(r'[a-z0-9][a-z0-9+.-]+', name)
previous = run('dpkg-query', '-W', '-f=${Status}', name, check=False)
assert previous.returncode != 0 or previous.stdout.strip() != 'install ok installed', 'Use a fresh CI environment'
app = Path('/usr/bin/yingkuang')
assert not app.exists(), 'Application already exists on the runner'
smoke_path = root / 'test-output/beta-smoke-linux-x64.json'
try:
    run('sudo', 'apt-get', 'install', '-y', '--no-install-recommends', str(package))
    assert run('dpkg-query', '-W', '-f=${Status}', name).stdout.strip() == 'install ok installed'
    owned = run('dpkg-query', '-L', name).stdout.splitlines()
    assert str(app) in owned and app.is_file(), 'Installed executable missing'
    candidates = [Path(path) for path in owned if path.endswith('/licenses/dependencies/x86_64-unknown-linux-gnu/inventory.json')]
    assert len(candidates) == 1, 'Installed resource inventory missing or ambiguous'
    with tempfile.TemporaryDirectory(prefix='yingkuang-linux-smoke-') as temporary:
        work = Path(temporary)
        env = dict(os.environ)
        for variable, directory in [('XDG_CONFIG_HOME', 'config'), ('XDG_DATA_HOME', 'data'), ('XDG_CACHE_HOME', 'cache')]:
            env[variable] = str(work / directory)
        with (work / 'startup.log').open('w') as log:
            process = subprocess.Popen([str(app)], stdout=log, stderr=log, env=env)
            try:
                for _ in range(60):
                    if process.poll() is not None:
                        raise RuntimeError(f'Application exited during startup: {process.returncode}')
                    probe = run('xdotool', 'search', '--onlyvisible', '--pid', str(process.pid), '--name', '映框', check=False)
                    if probe.returncode == 0 and probe.stdout.strip():
                        break
                    time.sleep(.5)
                else:
                    raise RuntimeError('Native application window not observed')
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill(); process.wait()
    smoke_path.write_text(json.dumps({'platform': 'linux-x64', 'packageCheck': 'passed', 'startup': 'passed', 'method': 'APT deb installation, package database and native window under Xvfb on Ubuntu 22.04 CI; build dependencies remain installed', 'installation': 'passed', 'uninstall': 'pending', 'interactiveAcceptance': 'pending'}, indent=2) + '\n')
    subprocess.run(['node', 'scripts/beta-release.mjs', 'stage', 'linux-x64', str(candidates[0].parents[3]), commit], cwd=root, check=True, timeout=120)
finally:
    # The runner was checked for a previous installation before any mutation.
    run('sudo', 'apt-get', 'remove', '-y', name)
assert not app.exists(), 'Application executable remains after uninstall'
status = run('dpkg-query', '-W', '-f=${Status}', name, check=False)
assert status.returncode != 0 or status.stdout.strip() != 'install ok installed'
smoke = json.loads(smoke_path.read_text())
smoke['uninstall'] = 'passed'
smoke_path.write_text(json.dumps(smoke, indent=2) + '\n')
output = root / 'test-output/beta/linux-x64'
report, = output.glob('*_checks.json')
checks = json.loads(report.read_text())
checks['uninstall'] = 'passed'
report.write_text(json.dumps(checks, indent=2) + '\n')
sum_file, = output.glob('*_SHA256SUMS.txt')
sums = [f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}' for file in sorted(output.iterdir()) if file != sum_file]
sum_file.write_text('\n'.join(sums) + '\n')
print('Verified real deb installation, installed licenses, native window and removal')
