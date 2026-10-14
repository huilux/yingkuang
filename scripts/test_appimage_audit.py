import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('appimage_audit', Path(__file__).with_name('audit-appimage.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class ProvenanceTests(unittest.TestCase):
    def test_matching_filename_alone_does_not_prove_origin(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            payload, original, other = (root / name for name in ['payload', 'original', 'other'])
            payload.write_bytes(b'copied resource')
            original.write_bytes(payload.read_bytes())
            other.write_bytes(b'unrelated resource')
            _, matches = audit.match_file(payload, [('right', original), ('wrong', other)])
            self.assertEqual([entry['package'] for entry in matches], ['right'])
            self.assertEqual(matches[0]['evidence'], 'sha256')

    def test_patched_elf_is_distinguished_from_identical_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            payload, original = root / 'payload', root / 'original'
            payload.write_bytes(b'patched')
            original.write_bytes(b'original')
            with patch.object(audit, 'build_id', return_value='same-build-id'):
                _, matches = audit.match_file(payload, [('lib', original)])
            self.assertEqual(matches[0]['evidence'], 'elf-build-id')

    def test_output_must_not_pollute_the_payload_or_reuse_old_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                audit.audit(root, root / 'report')
            with self.assertRaises(ValueError):
                audit.audit(root / 'payload', root)


if __name__ == '__main__':
    unittest.main()
