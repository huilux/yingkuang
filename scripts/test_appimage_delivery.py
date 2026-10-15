"""Guard source identity and ELF transformations, beyond matching build IDs."""
import hashlib
import importlib.util
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parent / 'appimage' / filename)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


finalize = module('appimage_finalize', 'finalize.py')
sources = module('ubuntu_sources', 'ubuntu-sources.py')
runtime = module('runtime_sources', 'runtime-sources.py')


class DeliveryTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('cc') and shutil.which('patchelf'), 'Requires ELF tools')
    def test_rpath_change_allowed_but_changed_code_with_same_build_id_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.c'; original = root / 'original'; payload = root / 'payload'
            source.write_text('int main(void) { return 0; }\n')
            subprocess.run(['cc', str(source), '-o', str(original)], check=True)
            shutil.copy2(original, payload)
            subprocess.run(['patchelf', '--set-rpath', '$ORIGIN', str(payload)], check=True)
            finalize.verify_elf(payload, original)
            sections = finalize.elf_sections(payload.read_bytes())
            data = payload.read_bytes()
            code = sections['.text']; offset = data.index(code)
            modified = bytearray(data); modified[offset] ^= 1
            payload.write_bytes(modified)
            self.assertEqual(finalize.audit.build_id(payload), finalize.audit.build_id(original))
            with self.assertRaisesRegex(ValueError, 'code/data transformation'):
                finalize.verify_elf(payload, original)

    def test_source_built_fuse_headers_do_not_require_an_apk_owner(self):
        self.assertIn('libfuse 3.15.0', runtime.pinned_origin('/usr/include/fuse3/fuse.h'))
        self.assertIn('squashfuse 0.5.2', runtime.pinned_origin('/usr/local/include/squashfuse/squashfuse.h'))
        self.assertIsNone(runtime.pinned_origin('/usr/include/stdlib.h'))
        self.assertIsNone(runtime.pinned_origin('/usr/local/lib/unrelated.a'))

    def test_abuild_cache_links_are_removed_while_real_recipe_and_sources_remain(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); recipe = root / 'recipe'; recipe.mkdir()
            original = recipe / 'fix.patch'; original.write_text('original patch')
            (recipe / 'src').mkdir(); link = recipe / 'src/fix.patch'; link.symlink_to(original)
            runtime.remove_transient_links(recipe)
            self.assertFalse(link.is_symlink())
            self.assertEqual(original.read_text(), 'original patch')

    def test_source_descriptor_identity_and_every_original_archive_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'sample.orig.tar.xz'; archive.write_bytes(b'original source')
            descriptor = root / 'sample.dsc'
            descriptor.write_text(f'Source: sample\nVersion: 1:2.0-1ubuntu1\nChecksums-Sha256:\n {hashlib.sha256(archive.read_bytes()).hexdigest()} {archive.stat().st_size} {archive.name}\n')
            self.assertEqual(len(sources.verify_source(root, 'sample', '1:2.0-1ubuntu1')), 2)
            with self.assertRaisesRegex(ValueError, 'identity'):
                sources.verify_source(root, 'sample', '2.0')
            archive.write_bytes(b'different source')
            with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                sources.verify_source(root, 'sample', '1:2.0-1ubuntu1')


if __name__ == '__main__':
    unittest.main()
