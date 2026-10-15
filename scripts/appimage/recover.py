"""Recheck an unchanged, source-complete AppImage saved in an unpublished draft."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

root = Path(__file__).resolve().parents[2]
tag, commit = sys.argv[1:]
version = json.loads((root / 'package.json').read_text())['version']
repo = os.environ.get('GITHUB_REPOSITORY', 'huilux/yingkuang')
assert tag == 'v' + version


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, timeout=600, **kwargs)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


releases = json.loads(run('gh', 'api', f'repos/{repo}/releases?per_page=100', capture_output=True).stdout)
release, = [r for r in releases if r['tag_name'] == tag]
assert release['draft'] and release['prerelease'] and release['target_commitish'] == commit
prefix = f'yingkuang_{version}_linux-debug'
names = [prefix + '.AppImage', prefix + '_materials.zip']
assets = {a['name']: a for a in release['assets']}
if not any(name in assets for name in names):
    print('No failed AppImage staging to recover')
    raise SystemExit(0)
assert all(name in assets for name in names), 'Incomplete private recovery inputs'
inputs = root / 'test-output/appimage-recovery'; inputs.mkdir(parents=True, exist_ok=True)
run('gh', 'release', 'download', tag, '--repo', repo, '--dir', str(inputs), '--pattern', names[0], '--pattern', names[1], '--clobber')
for name in names:
    assert assets[name]['digest'] == 'sha256:' + digest(inputs / name), name
materials = root / 'test-output/appimage-materials'; materials.mkdir(parents=True)
with zipfile.ZipFile(inputs / names[1]) as bundle:
    for entry in bundle.infolist():
        path = Path(entry.filename)
        assert not path.is_absolute() and '..' not in path.parts and '\\' not in entry.filename
        if entry.filename == 'DEBUG.json' or entry.is_dir(): continue
        target = materials / path; target.parent.mkdir(parents=True, exist_ok=True)
        with bundle.open(entry) as source, target.open('wb') as output: shutil.copyfileobj(source, output)
report = json.loads((materials / 'payload/inventory.json').read_text())
assert report['projectCommit'] == commit and report['appImageSha256'] == digest(inputs / names[0])
assert not report['unresolvedFiles'] and not report['missingCopyright'] and not report['remainingReview']
assert json.loads((materials / 'native-checks.json').read_text())['nativePhotoProcessing'] == 'passed'
tools = materials / 'verification-tools'; tools.mkdir()
for name in ['stage.py', 'renderer.py', 'recover.py']:
    shutil.copy2(root / 'scripts/appimage' / name, tools / name)
env = dict(os.environ, YINGKUANG_BINARY_COMMIT=commit)
package = inputs / names[0]; package.chmod(0o755)
run('xvfb-run', '-a', '-s', '-screen 0 1920x1080x24', sys.executable, str(root / 'scripts/appimage/stage.py'), str(package), str(materials), env=env)
run('node', 'scripts/beta-release.mjs', 'upload-appimage', tag, commit, cwd=root)
run('node', 'scripts/beta-release.mjs', 'validate', tag, commit, cwd=root)
for name in names:
    run('gh', 'release', 'delete-asset', tag, name, '--repo', repo, '--yes')
print('Recovered byte-identical AppImage; binary source commit preserved, verification tools recorded separately')
