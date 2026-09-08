#!/usr/bin/env python3
"""Read-only, deterministic repository inventory. No external dependencies."""
import argparse
from datetime import datetime, timezone
import fnmatch
import json
from pathlib import Path
import subprocess

SKIP_DIRS = {'.git', 'node_modules', 'vendor', 'dist', 'build', '.venv', 'venv',
             '__pycache__', '.next', '.nuxt', 'coverage', 'target', '.cache'}
SOURCE = set('.py .pyi .js .jsx .mjs .cjs .ts .tsx .go .rs .rb .java .kt .kts .swift .c .h .cc .cpp .hpp .cs .fs .ex .exs .erl .hrl .scala .php .sh .bash .zsh .pl .pm .lua .r .dart .vue .svelte .html .css .scss .sass .less .sql .graphql .gql .proto .tf .hcl .clj .cljs .cljc .edn .elm .hs .ml .mli .jl .m .mm .sol .ipynb'.split())
CONFIG = {'.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.xml', '.properties', '.env'}
DOCS = {'.md', '.mdx', '.rst', '.txt', '.adoc'}
MANIFESTS = {'package.json', 'pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt',
             'cargo.toml', 'go.mod', 'gemfile', 'pom.xml', 'build.gradle', 'build.gradle.kts',
             'composer.json', 'mix.exs', 'pubspec.yaml', 'package.swift', 'makefile', 'dockerfile'}
ARTIFACTS = {'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', 'uv.lock',
             'cargo.lock', 'go.sum', 'composer.lock', 'gemfile.lock'}


def git(root, *args):
    return subprocess.run(['git', '-C', str(root), *args], stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL, check=False)


def category(path):
    name = path.name.lower()
    parts = {p.lower() for p in path.parts[:-1]}
    if name in MANIFESTS or name.startswith('requirements') and path.suffix == '.txt':
        return 'manifest'
    if parts & {'migration', 'migrations'}:
        return 'migration'
    if parts & {'test', 'tests', '__tests__', 'spec', 'specs'} or name.startswith('test_') or any(s in name for s in ('.test.', '.spec.', '_test.')):
        return 'test'
    if path.suffix.lower() in DOCS:
        return 'docs'
    if path.suffix.lower() in CONFIG or name.startswith('.env') or name in {'.gitignore', '.dockerignore', '.editorconfig'}:
        return 'config'
    if path.suffix.lower() in SOURCE:
        return 'source'
    return None


def inventory(root, exclusions=()):
    root = Path(root).resolve(strict=True)
    if not root.is_dir():
        raise ValueError('repository must be a directory')
    listed = git(root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard')
    if listed.returncode:
        raise ValueError('repository must be inside a Git working tree')
    records = []
    for raw in sorted(set(listed.stdout.split(b'\0'))):
        if not raw:
            continue
        relative = Path(raw.decode('utf-8', errors='surrogateescape'))
        label = relative.as_posix()
        if relative.is_absolute() or '..' in relative.parts or set(relative.parts) & SKIP_DIRS:
            continue
        if relative.name.lower() in ARTIFACTS or any(fnmatch.fnmatchcase(label, p) for p in exclusions):
            continue
        kind = category(relative)
        if kind is None:
            continue
        path = root / relative
        # Never follow symlinks: avoid duplicate content and paths outside the repo.
        if any(root.joinpath(*relative.parts[:i]).is_symlink() for i in range(1, len(relative.parts) + 1)):
            continue
        if not path.is_file():
            continue
        data = path.read_bytes()
        if b'\0' in data:
            continue
        try:
            data.decode('utf-8')
        except UnicodeDecodeError:
            continue
        lines = data.count(b'\n') + int(bool(data) and not data.endswith(b'\n'))
        records.append({'path': label, 'lines': lines, 'category': kind})
    commit = git(root, 'rev-parse', 'HEAD')
    remote = git(root, 'remote', 'get-url', 'origin')
    return {'source': {'commit': commit.stdout.decode().strip() if not commit.returncode else None,
                       'repository': remote.stdout.decode().strip() if not remote.returncode else None,
                       'generatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')},
            'files': records,
            'summary': {'files': len(records), 'lines': sum(row['lines'] for row in records)}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repo', nargs='?', default='.')
    parser.add_argument('--json', action='store_true', help='emit complete structured inventory')
    parser.add_argument('--exclude', action='append', default=[], metavar='GLOB', help='exclude repository-relative paths matching a glob; repeatable')
    args = parser.parse_args()
    try:
        result = inventory(args.repo, args.exclude)
    except (ValueError, OSError) as error:
        parser.exit(1, f'recon: {error}\n')
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=True))
        return
    print(f"INVENTORY: {result['summary']['files']} files, {result['summary']['lines']} lines")
    print('Counts cover text source, configuration, manifests, migrations, tests, and docs; dependency artifacts are excluded.')
    for kind in ('manifest', 'config', 'migration', 'test', 'docs', 'source'):
        rows = [r for r in result['files'] if r['category'] == kind]
        print(f'\n{kind.upper()} ({len(rows)})')
        for row in rows:
            print(f"{row['lines']:>7}  {json.dumps(row['path'], ensure_ascii=False)}")
    print('\nUse --json for the complete machine-readable inventory and source snapshot.')


if __name__ == '__main__':
    main()
