"""Download every exact Ubuntu source package identified in the AppImage payload."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def fields(text):
    result, key = {}, None
    for line in text.splitlines():
        if line.startswith((' ', '\t')) and key:
            result[key] += '\n' + line.strip()
        elif re.match(r'^[A-Za-z][A-Za-z0-9-]*:', line):
            key, value = line.split(':', 1)
            result[key] = value.strip()
        else:
            key = None
    return result


def verify_source(directory, name, version):
    descriptors = list(directory.glob('*.dsc'))
    if len(descriptors) != 1:
        raise ValueError(f'{name}: expected one source descriptor')
    description = fields(descriptors[0].read_text())
    if (description['Source'], description['Version']) != (name, version):
        raise ValueError('Source descriptor identity differs from installed binary')
    files = [descriptors[0]]
    for line in description['Checksums-Sha256'].splitlines():
        if not line.strip():
            continue
        checksum, size, filename = line.split()
        if Path(filename).name != filename or not re.fullmatch(r'[0-9a-f]{64}', checksum):
            raise ValueError('Unsafe source descriptor')
        file = directory / filename
        if file.stat().st_size != int(size) or sha(file) != checksum:
            raise ValueError(f'Corresponding source checksum mismatch: {filename}')
        files.append(file)
    if len(files) < 2:
        raise ValueError('Empty corresponding source package')
    return {p.name: sha(p) for p in files}


def get_json(url):
    with urllib.request.urlopen(url, timeout=90) as response:
        return json.load(response)


def download_source(destination, item):
    name, version = item
    if not re.fullmatch(r'[a-z0-9][a-z0-9+.-]+', name) or not re.fullmatch(r'[0-9A-Za-z.+:~_-]+', version):
        raise ValueError('Unexpected Ubuntu source identifier')
    directory = destination / (name + '_' + urllib.parse.quote(version, safe=''))
    directory.mkdir()
    result = subprocess.run(['apt-get', 'source', '--download-only', '--only-source', f'{name}={version}'], cwd=directory, capture_output=True, text=True, timeout=600)
    method = 'Ubuntu APT source indexes'
    if result.returncode:
        # Hosted runners can have a superseded binary installed. Launchpad keeps
        # its exact original source, even when current APT indexes have advanced.
        entries = []
        for status in ['Published', 'Superseded', 'Deleted']:
            query = urllib.parse.urlencode({'ws.op': 'getPublishedSources', 'source_name': name, 'version': version, 'exact_match': 'true', 'status': status})
            entries = get_json('https://api.launchpad.net/1.0/ubuntu/+archive/primary?' + query)['entries']
            if entries:
                break
        if not entries:
            raise RuntimeError(f'Exact source unavailable: {name}={version}\n{result.stderr}')
        urls = get_json(entries[0]['self_link'] + '?ws.op=sourceFileUrls')
        for url in urls:
            filename = urllib.parse.unquote(urllib.parse.urlparse(url).path.rsplit('/', 1)[-1])
            if Path(filename).name != filename:
                raise ValueError('Unsafe Launchpad filename')
            with urllib.request.urlopen(url, timeout=180) as response, (directory / filename).open('wb') as stream:
                shutil.copyfileobj(response, stream)
        method = 'Ubuntu Launchpad exact source publication'
    hashes = verify_source(directory, name, version)
    print(f'Archived exact source: {name}={version}', flush=True)
    return {'name': name, 'version': version, 'directory': directory.name, 'method': method, 'sha256': hashes}


def collect(inventory, output):
    report = json.loads(inventory.read_text())
    items = sorted({(p['sourcePackage'], p['sourceVersion']) for p in report['packages'].values()})
    output.mkdir(parents=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        records = list(pool.map(lambda item: download_source(output, item), items))
    (output / 'manifest.json').write_text(json.dumps({'scope': 'All exact source packages for the Ubuntu binaries in inventory.json, including original upstream archives and distribution patches/build recipes.', 'packages': records}, indent=2) + '\n')
    return records


if __name__ == '__main__':
    collect(Path(sys.argv[1]), Path(sys.argv[2]))
