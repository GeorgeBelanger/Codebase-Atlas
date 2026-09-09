#!/usr/bin/env python3
"""Build validated JSON (preferred) or trusted legacy JavaScript into an offline atlas."""
import argparse, html, json, pathlib, subprocess, sys

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('data')
    parser.add_argument('output')
    parser.add_argument('theme', nargs='?')
    parser.add_argument('--repo', help='Measure referenced paths in a clean Git repository')
    args = parser.parse_args()
    here = pathlib.Path(__file__).resolve().parent.parent
    command = ['node', str(here / 'scripts/data.js'), args.data]
    if args.repo:
        command += ['--repo', args.repo]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.stderr:
        print(result.stderr, file=sys.stderr, end='')
    if result.returncode:
        return result.returncode
    data = json.loads(result.stdout)
    constants = '\n'.join('const ' + k + '=' + json.dumps(data[k], ensure_ascii=True).replace('<', '\\u003c') + ';'
                          for k in ['G', 'N', 'COPY', 'E', 'STEPS', 'META', 'JOURNEYS'])
    theme = pathlib.Path(args.theme).read_text() if args.theme else ''
    page = (here / 'assets/engine.html').read_text()
    page = page.replace('/*__GRAPH__*/', (here / 'assets/graph.js').read_text())
    page = page.replace('/*__EXPLORER__*/', (here / 'assets/explorer.js').read_text())
    page = page.replace('__TITLE__', html.escape(data['META']['title'], quote=True))
    page = page.replace('/*__THEME__*/', theme).replace('/*__DATA__*/', constants)
    page = '<meta charset="utf-8">\n' + page
    pathlib.Path(args.output).write_text(page)
    print(f'built {args.output} ({len(page)//1024} KB)')
    return 0

if __name__ == '__main__':
    sys.exit(main())
