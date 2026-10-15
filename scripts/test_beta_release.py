import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('beta_assembly', Path(__file__).with_name('assemble-beta-release.py'))
assembly = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assembly)


class ReleaseAssemblyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.inputs = self.root / 'inputs'; self.inputs.mkdir()
        self.output = self.root / 'output'
        self.version = '0.5.8-beta.5'
        self.commit = 'a' * 40
        (self.root / 'package.json').write_text(json.dumps({'version': self.version}))
        (self.root / 'LICENSE').write_text('Project MIT notice\n')
        (self.root / 'THIRD_PARTY_NOTICES.md').write_text('Upstream notices\n')
        (self.root / 'src-tauri').mkdir()
        self.source = b'Original MPL dependency archive bytes'
        self.source_hash = hashlib.sha256(self.source).hexdigest()
        (self.root / 'src-tauri/Cargo.lock').write_text('[[package]]\nname = "test-mpl"\nversion = "1.0.0"\nchecksum = "' + self.source_hash + '"\n')
        for platform, (target, extension) in assembly.PLATFORMS.items():
            prefix = f'yingkuang_{self.version}_{platform}'
            (self.inputs / (prefix + extension)).write_bytes((platform + ' installer').encode())
            inventory = {'target': target, 'missingTexts': [], 'reviewRequired': [], 'packages': [{'ecosystem': 'cargo', 'name': 'test-mpl', 'version': '1.0.0', 'license': 'MPL-2.0'}]}
            (self.inputs / (prefix + '_dependency-inventory.json')).write_text(json.dumps(inventory))
            (self.inputs / (prefix + '_LICENSES.txt')).write_text(platform + ' complete license texts')
            checks = {'version': self.version, 'commit': self.commit, 'platform': platform, 'installedLicenseFilesVerified': 16, 'startup': 'passed', 'packageCheck': 'passed', 'installation': 'passed', 'uninstall': 'passed', 'themeSwitching': 'passed'}
            (self.inputs / (prefix + '_checks.json')).write_text(json.dumps(checks))
            self.rehash(platform)

        prefix = f'yingkuang_{self.version}_linux-appimage-x64'
        image = self.inputs / (prefix + '.AppImage'); image.write_bytes(b'AppImage fixture')
        source_bytes = b'Ubuntu original source archive'
        source_hash = hashlib.sha256(source_bytes).hexdigest()
        archive_files = {
            'checks.json': json.dumps({'version': self.version, 'commit': self.commit, **dict.fromkeys(['packageCheck', 'startup', 'extraction', 'notices'], 'passed')}).encode(),
            'payload/inventory.json': json.dumps({'unresolvedFiles': [], 'missingCopyright': [], 'remainingReview': [], 'packages': {'sample': {'sourcePackage': 'sample', 'sourceVersion': '1.0'}}}).encode(),
            'ubuntu-sources/sample/source.tar.gz': source_bytes,
            'ubuntu-sources/manifest.json': json.dumps({'packages': [{'name': 'sample', 'version': '1.0', 'directory': 'sample', 'sha256': {'source.tar.gz': source_hash}}]}).encode(),
            'runtime/manifest.json': json.dumps({'linkInputs': ['fixture'], 'alpineSources': [{'origin': n} for n in ['musl', 'zstd', 'zlib', 'mimalloc']], 'sha256': {}}).encode(),
        }
        shipment = {'version': self.version, 'commit': self.commit, 'appImageSha256': assembly.digest(image), 'sha256': {n: hashlib.sha256(b).hexdigest() for n, b in archive_files.items()}}
        with zipfile.ZipFile(self.inputs / (prefix + '_materials.zip'), 'w') as bundle:
            for name, data in archive_files.items(): bundle.writestr(name, data)
            bundle.writestr('SHIPMENT.json', json.dumps(shipment))
        self.rehash('linux-appimage-x64')

    def rehash(self, platform):
        prefix = f'yingkuang_{self.version}_{platform}'
        paths = sorted(p for p in self.inputs.glob(prefix + '*') if not p.name.endswith('_SHA256SUMS.txt'))
        (self.inputs / (prefix + '_SHA256SUMS.txt')).write_text('\n'.join(f'{assembly.digest(p)}  {p.name}' for p in paths) + '\n')

    def fetch(self, name, version, checksum, destination):
        destination.write_bytes(self.source)

    def build(self, fetch=None):
        return assembly.assemble(self.root, self.inputs, self.output, self.commit, fetch or self.fetch)

    def test_five_assets_preserve_installers_licenses_reports_and_original_sources(self):
        result = self.build()
        self.assertEqual(len(result['assets']), 5)
        self.assertEqual(result['originalSourceArchives'], 1)
        self.assertEqual((self.output / f'yingkuang_{self.version}_linux-x64.AppImage').read_bytes(), b'AppImage fixture')
        for platform, (_, extension) in assembly.PLATFORMS.items():
            name = f'yingkuang_{self.version}_{platform}{extension}'
            self.assertEqual((self.output / name).read_bytes(), (self.inputs / name).read_bytes())
        for line in (self.output / 'SHA256SUMS.txt').read_text().splitlines():
            checksum, name = line.split('  ', 1)
            self.assertEqual(checksum, assembly.digest(self.output / name))
        with zipfile.ZipFile(self.output / f'yingkuang_{self.version}_release-materials.zip') as bundle:
            self.assertEqual(bundle.read('sources/test-mpl-1.0.0.crate'), self.source)
            self.assertEqual(json.loads(bundle.read('sources.json'))['projectCommit'], self.commit)
            for platform in assembly.PLATFORMS:
                self.assertIn(platform + '/LICENSES.txt', bundle.namelist())
                self.assertEqual(json.loads(bundle.read(platform + '/checks.json'))['uninstall'], 'passed')
            for line in bundle.read('SHA256SUMS.txt').decode().splitlines():
                checksum, name = line.split('  ', 1)
                self.assertEqual(checksum, hashlib.sha256(bundle.read(name)).hexdigest())

    def test_installer_tampering_is_rejected(self):
        path = self.inputs / f'yingkuang_{self.version}_windows-x64.exe'
        path.write_bytes(b'changed after staging')
        with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
            self.build()

    def test_other_commit_is_rejected_even_with_valid_checksums(self):
        path = self.inputs / f'yingkuang_{self.version}_linux-x64_checks.json'
        report = json.loads(path.read_text()); report['commit'] = 'b' * 40
        path.write_text(json.dumps(report)); self.rehash('linux-x64')
        with self.assertRaisesRegex(ValueError, 'release source'):
            self.build()

    def test_pending_uninstall_is_not_reported_as_verified(self):
        path = self.inputs / f'yingkuang_{self.version}_linux-x64_checks.json'
        report = json.loads(path.read_text()); report['uninstall'] = 'pending'
        path.write_text(json.dumps(report)); self.rehash('linux-x64')
        with self.assertRaisesRegex(ValueError, 'uninstall did not pass'):
            self.build()

    def test_appimage_tampering_is_rejected(self):
        (self.inputs / f'yingkuang_{self.version}_linux-appimage-x64.AppImage').write_bytes(b'wrong binary')
        with self.assertRaisesRegex(ValueError, 'AppImage staged checksum mismatch'):
            self.build()

    def test_source_archive_must_match_lock_file(self):
        with self.assertRaisesRegex(ValueError, 'source archive checksum'):
            self.build(lambda name, version, checksum, destination: destination.write_bytes(b'wrong source'))


if __name__ == '__main__':
    unittest.main()
