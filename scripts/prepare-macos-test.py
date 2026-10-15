#!/usr/bin/env python3
"""Inspect the real DMG and stage a complete archive only for a release draft."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import tomllib
import urllib.request
import zipfile

root = Path(__file__).resolve().parent.parent
platform, target, commit = sys.argv[1:]
targets = {'macos-arm64': ('aarch64-apple-darwin', 'arm64'), 'macos-x64': ('x86_64-apple-darwin', 'x86_64')}
assert sys.platform == 'darwin' and targets[platform][0] == target
assert re.fullmatch(r'[0-9a-f]{40}', commit)
version = json.loads((root / 'package.json').read_text())['version']
assert re.fullmatch(r'\d+\.\d+\.\d+-beta\.\d+', version)
packages = list((root / 'src-tauri/target/release/bundle/dmg').glob(f'*{version}*.dmg'))
assert len(packages) == 1, 'Expected one version-matching DMG'
inventory_path = root / 'test-output/licenses' / target / 'inventory.json'
inventory = json.loads(inventory_path.read_text())
assert inventory['target'] == target and not inventory['missingTexts']

def run(*command, input_text=None):
    result = subprocess.run(command, input=input_text, capture_output=True, text=True, timeout=90)
    if result.returncode:
        raise RuntimeError(f'{command[0]} failed ({result.returncode}):\n{result.stdout}\n{result.stderr}')
    return result

prefix = f'yingkuang_{version}_{platform}'
output = root / 'test-output/macos-test' / platform
output.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='yingkuang-macos-') as temporary:
    working = Path(temporary)
    volume = working / 'volume'; volume.mkdir()
    staged = working / 'staged'; staged.mkdir()
    run('swiftc', str(root / 'scripts/macos-window.swift'), '-o', str(working / 'window-check'))
    # A DMG can prompt for its embedded project MIT agreement during attach.
    # Provide acceptance on stdin for unattended CI.
    run('hdiutil', 'attach', str(packages[0]), '-readonly', '-nobrowse', '-mountpoint', str(volume), input_text='Y\n')
    try:
        apps = list(volume.glob('*.app')); assert len(apps) == 1
        app = apps[0]
        binary = app / 'Contents/MacOS/yingkuang'
        assert run('lipo', '-archs', str(binary)).stdout.strip() == targets[platform][1]
        linked_libraries = [line.strip().split(' (', 1)[0] for line in run('otool', '-L', str(binary)).stdout.splitlines()[1:]]
        external_libraries = [name for name in linked_libraries if not name.startswith(('/System/Library/', '/usr/lib/'))]
        assert not external_libraries, f'Unexpected non-system libraries in standalone app: {external_libraries}'
        run('codesign', '--verify', '--deep', '--strict', str(app))
        signature = run('codesign', '-dv', '--verbose=4', str(app)).stderr
        assert 'Signature=adhoc' in signature, 'Expected the documented ad-hoc test signature'
        resources = app / 'Contents/Resources/licenses'
        pairs = [('MIT.txt', root / 'LICENSE'), ('THIRD_PARTY_NOTICES.md', root / 'THIRD_PARTY_NOTICES.md')]
        pairs += [(f'dependencies/{target}/{name}', inventory_path.parent / name) for name in ['inventory.json', 'LICENSE-TEXTS.txt']]
        pairs += [(f'fonts/{file.parent.name}/OFL.txt', file) for file in sorted((root / 'public/fonts').glob('*/OFL.txt'))]
        for name, source in pairs:
            assert (resources / name).read_bytes() == source.read_bytes(), f'Installed notice differs: {name}'
        shutil.copytree(resources, staged / 'licenses')
        with (working / 'startup.log').open('w') as log:
            process = subprocess.Popen([str(binary)], stdout=log, stderr=log)
            try:
                for attempt in range(40):
                    assert process.poll() is None, 'Application exited during startup'
                    if subprocess.run([str(working / 'window-check'), str(process.pid)], timeout=5).returncode == 0:
                        break
                    time.sleep(.5)
                else:
                    raise RuntimeError('Native application window not observed')
            finally:
                if process.poll() is None:
                    process.terminate()
                    try: process.wait(timeout=10)
                    except subprocess.TimeoutExpired: process.kill(); process.wait()
    finally:
        run('hdiutil', 'detach', str(volume))
    # Preserve unmodified MPL sources and the original sources of packages whose
    # upstream SDK/attribution notes still need review. Do not invent attribution.
    lock = tomllib.loads((root / 'src-tauri/Cargo.lock').read_text())
    checksums = {(p['name'], p['version']): p.get('checksum') for p in lock['package']}
    sources = []
    for package in inventory['packages']:
        if package['ecosystem'] != 'cargo' or not ('MPL' in (package['license'] or '') or package['reviewRequired']): continue
        filename = f'{package["name"]}-{package["version"]}.crate'
        cached = list((Path.home() / '.cargo/registry/cache').glob('*/' + filename))
        source_url = f'https://static.crates.io/crates/{package["name"]}/{filename}'
        if not cached:
            downloaded = working / filename
            with urllib.request.urlopen(source_url, timeout=30) as response: downloaded.write_bytes(response.read())
            cached = [downloaded]
        digest = hashlib.sha256(cached[0].read_bytes()).hexdigest()
        assert digest == checksums[(package['name'], package['version'])], filename
        destination = staged / 'sources' / filename; destination.parent.mkdir(exist_ok=True)
        shutil.copy2(cached[0], destination)
        sources.append({'name': package['name'], 'version': package['version'], 'license': package['license'], 'sha256': digest, 'archive': 'sources/' + filename, 'url': source_url})
    (staged / 'sources.json').write_text(json.dumps({'projectCommit': commit, 'projectSource': f'https://github.com/huilux/yingkuang/tree/{commit}', 'packages': sources}, indent=2) + '\n')
    shutil.copy2(packages[0], staged / (prefix + '.dmg'))
    report = {'version': version, 'commit': commit, 'platform': platform, 'architecture': targets[platform][1], 'dmgMounted': 'passed', 'installedLicenseFilesVerified': len(pairs), 'signature': 'ad-hoc verified', 'notarized': False, 'nativeWindow': 'passed', 'systemLibrariesOnly': 'passed', 'linkedLibraries': linked_libraries, 'dependencyReview': 'pending' if inventory['reviewRequired'] else 'passed', 'upstreamReviewItems': inventory['reviewRequired'], 'originalSourceArchives': len(sources), 'interactiveAcceptance': 'pending', 'scope': 'Automated DMG mounting, architecture, signature, linked libraries, installed notices and native-window checks. Gatekeeper, installation and photo editing/export require a real tester.'}
    (staged / 'checks.json').write_text(json.dumps(report, indent=2) + '\n')
    shutil.copy2(root / 'docs/macos-testing.md', staged / 'TESTING.md')
    sums = [f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.relative_to(staged).as_posix()}' for file in sorted(staged.rglob('*')) if file.is_file()]
    (staged / 'SHA256SUMS.txt').write_text('\n'.join(sums) + '\n')
    archive = output / (prefix + '-test.zip')
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as bundle:
        for file in sorted(staged.rglob('*')):
            if file.is_file(): bundle.write(file, file.relative_to(staged))
    (output / (prefix + '-test_SHA256SUMS.txt')).write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name + '\n')
    print(json.dumps(report))
