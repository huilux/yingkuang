"""Combine verified Windows/Linux outputs into four public release assets."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import tomllib
import urllib.request
import zipfile

PLATFORMS = {
    'linux-x64': ('x86_64-unknown-linux-gnu', '.deb'),
    'windows-x64': ('x86_64-pc-windows-msvc', '.exe'),
}


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def obtain_crate(name, version, checksum, destination):
    cache = Path(os.environ.get('CARGO_HOME', Path.home() / '.cargo')) / 'registry/cache'
    filename = f'{name}-{version}.crate'
    cached = list(cache.glob('*/' + filename))
    if cached:
        shutil.copy2(cached[0], destination)
    else:
        url = f'https://static.crates.io/crates/{name}/{filename}'
        with urllib.request.urlopen(url, timeout=60) as response, destination.open('wb') as output:
            shutil.copyfileobj(response, output)
    if digest(destination) != checksum:
        raise ValueError(f'Original source checksum differs from Cargo.lock: {filename}')


def assemble(root, inputs, output, commit, fetch_crate=obtain_crate):
    version = json.loads((root / 'package.json').read_text())['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+-beta\.\d+', version) or not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise ValueError('Expected a beta version and full source commit')
    if output.exists() and any(output.iterdir()):
        raise ValueError('Use an empty output directory')
    validated = {}
    expected_inputs = set()
    for platform, (target, extension) in PLATFORMS.items():
        prefix = f'yingkuang_{version}_{platform}'
        filenames = [prefix + suffix for suffix in [extension, '_dependency-inventory.json', '_LICENSES.txt', '_checks.json']]
        sum_name = prefix + '_SHA256SUMS.txt'
        expected_inputs.update(filenames + [sum_name])
        sums = {}
        for line in (inputs / sum_name).read_text(encoding='utf-8-sig').splitlines():
            checksum, name = line.split('  ', 1)
            if name not in filenames or name in sums or digest(inputs / name) != checksum:
                raise ValueError('Staged asset checksum mismatch or unexpected path')
            sums[name] = checksum
        if set(sums) != set(filenames):
            raise ValueError('Incomplete platform checksums')
        checks = json.loads((inputs / (prefix + '_checks.json')).read_text(encoding='utf-8-sig'))
        if (checks.get('version'), checks.get('commit'), checks.get('platform')) != (version, commit, platform):
            raise ValueError('Package report does not match release source')
        for field in ['startup', 'packageCheck', 'installation', 'uninstall']:
            if checks.get(field) != 'passed':
                raise ValueError(f'{platform}: {field} did not pass')
        if checks.get('installedLicenseFilesVerified') != 16:
            raise ValueError('Installed license verification is incomplete')
        if platform == 'windows-x64' and checks.get('themeSwitching') != 'passed':
            raise ValueError('Installed Windows theme check did not pass')
        inventory = json.loads((inputs / (prefix + '_dependency-inventory.json')).read_text())
        if inventory['target'] != target or inventory['missingTexts'] or inventory['reviewRequired']:
            raise ValueError('Platform dependency license review is incomplete')
        validated[platform] = (prefix, extension, inventory)
    if set(p.name for p in inputs.iterdir()) != expected_inputs:
        raise ValueError('Unexpected files in staged platform outputs')
    lock = tomllib.loads((root / 'src-tauri/Cargo.lock').read_text())
    locked = {(p['name'], p['version']): p.get('checksum') for p in lock['package']}
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='yingkuang-release-') as directory:
        materials = Path(directory)
        for platform, (prefix, extension, _) in validated.items():
            shutil.copy2(inputs / (prefix + extension), output / (prefix + extension))
            destination = materials / platform
            destination.mkdir()
            for source, name in [('_checks.json', 'checks.json'), ('_dependency-inventory.json', 'dependency-inventory.json'), ('_LICENSES.txt', 'LICENSES.txt'), ('_SHA256SUMS.txt', 'BUILD-SHA256SUMS.txt')]:
                shutil.copy2(inputs / (prefix + source), destination / name)
        for name in ['LICENSE', 'THIRD_PARTY_NOTICES.md']:
            shutil.copy2(root / name, materials / name)
        needed = {}
        for _, _, inventory in validated.values():
            for package in inventory['packages']:
                if package['ecosystem'] == 'cargo' and 'MPL' in (package['license'] or ''):
                    needed[(package['name'], package['version'])] = package['license']
        sources = []
        (materials / 'sources').mkdir()
        for (name, source_version), license_name in sorted(needed.items()):
            if not re.fullmatch(r'[A-Za-z0-9_-]+', name) or not re.fullmatch(r'[0-9A-Za-z.+-]+', source_version):
                raise ValueError('Invalid dependency source name')
            checksum = locked.get((name, source_version))
            if not checksum:
                raise ValueError('Dependency source missing from Cargo.lock')
            filename = f'{name}-{source_version}.crate'
            destination = materials / 'sources' / filename
            fetch_crate(name, source_version, checksum, destination)
            if digest(destination) != checksum:
                raise ValueError('Dependency source archive checksum mismatch')
            sources.append({'name': name, 'version': source_version, 'license': license_name, 'sha256': checksum, 'archive': 'sources/' + filename, 'url': f'https://static.crates.io/crates/{name}/{filename}'})
        (materials / 'sources.json').write_text(json.dumps({'version': version, 'projectCommit': commit, 'projectSource': f'https://github.com/huilux/yingkuang/tree/{commit}', 'packages': sources}, indent=2) + '\n')
        (materials / 'README.txt').write_text('映框发布技术材料 / Yingkuang release materials\n\n普通用户只需下载对应系统的 EXE 或 DEB，无需解压本文件。\n安装包内已经包含项目与第三方许可证。\n\n本归档保存两平台的依赖清单、完整许可正文、安装/启动/卸载检查，以及 MPL 依赖的原始源码。\nBUILD-SHA256SUMS.txt 保留构建阶段原文件名的校验记录；归档内重命名文件以根目录 SHA256SUMS.txt 为准。\n源码提交与原始依赖下载地址见 sources.json。\n自动检查不能代替完整照片编辑、导出、升级和干净用户环境验收。\n', encoding='utf-8')
        inner = [f'{digest(file)}  {file.relative_to(materials).as_posix()}' for file in sorted(materials.rglob('*')) if file.is_file()]
        (materials / 'SHA256SUMS.txt').write_text('\n'.join(inner) + '\n')
        archive = output / f'yingkuang_{version}_release-materials.zip'
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as bundle:
            for file in sorted(materials.rglob('*')):
                if file.is_file():
                    bundle.write(file, file.relative_to(materials))
    sums = [f'{digest(file)}  {file.name}' for file in sorted(output.iterdir())]
    (output / 'SHA256SUMS.txt').write_text('\n'.join(sums) + '\n')
    return {'version': version, 'commit': commit, 'assets': sorted(p.name for p in output.iterdir()), 'originalSourceArchives': len(sources)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input_directory', type=Path)
    parser.add_argument('output_directory', type=Path)
    parser.add_argument('commit')
    args = parser.parse_args()
    print(json.dumps(assemble(Path(__file__).resolve().parent.parent, args.input_directory, args.output_directory, args.commit)))
