"""Replace opaque launch components, prove payload provenance and pack AppImage."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('appimage_audit', ROOT / 'scripts/audit-appimage.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def run(*args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, capture_output=True, **kwargs).stdout


def elf_sections(data):
    if data[:6] != b'\x7fELF\x02\x01':
        raise ValueError('Expected little-endian ELF64')
    header = struct.unpack_from('<16sHHIQQQIHHHHHH', data)
    offset, size, count, names_index = header[6], header[11], header[12], header[13]
    entries = [struct.unpack_from('<IIQQQQIIQQ', data, offset + i * size) for i in range(count)]
    names_header = entries[names_index]
    names = data[names_header[4]:names_header[4] + names_header[5]]
    section_names = [names[e[0]:].split(b'\0', 1)[0].decode() for e in entries]
    result = {}
    for entry in entries[1:]:
        name = names[entry[0]:].split(b'\0', 1)[0].decode()
        if entry[1] != 8:  # SHT_NOBITS has no bytes in the file.
            content = data[entry[4]:entry[4] + entry[5]]
            if entry[1] in (2, 11):  # Symbols retain semantic section names after patchelf reorders headers.
                symbols = []
                for position in range(0, len(content), 24):
                    symbol = list(struct.unpack_from('<IBBHQQ', content, position))
                    if 0 < symbol[3] < len(section_names): symbol[3] = section_names[symbol[3]]
                    symbols.append(symbol)
                content = json.dumps(symbols).encode()
            result[name] = content
    return result


def verify_elf(payload, original):
    expected = original.read_bytes()
    # The pinned Tauri GTK plugin makes WebKit /usr data paths relative.
    if payload.name.startswith('libwebkit'):
        expected = expected.replace(b'/usr', b'././')
    before, after = elf_sections(expected), elf_sections(payload.read_bytes())
    ignored = {'.dynamic', '.dynstr', '.shstrtab'}
    differences = sorted(k for k in set(before) & set(after) - ignored if before[k] != after[k])
    if set(before) != set(after) or differences:
        raise ValueError(f'Unexpected ELF code/data transformation: {payload}; changed={differences}; added={sorted(set(after)-set(before))}; removed={sorted(set(before)-set(after))}')
    def dynamic(path):
        text = run('readelf', '-d', path).decode()
        return sorted(re.findall(r'\((NEEDED|SONAME)\).*?\[(.*?)\]', text))
    if dynamic(payload) != dynamic(original):
        raise ValueError(f'Unexpected ELF dependencies: {payload}')
    def symbols(path):
        text = run('readelf', '--dyn-syms', '--wide', path).decode()
        return sorted(' '.join(line.split()[3:6] + line.split()[7:]) for line in text.splitlines() if re.match(r'\s*\d+:', line))
    if symbols(payload) != symbols(original):
        raise ValueError(f'Unexpected ELF symbol names: {payload}')
    return 'All ELF sections except dynamic-string/loader/section-name metadata match; NEEDED, SONAME and dynamic symbols match. Pinned WebKit /usr replacement normalized where applicable.'


def prove_generated(appdir):
    proofs = {}
    commands = [
        ('usr/lib/gtk-3.0/3.0.0/immodules.cache', '/usr/lib/x86_64-linux-gnu/libgtk-3-0/gtk-query-immodules-3.0', '/usr/lib/x86_64-linux-gnu/gtk-3.0/3.0.0/immodules/'),
        ('usr/lib/gdk-pixbuf-2.0/2.10.0/loaders.cache', '/usr/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/gdk-pixbuf-query-loaders', '/usr/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/2.10.0/loaders/'),
    ]
    for local, executable, prefix in commands:
        file = appdir / local
        result = run(executable).replace(prefix.encode(), b'')
        if file.read_bytes() != result:
            raise ValueError(f'Generated GTK cache differs from same-builder inputs: {local}')
        proofs[local] = {'tool': executable, 'toolSha256': audit.digest(Path(executable)), 'transformation': f'Remove module prefix {prefix}', 'sha256': audit.digest(file)}
    local = 'usr/share/glib-2.0/schemas/gschemas.compiled'
    with tempfile.TemporaryDirectory() as directory:
        cache = Path(directory)
        for file in (appdir / 'usr/share/glib-2.0/schemas').glob('*'):
            if file.is_file() and file.name != 'gschemas.compiled':
                shutil.copy2(file, cache / file.name)
        run('glib-compile-schemas', cache)
        if (cache / 'gschemas.compiled').read_bytes() != (appdir / local).read_bytes():
            raise ValueError('Generated GLib schemas differ from packaged XML inputs')
    proofs[local] = {'tool': shutil.which('glib-compile-schemas'), 'sha256': audit.digest(appdir / local), 'transformation': 'glib-compile-schemas over packaged schema XML/override files'}
    return proofs


def finalize(appdir, output, materials, runtime):
    if materials.exists() or output.exists():
        raise ValueError('Use fresh output paths')
    materials.mkdir(parents=True)
    # Drop both opaque legacy launcher and generated wrapper/hook; the replacement
    # is original project code under MIT and carries the full GTK/WebKit environment.
    for local in ['AppRun', 'AppRun.wrapped', 'apprun-hooks/linuxdeploy-plugin-gtk.sh']:
        (appdir / local).unlink(missing_ok=True)
    shutil.copy2(ROOT / 'scripts/appimage/AppRun', appdir / 'AppRun')
    (appdir / 'AppRun').chmod(0o755)
    generated = prove_generated(appdir)
    audit.audit(appdir, materials / 'payload')
    inventory_file = materials / 'payload/inventory.json'
    report = json.loads(inventory_file.read_text())
    unresolved = []
    for entry in report['files']:
        local = entry['path']
        if local == 'AppRun':
            entry['origin'] = 'project MIT scripts/appimage/AppRun'
        elif local in generated:
            entry['generationProof'] = generated[local]
        elif not entry.get('origin') and not entry.get('symlink'):
            matches = entry.get('matches', [])
            if not matches:
                unresolved.append(local)
            for match in matches:
                if match['evidence'] == 'elf-build-id':
                    match['transformationProof'] = verify_elf(appdir / local, Path(match['source']))
    if unresolved or report['missingCopyright']:
        raise ValueError(f'Incomplete AppImage provenance: {unresolved}, {report["missingCopyright"]}')
    source_spec = importlib.util.spec_from_file_location('ubuntu_sources', Path(__file__).with_name('ubuntu-sources.py'))
    sources = importlib.util.module_from_spec(source_spec); source_spec.loader.exec_module(sources)
    source_records = sources.collect(inventory_file, materials / 'ubuntu-sources')
    expected = {(p['sourcePackage'], p['sourceVersion']) for p in report['packages'].values()}
    if expected != {(p['name'], p['version']) for p in source_records}:
        raise ValueError('Incomplete system corresponding source coverage')
    runtime_report = json.loads((runtime / 'manifest.json').read_text())
    for local, checksum in runtime_report['sha256'].items():
        if audit.digest(runtime / local) != checksum:
            raise ValueError(f'Runtime source/notice checksum mismatch: {local}')
    if not runtime_report['linkInputs'] or not runtime_report['alpineSources']:
        raise ValueError('Empty runtime provenance')
    shutil.copytree(runtime, materials / 'runtime')
    # Install complete original distribution notices inside the binary too.
    notices = appdir / 'usr/lib/yingkuang/licenses/appimage'
    notices.mkdir(parents=True)
    shutil.copytree(materials / 'payload/copyright', notices / 'ubuntu-copyright')
    shutil.copytree(materials / 'payload/common-licenses', notices / 'common-licenses')
    shutil.copytree(runtime / 'notices', notices / 'runtime')
    shutil.copy2(ROOT / 'scripts/appimage/AppRun', materials / 'AppRun')
    plugin = ROOT / 'src-tauri/target/.tauri/linuxdeploy-plugin-gtk.sh'
    if audit.digest(plugin) != '95eeb15c2eb3e595c102ec8284b017b2a369ac0afddf1c8475fab04c069a0aa9':
        raise ValueError('Actual GTK packaging plugin differs from pinned source/patch')
    shutil.copy2(plugin, materials / 'linuxdeploy-plugin-gtk.sh')
    shutil.copytree(ROOT / 'licenses/packaging', materials / 'packaging-notices')
    for name in ['build-appimage.mjs', 'audit-appimage.py']:
        shutil.copy2(ROOT / 'scripts' / name, materials / name)
    for file in sorted((ROOT / 'scripts/appimage').iterdir()):
        if file.is_file():
            target = materials / 'build-recipes' / file.name
            target.parent.mkdir(exist_ok=True)
            shutil.copy2(file, target)
    report.update({'unresolvedFiles': [], 'remainingReview': [], 'scope': 'Same-builder system file hashes or verified ELF section transformations; generated caches reproduced; project MIT launcher; original Ubuntu notices and all exact corresponding source archives; statically linked runtime source/recipes/notices supplied separately in runtime/.', 'runtimeSha256': audit.digest(runtime / 'runtime-x86_64'), 'sourcePackagesArchived': len(source_records), 'generatedProofs': generated})
    inventory_file.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    with tempfile.TemporaryDirectory() as directory:
        filesystem = Path(directory) / 'payload.squashfs'
        run('mksquashfs', appdir, filesystem, '-root-owned', '-noappend', '-comp', 'gzip', '-no-progress', '-processors', '2')
        with output.open('wb') as stream:
            for path in [runtime / 'runtime-x86_64', filesystem]:
                with path.open('rb') as source:
                    shutil.copyfileobj(source, stream)
    output.chmod(0o755)
    offset = int(run(output, '--appimage-offset').strip())
    if offset != (runtime / 'runtime-x86_64').stat().st_size:
        raise ValueError('Packed AppImage runtime offset mismatch')
    report['appImageSha256'] = audit.digest(output)
    report['projectCommit'] = os.environ['GITHUB_SHA']
    inventory_file.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(f'AppImage packed: {len(report["packages"])} binary packages, {len(source_records)} exact system source packages; no unresolved payload files')


if __name__ == '__main__':
    finalize(*(Path(arg).resolve() for arg in sys.argv[1:]))
