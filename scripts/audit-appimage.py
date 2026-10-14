"""Collect provenance evidence for an extracted AppImage on its Debian/Ubuntu builder.

This produces review materials, not a license-compliance verdict. Run on the same
machine immediately after packaging so installed package versions are meaningful.
"""
import argparse
from collections import defaultdict
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


@lru_cache(maxsize=None)
def build_id(path):
    with path.open('rb') as stream:
        if stream.read(4) != b'\x7fELF':
            return None
    result = subprocess.run(['readelf', '-n', str(path)], capture_output=True,
                            text=True, errors='replace', timeout=30, check=False)
    match = re.search(r'Build ID: ([0-9a-f]+)', result.stdout)
    return match.group(1) if match else None


def match_file(path, candidates):
    checksum = digest(path)
    matches = []
    for package, source in candidates:
        if not source.is_file():
            continue
        if path.stat().st_size == source.stat().st_size and checksum == digest(source):
            matches.append({'package': package, 'source': str(source), 'evidence': 'sha256'})
        elif build_id(path) and build_id(path) == build_id(source):
            # patchelf changes bytes while normally retaining the ELF build ID.
            matches.append({'package': package, 'source': str(source), 'evidence': 'elf-build-id'})
    return checksum, matches


def package_index():
    result = subprocess.run(['dpkg-query', '-W', '-f=${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\n'],
                            capture_output=True, text=True, check=True)
    packages = {}
    for line in result.stdout.splitlines():
        name, version, source, source_version = line.split('\t')
        packages[name] = {'version': version, 'sourcePackage': source, 'sourceVersion': source_version}
    index = defaultdict(list)
    for listing in sorted(Path('/var/lib/dpkg/info').glob('*.list')):
        name = listing.name[:-5]
        if name not in packages:
            continue
        for value in listing.read_text().splitlines():
            path = Path(value)
            if path.is_absolute():
                index[path.name].append((name, path))
    if not index:
        raise RuntimeError('Requires the Debian/Ubuntu builder package database')
    return packages, index


def audit(appdir, output):
    appdir = appdir.resolve()
    output = output.resolve()
    if output == appdir or appdir in output.parents:
        raise ValueError('Audit output must be outside the AppDir')
    if output.exists():
        raise ValueError('Use a fresh output directory to avoid stale review materials')
    packages, index = package_index()
    output.mkdir(parents=True)
    files, used, unresolved = [], set(), []
    for path in sorted(appdir.rglob('*')):
        local = path.relative_to(appdir).as_posix()
        if path.is_symlink():
            files.append({'path': local, 'symlink': path.readlink().as_posix()})
            continue
        if not path.is_file():
            continue
        # Application-owned resources are covered by the project's MIT/font and
        # npm/Cargo reports. Everything else must have provenance evidence.
        project = (local == 'usr/bin/yingkuang' or local.startswith('usr/lib/映框/')
                   or local in ['映框.png', 'usr/share/applications/映框.desktop']
                   or (local.startswith('usr/share/icons/') and path.name == 'yingkuang.png'))
        if project:
            files.append({'path': local, 'sha256': digest(path), 'origin': 'project'})
            continue
        checksum, matches = match_file(path, index.get(path.name, []))
        files.append({'path': local, 'sha256': checksum, 'matches': matches})
        if not matches:
            unresolved.append(local)
        used.update(match['package'] for match in matches)
    records = {}
    for name in sorted(used):
        record = dict(packages[name])
        copyright_file = Path('/usr/share/doc') / name.split(':')[0] / 'copyright'
        record['copyrightFile'] = None
        if copyright_file.is_file():
            destination = output / 'copyright' / name / 'copyright'
            destination.parent.mkdir(parents=True)
            shutil.copyfile(copyright_file, destination)
            record['copyrightFile'] = destination.relative_to(output).as_posix()
            record['copyrightSha256'] = digest(destination)
        records[name] = record
    # Debian copyright files often refer to these standard texts by path.
    common = Path('/usr/share/common-licenses')
    if common.is_dir():
        shutil.copytree(common, output / 'common-licenses', symlinks=False)
    report = {
        'scope': 'Evidence from extracted AppImage payload and the same builder package database. ELF build IDs identify likely provenance after patching, not byte identity. Not a legal clearance or corresponding-source archive. The outer AppImage runtime requires separate review.',
        'files': files, 'packages': records, 'unresolvedFiles': unresolved,
        'missingCopyright': [name for name, record in records.items() if not record['copyrightFile']],
        'remainingReview': ['Review unresolved/generated/packaging-tool files and outer AppImage runtime',
                            'Review license conditions and provide corresponding source where required before distribution',
                            'Review ELF build-ID matches; transformed files are not byte-identical'],
    }
    (output / 'inventory.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(f'{len(files)} payload entries; {len(records)} system packages; '
          f'{len(unresolved)} unresolved files; {len(report["missingCopyright"])} missing copyright files')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('appdir', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    if not (args.appdir / 'AppRun').exists():
        parser.error('Expected an extracted AppDir containing AppRun')
    audit(args.appdir, args.output)
