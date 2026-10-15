"""Observe the finished AppImage and stage verified private release materials."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import zipfile

root = Path(__file__).resolve().parents[2]
version = json.loads((root / 'package.json').read_text())['version']
commit = os.environ['GITHUB_SHA']
package, materials = (Path(arg).resolve() for arg in sys.argv[1:])


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


inventory = json.loads((materials / 'payload/inventory.json').read_text())
assert inventory['projectCommit'] == commit and inventory['appImageSha256'] == digest(package)
assert not inventory['unresolvedFiles'] and not inventory['missingCopyright'] and not inventory['remainingReview']
with tempfile.TemporaryDirectory(prefix='yingkuang-appimage-check-') as directory:
    work = Path(directory)
    subprocess.run([str(package), '--appimage-extract'], cwd=work, stdout=subprocess.DEVNULL, check=True, timeout=120)
    extracted = work / 'squashfs-root'
    assert (extracted / 'AppRun').read_bytes() == (root / 'scripts/appimage/AppRun').read_bytes()
    assert not (extracted / 'AppRun.wrapped').exists()
    for entry in inventory['files']:
        if 'sha256' in entry:
            assert digest(extracted / entry['path']) == entry['sha256'], entry['path']
    for source in (materials / 'payload/copyright').rglob('*'):
        if source.is_file():
            assert (extracted / 'usr/lib/yingkuang/licenses/appimage/ubuntu-copyright' / source.relative_to(materials / 'payload/copyright')).read_bytes() == source.read_bytes()
    assert list((extracted / 'usr/lib/yingkuang/licenses/appimage/runtime').rglob('*LICENSE*'))
    env = dict(os.environ)
    for name in ['CONFIG', 'DATA', 'CACHE']:
        env[f'XDG_{name}_HOME'] = str(work / name.lower())
    with (work / 'startup.log').open('w') as log:
        process = subprocess.Popen([str(package), '--appimage-extract-and-run'], stdout=log, stderr=log, env=env)
        try:
            for _ in range(90):
                if process.poll() is not None:
                    raise RuntimeError('AppImage exited: ' + (work / 'startup.log').read_text())
                result = subprocess.run(['xdotool', 'search', '--onlyvisible', '--name', '映框'], capture_output=True, text=True)
                if result.returncode == 0 and result.stdout.strip():
                    break
                time.sleep(.5)
            else:
                raise RuntimeError('Native AppImage window not observed: ' + (work / 'startup.log').read_text())
            # Require an actual WebKit renderer, not just an empty native frame.
            for _ in range(30):
                processes = subprocess.run(['pgrep', '-af', 'WebKitWebProcess'], capture_output=True, text=True).stdout
                if 'appimage' in processes.lower() or '.mount_' in processes:
                    break
                time.sleep(.5)
            else:
                raise RuntimeError('Bundled WebKit renderer not observed')
        finally:
            process.terminate()
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait()
native = json.loads((materials / 'native-checks.json').read_text())
assert native['nativePhotoProcessing'] == 'passed'
checks = {'nativePhotoProcessing': 'passed', 'version': version, 'commit': commit, 'platform': 'linux-appimage-x64', 'packageCheck': 'passed', 'startup': 'passed', 'extraction': 'passed', 'notices': 'passed', 'method': 'Finished AppImage extract, payload hashes/notices, extract-and-run native window and bundled WebKit process under Xvfb on Ubuntu 22.04. Host build dependencies remain installed; interactive editing, FUSE mount and other distributions are not covered.'}
(materials / 'checks.json').write_text(json.dumps(checks, indent=2) + '\n')
files = {p.relative_to(materials).as_posix(): digest(p) for p in sorted(materials.rglob('*')) if p.is_file()}
(materials / 'SHIPMENT.json').write_text(json.dumps({'version': version, 'commit': commit, 'appImageSha256': digest(package), 'sha256': files}, indent=2) + '\n')
output = root / 'test-output/beta/linux-appimage-x64'
output.mkdir(parents=True)
prefix = f'yingkuang_{version}_linux-appimage-x64'
__import__('shutil').copy2(package, output / (prefix + '.AppImage'))
with zipfile.ZipFile(output / (prefix + '_materials.zip'), 'w', compression=zipfile.ZIP_STORED) as bundle:
    for file in sorted(materials.rglob('*')):
        if file.is_file():
            bundle.write(file, file.relative_to(materials))
(output / (prefix + '_SHA256SUMS.txt')).write_text('\n'.join(f'{digest(file)}  {file.name}' for file in sorted(output.iterdir())) + '\n')
print('Finished AppImage extraction, notices, native window and bundled WebKit process verified; staged privately')
