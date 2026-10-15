"""Archive exact Alpine recipes and upstream sources for linked runtime inputs."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.request

def pinned_origin(path):
    path = Path(path)
    if path.is_relative_to('/usr/include/fuse3') or path == Path('/usr/lib/libfuse3.a'):
        return 'libfuse 3.15.0; original archive and type2-runtime mount.c patch'
    if path.is_relative_to('/usr/local/include/squashfuse') or str(path) in ['/usr/local/lib/libsquashfuse.a', '/usr/local/lib/libsquashfuse_ll.a']:
        return 'squashfuse 0.5.2; original archive'
    if path.is_relative_to('/work/upstream/src/runtime') or (path.parent == Path('/tmp') and path.name.startswith('runtime-') and path.suffix == '.o'):
        return 'type2-runtime 8f39b89e2ac31e1640b3d3f7e9a5108e6ce805fa; original archive and build recipe'
    return None


def remove_transient_links(directory):
    # Initial aports recipes reject symlinks. abuild fetch/verify creates links
    # under src/ pointing to its container-only cache. Keep copied real sources.
    for file in directory.rglob('*'):
        if file.is_symlink(): file.unlink()


def collect(out):
    packages = {}
    for block in (out / 'apk-installed.txt').read_text().split('\n\n'):
        values = dict(line.split(':', 1) for line in block.splitlines() if ':' in line)
        if 'P' in values:
            packages[values['P']] = values
    paths = set(re.findall(r'/[^\s()]+\.(?:a|o)\b', (out / 'link.log').read_text()))
    paths.update(re.findall(r'/[^\s\\]+\.h\b', (out / 'headers.txt').read_text()))
    origins, inputs = {}, []
    for value in sorted(paths):
        path = Path(value).resolve()
        pinned = pinned_origin(path)
        if pinned:
            inputs.append({'path': value, 'source': pinned})
            continue
        result = subprocess.run(['apk', 'info', '--who-owns', str(path)], text=True, capture_output=True, check=True)
        owner = next((p for p in packages.values() if f"{p['P']}-{p['V']}" == result.stdout.strip().split()[-1]), None)
        if owner is None or not owner.get('c'):
            raise RuntimeError(f'No exact APK source recipe for {value}: {result.stdout}')
        origins[(owner['o'], owner['c'])] = owner
        inputs.append({'path': value, 'package': owner['P'], 'version': owner['V'], 'origin': owner['o'], 'aportsCommit': owner['c']})
    records = []
    for (origin, commit), owner in sorted(origins.items()):
        destination = out / 'sources' / f"alpine-{origin}-{owner['V']}"
        destination.mkdir()
        archive = Path('/tmp') / f'aports-{commit}.tar.gz'
        if not archive.exists():
            with urllib.request.urlopen(f'https://codeload.github.com/alpinelinux/aports/tar.gz/{commit}', timeout=180) as response, archive.open('wb') as stream:
                shutil.copyfileobj(response, stream)
        with tarfile.open(archive) as bundle:
            members = [m for m in bundle if '/'.join(m.name.split('/')[1:3]) in (f'main/{origin}', f'community/{origin}', f'testing/{origin}')]
            if not members:
                raise RuntimeError(f'Missing Alpine recipe: {origin}')
            for member in members:
                relative = Path(*member.name.split('/')[3:])
                if relative.is_absolute() or '..' in relative.parts or member.issym() or member.islnk():
                    raise RuntimeError('Unsafe source recipe archive')
                if member.isfile():
                    target = destination / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(bundle.extractfile(member).read())
        cache = Path('/tmp') / f'fetch-{origin}'
        cache.mkdir()
        environment = dict(__import__('os').environ, SRCDEST=str(cache))
        subprocess.run(['abuild', '-F', 'fetch'], cwd=destination, env=environment, check=True)
        subprocess.run(['abuild', '-F', 'verify'], cwd=destination, env=environment, check=True)
        for file in cache.iterdir():
            if file.is_file():
                shutil.copy2(file, destination / file.name)
        remove_transient_links(destination)
        records.append({'origin': origin, 'version': owner['V'], 'aportsCommit': commit, 'license': owner.get('L'), 'directory': destination.relative_to(out).as_posix()})
    # Keep original notices verbatim. Sources remain intact alongside the recipes.
    for archive in sorted((out / 'sources').rglob('*')):
        if not archive.is_file() or not tarfile.is_tarfile(archive):
            continue
        with tarfile.open(archive) as bundle:
            for member in bundle:
                if not member.isfile() or not (re.match(r'(?i)^(copying|copyright|licen[cs]es?|notice)([._-].*)?$', Path(member.name).name) or any(part.lower() == 'licenses' for part in Path(member.name).parts)):
                    continue
                if member.size > 5_000_000:
                    raise RuntimeError('Unexpectedly large notice')
                relative = Path(member.name)
                if relative.is_absolute() or '..' in relative.parts:
                    raise RuntimeError('Unsafe notice path')
                target = out / 'notices' / archive.relative_to(out / 'sources') / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(bundle.extractfile(member).read())
    files = {p.relative_to(out).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(out.rglob('*')) if p.is_file()}
    (out / 'manifest.json').write_text(json.dumps({'runtimeRevision': '8f39b89e2ac31e1640b3d3f7e9a5108e6ce805fa', 'linkInputs': inputs, 'alpineSources': records, 'sha256': files}, indent=2) + '\n')
    if not paths or not origins:
        raise RuntimeError('Empty runtime link/source inventory')


if __name__ == '__main__':
    collect(Path(sys.argv[1]))
