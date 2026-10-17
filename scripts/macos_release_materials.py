"""Verify macOS draft archives and collect their installers and supporting records."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import zipfile

from macos_release_review import verify_review

MACOS_TARGETS = {
    'macos-arm64': ('aarch64-apple-darwin', 'arm64'),
    'macos-x64': ('x86_64-apple-darwin', 'x86_64'),
}


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def staged_names(version):
    return {f'yingkuang_{version}_{platform}{suffix}' for platform in MACOS_TARGETS
            for suffix in ['-test.zip', '-test_SHA256SUMS.txt']}


def unpack_macos(root, inputs, materials, output, version, commit, locked, license_count):
    for platform, (target, architecture) in MACOS_TARGETS.items():
        prefix = f'yingkuang_{version}_{platform}'
        archive = inputs / (prefix + '-test.zip')
        lines = (inputs / (prefix + '-test_SHA256SUMS.txt')).read_text().splitlines()
        if lines != [f'{digest(archive)}  {archive.name}']:
            raise ValueError('macOS staged checksum mismatch')
        destination = materials / platform
        destination.mkdir()
        with zipfile.ZipFile(archive) as bundle:
            names = bundle.namelist()
            if len(names) != len(set(names)):
                raise ValueError('Duplicate macOS archive entries')
            sums = {}
            for line in bundle.read('SHA256SUMS.txt').decode().splitlines():
                checksum, name = line.split('  ', 1)
                path = PurePosixPath(name)
                if name in sums or path.is_absolute() or '..' in path.parts or '\\' in name or path.as_posix() != name:
                    raise ValueError('Unsafe macOS archive path')
                sums[name] = checksum
            if set(names) != set(sums) | {'SHA256SUMS.txt'}:
                raise ValueError('Incomplete macOS archive checksums')
            for name, checksum in sums.items():
                path = destination / name
                path.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open(name) as source, path.open('wb') as stream:
                    shutil.copyfileobj(source, stream)
                if digest(path) != checksum:
                    raise ValueError('macOS archive checksum mismatch')
            (destination / 'BUILD-SHA256SUMS.txt').write_bytes(bundle.read('SHA256SUMS.txt'))
        checks = json.loads((destination / 'checks.json').read_text())
        if tuple(checks.get(k) for k in ['version', 'commit', 'platform', 'architecture']) != (version, commit, platform, architecture):
            raise ValueError('macOS report does not match release source/architecture')
        if any(checks.get(k) != 'passed' for k in ['dmgMounted', 'nativeWindow', 'systemLibrariesOnly']):
            raise ValueError('macOS package checks did not pass')
        if (checks.get('signature'), checks.get('notarized'), checks.get('interactiveAcceptance')) != ('ad-hoc verified', False, 'pending'):
            raise ValueError('macOS test signature/acceptance scope differs')
        if checks.get('installedLicenseFilesVerified') != license_count or checks.get('dependencyReview') != 'reviewed':
            raise ValueError('macOS installed license verification is incomplete')
        libraries = checks.get('linkedLibraries', [])
        if not libraries or any(not n.startswith(('/System/Library/', '/usr/lib/')) for n in libraries):
            raise ValueError('macOS package links a non-system library')
        inventory = json.loads((destination / f'licenses/dependencies/{target}/inventory.json').read_text())
        if inventory['target'] != target or inventory['missingTexts'] or inventory['reviewRequired'] != checks.get('upstreamReviewItems'):
            raise ValueError('macOS dependency inventory does not match checks')
        record, notes = verify_review(root, inventory)
        if digest(record) != checks.get('reviewRecordSha256') or (destination / 'macos-review.json').read_bytes() != record.read_bytes() or (destination / 'MACOS-REVIEW.md').read_bytes() != notes.read_bytes():
            raise ValueError('macOS review evidence differs from source')
        if (destination / 'licenses/MIT.txt').read_bytes() != (root / 'LICENSE').read_bytes() or (destination / 'licenses/THIRD_PARTY_NOTICES.md').read_bytes() != (root / 'THIRD_PARTY_NOTICES.md').read_bytes():
            raise ValueError('macOS project notices differ from source')
        required = {(p['name'], p['version']) for p in inventory['packages'] if p['ecosystem'] == 'cargo' and ('MPL' in (p.get('license') or '') or p.get('reviewRequired'))}
        sources = json.loads((destination / 'sources.json').read_text())
        archived = {(p['name'], p['version']) for p in sources['packages']}
        if sources['projectCommit'] != commit or archived != required or len(archived) != len(sources['packages']) or checks.get('originalSourceArchives') != len(archived):
            raise ValueError('Incomplete macOS original source coverage')
        for package in sources['packages']:
            checksum = locked.get((package['name'], package['version']))
            path = f'sources/{package["name"]}-{package["version"]}.crate'
            if not checksum or package['archive'] != path or package['sha256'] != checksum or digest(destination / path) != checksum:
                raise ValueError('macOS original source checksum differs from Cargo.lock')
        # The DMG remains byte-identical; its build checksum stays in the records.
        shutil.move(destination / (prefix + '.dmg'), output / (prefix + '.dmg'))
