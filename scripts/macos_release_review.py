"""Match macOS upstream review items to versioned, unchanged notice evidence."""
import hashlib
import json
from pathlib import PurePosixPath


def verify_review(root, inventory):
    record_path = root / 'licenses/macos-review.json'
    record = json.loads(record_path.read_text())
    if record.get('schemaVersion') != 1 or record.get('notesFile') != 'licenses/MACOS-REVIEW.md':
        raise ValueError('Invalid macOS review record')
    notes = root / record['notesFile']
    if not notes.is_file():
        raise ValueError('Missing macOS review notes')
    reviewed = {(p['ecosystem'], p['name'], p['version']): p for p in record['packages']}
    if len(reviewed) != len(record['packages']):
        raise ValueError('Duplicate macOS review records')
    packages = {(p['ecosystem'], p['name'], p['version']): p for p in inventory['packages']}
    pending = {(p['ecosystem'], p['name'], p['version']): p['reviewRequired'] for p in inventory['packages'] if p.get('reviewRequired')}
    reported = {(p['ecosystem'], p['name'], p['version']): p['reason'] for p in inventory['reviewRequired']}
    if pending != reported or len(reported) != len(inventory['reviewRequired']):
        raise ValueError('Incomplete macOS dependency review inventory')
    for item in inventory['reviewRequired']:
        identity = (item['ecosystem'], item['name'], item['version'])
        evidence = reviewed.get(identity)
        package = packages.get(identity)
        if not evidence or not package or not evidence.get('notices') or not package.get('authors'):
            raise ValueError(f'Unresolved macOS dependency review: {identity}')
        for notice in evidence['notices']:
            if notice['path'] not in package['files'] or not notice['path'].startswith('licenses/upstream/'):
                raise ValueError('Missing upstream macOS notice in installed inventory')
            relative = PurePosixPath(notice['path'])
            if relative.is_absolute() or '..' in relative.parts or '\\' in notice['path']:
                raise ValueError('Unsafe macOS review notice path')
            path = root / notice['path']
            if hashlib.sha256(path.read_bytes()).hexdigest() != notice['sha256']:
                raise ValueError('macOS review notice checksum mismatch')
    return record_path, notes
