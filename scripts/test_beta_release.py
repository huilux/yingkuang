import hashlib
import importlib.util
import json
from pathlib import Path
from macos_release_materials import MACOS_TARGETS
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
        (self.root / 'src').mkdir()
        (self.root / 'src/font-catalog.json').write_text(json.dumps([
            {'files': [{'path': f'font{index}/regular.ttf'}, {'path': f'font{index}/bold.ttf'}]} for index in range(6)
        ]))
        self.source = b'Original MPL dependency archive bytes'
        self.source_hash = hashlib.sha256(self.source).hexdigest()
        (self.root / 'src-tauri/Cargo.lock').write_text('[[package]]\nname = "test-mpl"\nversion = "1.0.0"\nchecksum = "' + self.source_hash + '"\n')
        for platform, (target, extension) in assembly.PLATFORMS.items():
            prefix = f'yingkuang_{self.version}_{platform}'
            (self.inputs / (prefix + extension)).write_bytes((platform + ' installer').encode())
            inventory = {'target': target, 'missingTexts': [], 'reviewRequired': [], 'packages': [{'ecosystem': 'cargo', 'name': 'test-mpl', 'version': '1.0.0', 'license': 'MPL-2.0'}]}
            (self.inputs / (prefix + '_dependency-inventory.json')).write_text(json.dumps(inventory))
            (self.inputs / (prefix + '_LICENSES.txt')).write_text(platform + ' complete license texts')
            checks = {'version': self.version, 'commit': self.commit, 'platform': platform, 'installedLicenseFilesVerified': 10, 'startup': 'passed', 'packageCheck': 'passed', 'installation': 'passed', 'uninstall': 'passed', 'themeSwitching': 'passed'}
            (self.inputs / (prefix + '_checks.json')).write_text(json.dumps(checks))
            self.rehash(platform)

        prefix = f'yingkuang_{self.version}_linux-appimage-x64'
        image = self.inputs / (prefix + '.AppImage'); image.write_bytes(b'AppImage fixture')
        source_bytes = b'Ubuntu original source archive'
        source_hash = hashlib.sha256(source_bytes).hexdigest()
        archive_files = {
            'checks.json': json.dumps({'version': self.version, 'commit': self.commit, **dict.fromkeys(['packageCheck', 'startup', 'extraction', 'notices', 'nativePhotoProcessing'], 'passed')}).encode(),
            'payload/inventory.json': json.dumps({'unresolvedFiles': [], 'missingCopyright': [], 'remainingReview': [], 'packages': {'sample': {'sourcePackage': 'sample', 'sourceVersion': '1.0'}}}).encode(),
            'ubuntu-sources/sample/source.tar.gz': source_bytes,
            'ubuntu-sources/manifest.json': json.dumps({'packages': [{'name': 'sample', 'version': '1.0', 'directory': 'sample', 'sha256': {'source.tar.gz': source_hash}}]}).encode(),
            'runtime/manifest.json': json.dumps({'linkInputs': [{'origin': n, 'aportsCommit': 'c' * 40} for n in ['musl', 'zstd', 'zlib', 'mimalloc2']], 'alpineSources': [{'origin': n, 'aportsCommit': 'c' * 40} for n in ['musl', 'zstd', 'zlib', 'mimalloc2']], 'sha256': {}}).encode(),
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

    def test_installed_license_count_follows_the_current_font_families(self):
        path = self.inputs / f'yingkuang_{self.version}_linux-x64_checks.json'
        report = json.loads(path.read_text()); report['installedLicenseFilesVerified'] = 16
        path.write_text(json.dumps(report)); self.rehash('linux-x64')
        with self.assertRaisesRegex(ValueError, 'license verification is incomplete'):
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

    def test_runtime_source_origin_must_cover_actual_link_inputs(self):
        prefix = f'yingkuang_{self.version}_linux-appimage-x64'
        archive = self.inputs / (prefix + '_materials.zip')
        with zipfile.ZipFile(archive) as bundle:
            files = {n: bundle.read(n) for n in bundle.namelist()}
        runtime = json.loads(files['runtime/manifest.json'])
        runtime['alpineSources'] = [p for p in runtime['alpineSources'] if p['origin'] != 'mimalloc2']
        files['runtime/manifest.json'] = json.dumps(runtime).encode()
        shipment = json.loads(files['SHIPMENT.json'])
        shipment['sha256']['runtime/manifest.json'] = hashlib.sha256(files['runtime/manifest.json']).hexdigest()
        files['SHIPMENT.json'] = json.dumps(shipment).encode()
        with zipfile.ZipFile(archive, 'w') as bundle:
            for name, data in files.items(): bundle.writestr(name, data)
        self.rehash('linux-appimage-x64')
        with self.assertRaisesRegex(ValueError, 'static runtime source inventory'):
            self.build()

    def test_appimage_tampering_is_rejected(self):
        (self.inputs / f'yingkuang_{self.version}_linux-appimage-x64.AppImage').write_bytes(b'wrong binary')
        with self.assertRaisesRegex(ValueError, 'AppImage staged checksum mismatch'):
            self.build()

    def test_source_archive_must_match_lock_file(self):
        with self.assertRaisesRegex(ValueError, 'source archive checksum'):
            self.build(lambda name, version, checksum, destination: destination.write_bytes(b'wrong source'))


class MacReleaseAssemblyTests(ReleaseAssemblyTests):
    def setUp(self):
        super().setUp()
        notice = 'licenses/upstream/test-objc/1.0.0/LICENSE.md'
        path = self.root / notice; path.parent.mkdir(parents=True); path.write_text('Original upstream SDK/author notice')
        record = {'schemaVersion': 1, 'notesFile': 'licenses/MACOS-REVIEW.md', 'packages': [
            {'ecosystem': 'cargo', 'name': 'test-objc', 'version': '1.0.0', 'notices': [{'path': notice, 'sha256': assembly.digest(path)}]}]}
        (self.root / 'licenses/macos-review.json').write_text(json.dumps(record))
        (self.root / 'licenses/MACOS-REVIEW.md').write_text('Scoped review; ad-hoc; manual acceptance pending')
        with (self.root / 'src-tauri/Cargo.lock').open('a') as lock:
            lock.write('[[package]]\nname = "test-objc"\nversion = "1.0.0"\nchecksum = "' + self.source_hash + '"\n')
        for platform, (target, architecture) in MACOS_TARGETS.items():
            prefix = f'yingkuang_{self.version}_{platform}'
            review = {'ecosystem': 'cargo', 'name': 'test-objc', 'version': '1.0.0', 'reason': 'SDK notice'}
            inventory = {'target': target, 'missingTexts': [], 'reviewRequired': [review], 'packages': [
                {'ecosystem': 'cargo', 'name': 'test-mpl', 'version': '1.0.0', 'license': 'MPL-2.0'},
                {'ecosystem': 'cargo', 'name': 'test-objc', 'version': '1.0.0', 'license': 'MIT', 'reviewRequired': 'SDK notice', 'authors': ['Original Author'], 'files': [notice]}]}
            checks = {'version': self.version, 'commit': self.commit, 'platform': platform, 'architecture': architecture,
                      'dmgMounted': 'passed', 'nativeWindow': 'passed', 'systemLibrariesOnly': 'passed',
                      'signature': 'ad-hoc verified', 'notarized': False, 'interactiveAcceptance': 'pending',
                      'installedLicenseFilesVerified': 10, 'dependencyReview': 'reviewed', 'upstreamReviewItems': [review],
                      'reviewRecordSha256': assembly.digest(self.root / 'licenses/macos-review.json'),
                      'linkedLibraries': ['/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit'], 'originalSourceArchives': 2}
            sources = {'projectCommit': self.commit, 'packages': [
                {'name': name, 'version': '1.0.0', 'archive': f'sources/{name}-1.0.0.crate', 'sha256': self.source_hash} for name in ['test-mpl', 'test-objc']]}
            files = {
                prefix + '.dmg': (platform + ' DMG').encode(),
                'checks.json': json.dumps(checks).encode(),
                f'licenses/dependencies/{target}/inventory.json': json.dumps(inventory).encode(),
                'licenses/MIT.txt': (self.root / 'LICENSE').read_bytes(),
                'licenses/THIRD_PARTY_NOTICES.md': (self.root / 'THIRD_PARTY_NOTICES.md').read_bytes(),
                'macos-review.json': (self.root / 'licenses/macos-review.json').read_bytes(),
                'MACOS-REVIEW.md': (self.root / 'licenses/MACOS-REVIEW.md').read_bytes(),
                'sources.json': json.dumps(sources).encode(),
                'sources/test-mpl-1.0.0.crate': self.source,
                'sources/test-objc-1.0.0.crate': self.source,
            }
            self.write_mac_archive(platform, files)

    def write_mac_archive(self, platform, files):
        prefix = f'yingkuang_{self.version}_{platform}'
        sums = '\n'.join(f'{hashlib.sha256(data).hexdigest()}  {name}' for name, data in files.items()) + '\n'
        with zipfile.ZipFile(self.inputs / (prefix + '-test.zip'), 'w') as bundle:
            for name, data in files.items(): bundle.writestr(name, data)
            bundle.writestr('SHA256SUMS.txt', sums)
        archive = self.inputs / (prefix + '-test.zip')
        (self.inputs / (prefix + '-test_SHA256SUMS.txt')).write_text(f'{assembly.digest(archive)}  {archive.name}\n')

    def change_mac(self, change):
        platform = 'macos-arm64'
        with zipfile.ZipFile(self.inputs / f'yingkuang_{self.version}_{platform}-test.zip') as bundle:
            files = {n: bundle.read(n) for n in bundle.namelist() if n != 'SHA256SUMS.txt'}
        change(files)
        self.write_mac_archive(platform, files)

    def build(self, fetch=None):
        return assembly.assemble(self.root, self.inputs, self.output, self.commit, fetch or self.fetch, include_macos=True)

    # The inherited checks also exercise the same guards with macOS enabled.
    def test_five_assets_preserve_installers_licenses_reports_and_original_sources(self):
        result = self.build()
        self.assertEqual(len(result['assets']), 7)
        with zipfile.ZipFile(self.output / f'yingkuang_{self.version}_release-materials.zip') as bundle:
            for platform in ['macos-arm64', 'macos-x64']:
                dmg = f'yingkuang_{self.version}_{platform}.dmg'
                self.assertEqual((self.output / dmg).read_bytes(), (platform + ' DMG').encode())
                self.assertNotIn(f'{platform}/{dmg}', bundle.namelist())
                self.assertEqual(json.loads(bundle.read(platform + '/checks.json'))['interactiveAcceptance'], 'pending')
                self.assertEqual(bundle.read(platform + '/sources/test-objc-1.0.0.crate'), self.source)
            for line in bundle.read('SHA256SUMS.txt').decode().splitlines():
                checksum, name = line.split('  ', 1)
                self.assertEqual(checksum, hashlib.sha256(bundle.read(name)).hexdigest())
        self.assertEqual(len((self.output / 'SHA256SUMS.txt').read_text().splitlines()), 6)

    def test_mac_archive_tampering_is_rejected(self):
        path = self.inputs / f'yingkuang_{self.version}_macos-arm64-test.zip'
        path.write_bytes(path.read_bytes() + b'tampered')
        with self.assertRaisesRegex(ValueError, 'macOS staged checksum'):
            self.build()

    def test_mac_wrong_architecture_is_rejected(self):
        def change(files):
            checks = json.loads(files['checks.json']); checks['architecture'] = 'x86_64'
            files['checks.json'] = json.dumps(checks).encode()
        self.change_mac(change)
        with self.assertRaisesRegex(ValueError, 'source/architecture'):
            self.build()

    def test_mac_unknown_review_version_is_rejected(self):
        def change(files):
            name = 'licenses/dependencies/aarch64-apple-darwin/inventory.json'
            inventory = json.loads(files[name]); inventory['reviewRequired'][0]['version'] = '2.0.0'
            inventory['packages'][1]['version'] = '2.0.0'
            checks = json.loads(files['checks.json']); checks['upstreamReviewItems'] = inventory['reviewRequired']
            files[name] = json.dumps(inventory).encode(); files['checks.json'] = json.dumps(checks).encode()
        self.change_mac(change)
        with self.assertRaisesRegex(ValueError, 'Unresolved macOS dependency review'):
            self.build()

    def test_mac_source_archive_must_match_lock(self):
        self.change_mac(lambda files: files.update({'sources/test-objc-1.0.0.crate': b'wrong original source'}))
        with self.assertRaisesRegex(ValueError, 'macOS original source checksum'):
            self.build()

    def test_mac_unsafe_archive_path_is_rejected(self):
        self.change_mac(lambda files: files.update({'../escaped.txt': b'unsafe'}))
        with self.assertRaisesRegex(ValueError, 'Unsafe macOS archive path'):
            self.build()
        self.assertFalse((self.root / 'escaped.txt').exists())

    def test_mac_modified_review_evidence_is_rejected(self):
        self.change_mac(lambda files: files.update({'MACOS-REVIEW.md': b'changed scope'}))
        with self.assertRaisesRegex(ValueError, 'review evidence differs'):
            self.build()

    def test_mac_missing_review_item_is_rejected(self):
        def change(files):
            name = 'licenses/dependencies/aarch64-apple-darwin/inventory.json'
            inventory = json.loads(files[name]); inventory['reviewRequired'] = []
            checks = json.loads(files['checks.json']); checks['upstreamReviewItems'] = []
            files[name] = json.dumps(inventory).encode(); files['checks.json'] = json.dumps(checks).encode()
        self.change_mac(change)
        with self.assertRaisesRegex(ValueError, 'Incomplete macOS dependency review inventory'):
            self.build()


if __name__ == '__main__':
    unittest.main()
