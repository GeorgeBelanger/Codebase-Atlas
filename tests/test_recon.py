import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'recon.py'
SPEC = importlib.util.spec_from_file_location('recon', SCRIPT)
recon = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(recon)


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)

    def put(self, path, data):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data.encode() if isinstance(data, str) else data)

    def test_inventory_preserves_small_files_categories_and_spaces(self):
        self.put('src/entry point.ts', 'export default 1;')
        self.put('migrations/001.sql', 'CREATE TABLE x (id int);\n')
        self.put('settings.yaml', 'enabled: true\n')
        self.put('package.json', '{}\n')
        self.put('tests/unit.test.ts', 'one\ntwo\n')
        self.put('README.md', '# Hello\n')
        self.put('empty.py', '')
        result = recon.inventory(self.root)
        rows = {r['path']: r for r in result['files']}
        self.assertEqual(rows['src/entry point.ts']['lines'], 1)
        self.assertEqual(rows['empty.py']['lines'], 0)
        self.assertEqual(rows['migrations/001.sql']['category'], 'migration')
        self.assertEqual(rows['settings.yaml']['category'], 'config')
        self.assertEqual(rows['package.json']['category'], 'manifest')
        self.assertEqual(rows['tests/unit.test.ts']['category'], 'test')
        self.assertEqual(rows['README.md']['category'], 'docs')
        self.assertEqual(result['summary'], {'files': 7, 'lines': 7})
        self.assertEqual(result['files'], recon.inventory(self.root)['files'])
        self.assertEqual(list(rows), sorted(rows))

    def test_ignores_binary_dependencies_symlinks_and_custom_exclusions(self):
        self.put('.gitignore', 'ignored.py\n')
        self.put('ignored.py', 'ignored')
        self.put('node_modules/pkg/index.js', 'dependency')
        self.put('binary.py', b'abc\0def')
        self.put('invalid.py', b'\xff\xfe')
        self.put('generated/a.py', 'generated')
        self.put('keep.py', 'keep\n')
        (self.root / 'outside.py').symlink_to('/etc/passwd')
        rows = recon.inventory(self.root, ['generated/*'])['files']
        self.assertEqual([r['path'] for r in rows], ['.gitignore', 'keep.py'])

    def test_tracked_files_remain_in_inventory_even_when_ignored(self):
        self.put('tracked.py', 'tracked')
        subprocess.run(['git', '-C', str(self.root), 'add', 'tracked.py'], check=True)
        self.put('.gitignore', '*.py\n')
        self.put('other.py', 'untracked ignored')
        result = subprocess.run(['bash', str(SCRIPT.with_suffix('.sh')), str(self.root), '--json'],
                                check=True, capture_output=True, text=True)
        rows = json.loads(result.stdout)['files']
        self.assertEqual([r['path'] for r in rows], ['.gitignore', 'tracked.py'])


if __name__ == '__main__':
    unittest.main()
