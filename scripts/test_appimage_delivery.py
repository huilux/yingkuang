"""Guard source identity and ELF transformations, beyond matching build IDs."""
import hashlib
import importlib.util
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parent / 'appimage' / filename)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


finalize = module('appimage_finalize', 'finalize.py')
sources = module('ubuntu_sources', 'ubuntu-sources.py')
runtime = module('runtime_sources', 'runtime-sources.py')
renderer = module('renderer_observer', 'renderer.py')


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

    def test_launcher_runs_patched_webkit_helpers_from_outside_the_appdir(self):
        with tempfile.TemporaryDirectory() as directory:
            appdir = Path(directory) / 'application'; (appdir / 'usr/bin').mkdir(parents=True)
            helper = appdir / 'usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitNetworkProcess'
            helper.parent.mkdir(parents=True); helper.write_text('#!/bin/sh\nexit 0\n'); helper.chmod(0o755)
            app = appdir / 'usr/bin/yingkuang'
            app.write_text('#!/bin/sh\nexec ././/lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitNetworkProcess\n'); app.chmod(0o755)
            launcher = appdir / 'AppRun'
            shutil.copy2(Path(__file__).parent / 'appimage/AppRun', launcher); launcher.chmod(0o755)
            result = subprocess.run([str(launcher)], cwd=directory, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_renderer_observation_uses_parent_identity_not_appimage_in_argv(self):
        with tempfile.TemporaryDirectory() as directory:
            proc = Path(directory)
            for pid, name, parent in [(100, 'yingkuang', 1), (110, 'bwrap', 100), (120, 'WebKitWebProces', 110), (130, 'WebKitWebProces', 1)]:
                entry = proc / str(pid); entry.mkdir()
                (entry / 'status').write_text(f'Name:\t{name}\nPPid:\t{parent}\n')
                (entry / 'cmdline').write_bytes(name.encode() + b'\0')
            self.assertEqual(renderer.renderer_children(100, proc), [120])
            (proc / '110/status').write_text('Name:\tbwrap\nPPid:\t120\n')
            self.assertEqual(renderer.renderer_children(100, proc), [])

    def test_graphics_policy_removes_only_the_driver_facing_wayland_client(self):
        with tempfile.TemporaryDirectory() as directory:
            appdir = Path(directory); library = appdir / 'usr/lib'; library.mkdir(parents=True)
            for name in ['libwayland-client.so.0', 'libwayland-cursor.so.0', 'libwayland-egl.so.1', 'libwayland-client.so.notes']:
                (library / name).write_bytes(b'library fixture')
            removed = finalize.remove_host_graphics_libraries(appdir)
            self.assertEqual([p['path'] for p in removed], ['usr/lib/libwayland-client.so.0'])
            self.assertFalse((library / 'libwayland-client.so.0').exists())
            self.assertTrue((library / 'libwayland-cursor.so.0').exists())
            self.assertTrue((library / 'libwayland-egl.so.1').exists())
            self.assertTrue((library / 'libwayland-client.so.notes').exists())

    def test_appimage_supervisor_cleanup_stops_its_test_owned_children(self):
        script = 'import subprocess,sys,time; child=subprocess.Popen([sys.executable,"-c","import time; time.sleep(60)"]); print(child.pid,flush=True); time.sleep(60)'
        process = subprocess.Popen([sys.executable, '-c', script], stdout=subprocess.PIPE, text=True, start_new_session=True)
        try:
            child = int(process.stdout.readline())
            renderer.stop_process_group(process)
            status = Path('/proc') / str(child) / 'stat'
            if status.exists(): self.assertEqual(status.read_text().rsplit(')', 1)[1].split()[0], 'Z')
        finally:
            if process.poll() is None: renderer.stop_process_group(process)
            process.stdout.close()

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
