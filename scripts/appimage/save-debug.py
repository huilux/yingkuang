"""Keep a source-complete finished AppImage privately when native checks fail."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tomllib
import zipfile

root = Path(__file__).resolve().parents[2]
package = root / 'test-output/yingkuang.AppImage'
materials = root / 'test-output/appimage-materials'
if not package.is_file():
    print('No finished AppImage to preserve')
    raise SystemExit(0)
with package.open('rb') as stream:
    checksum = hashlib.file_digest(stream, 'sha256').hexdigest()
report = json.loads((materials / 'payload/inventory.json').read_text())
assert report['projectCommit'] == os.environ['GITHUB_SHA']
assert report['appImageSha256'] == checksum
assert not report['unresolvedFiles'] and not report['missingCopyright'] and not report['remainingReview']
version = json.loads((root / 'package.json').read_text())['version']
output = root / 'test-output/appimage-debug'; output.mkdir(exist_ok=True)
prefix = f'yingkuang_{version}_linux-debug'
shutil.copy2(package, output / (prefix + '.AppImage'))
spec = importlib.util.spec_from_file_location('assembly', root / 'scripts/assemble-beta-release.py')
assembly = importlib.util.module_from_spec(spec); spec.loader.exec_module(assembly)
lock = tomllib.loads((root / 'src-tauri/Cargo.lock').read_text())
locked = {(p['name'], p['version']): p.get('checksum') for p in lock['package']}
inventory = json.loads((root / 'test-output/licenses/x86_64-unknown-linux-gnu/inventory.json').read_text())
sources = materials / 'cargo-sources'; sources.mkdir(exist_ok=True)
for p in inventory['packages']:
    if p['ecosystem'] == 'cargo' and 'MPL' in (p['license'] or ''):
        assembly.obtain_crate(p['name'], p['version'], locked[(p['name'], p['version'])], sources / f'{p["name"]}-{p["version"]}.crate')
with zipfile.ZipFile(output / (prefix + '_materials.zip'), 'w', compression=zipfile.ZIP_STORED) as bundle:
    for file in sorted(materials.rglob('*')):
        if file.is_file(): bundle.write(file, file.relative_to(materials))
    bundle.writestr('DEBUG.json', json.dumps({'version': version, 'commit': os.environ['GITHUB_SHA'], 'appImageSha256': checksum, 'scope': 'Private debugging inputs only. Corresponding source/notices completed; native acceptance failed or remains pending. Do not publish these debug assets.'}, indent=2))
print('Source-complete AppImage debugging inputs preserved for the existing private draft')
