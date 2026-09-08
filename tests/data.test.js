const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawnSync, execFileSync } = require('node:child_process');
const { validateData, normalizeData, loadData, prepareData, serializeData } = require('../scripts/data');
function fixture() {
    return { schemaVersion: 2, G: { app: { s: 'APP', n: 'Application', c: '#123456' } }, N: [{ id: 'a', n: 'A', c: 'A1', g: 'app', x: 0, y: 0, w: 2, h: 2, w1: 'What', h1: 'How', f: [['src/a.js', 10]], s: ['JS'] }, { id: 'b', n: 'B', c: 'B1', g: 'app', x: 3, y: 0, w: 2, h: 2, w1: 'What', h1: 'How', f: [['src/b.js', 20]], s: ['JS'] }], COPY: { a: ['A', 'one', 'why', 'risk'], b: ['B', 'one', 'why', 'risk'] }, E: [['a', 'b', 1], ['b', 'a', 0]], STEPS: [['a', 'Start here', null], ['b', 'Call B', ['a', 'b']]], META: { title: 'Atlas', name: 'App', tag: 'Flow', run: 'Run', stats: [['LINES', '#lines'], ['FILES', '#files']], key: [['Height', 'Code']], intro: { eyebrow: 'All', h: 'Application', p: ['A description'] }, movements: [['Start', 'Call A', 'a']], cta: 'Run', done: 'Complete', chapters: [[0, 'Start']], source: { fictional: true } } };
}
const valid = d => assert.deepEqual(validateData(d).errors, []);
test('JSON contract derives exact deduplicated metrics and heights', () => {
    const d = fixture();
    d.N[0].f.push(['src/a.js', 10]);
    d.N[1].f.push(['src/a.js', 10]);
    valid(d);
    const n = normalizeData(d);
    assert.equal(n.META.metrics.mappedLines, 30);
    assert.equal(n.META.metrics.mappedFiles, 2);
    assert.equal(n.N[0].lines, 10);
    assert.equal(n.N[1].lines, 30);
    assert.equal(n.N[0].f.length, 1);
    assert.equal(n.N[0].z, 18.4);
    assert.equal(n.META.stats[0][1], '30');
    assert.equal(n.JOURNEYS.length, 1);
});
test('nested malformed input reports errors without throwing', () => {
    const edits = [d => d.N = [null], d => d.E = [null], d => d.COPY.a = 3, d => d.N[0].f = {}, d => d.N[0].f = [null], d => d.N[0].s = 3, d => d.META.movements = null, d => d.META.chapters = [null], d => d.META.intro = null, d => d.JOURNEYS = [null], d => d.STEPS = [null], d => d.N[0].evidence = [null], d => d.META.inventory = [null]];
    for (const edit of edits) {
        const d = fixture();
        edit(d);
        assert.doesNotThrow(() => validateData(d));
        assert.ok(validateData(d).errors.length);
    }
});
test('rejects duplicate ids, invalid geometry, unsafe paths, conflicts and aggregate overlap', () => {
    const edits = [d => d.N[1].id = 'a', d => d.N[0].id = '__proto__', d => d.N[0].x = NaN, d => d.N[0].w = 0, d => d.N[0].z = Infinity, d => d.N[0].f = [['../secret', 1]], d => d.N[1].f = [['src/a.js', 12]], d => d.N[1].f = [['src', 20]], d => d.G.app.c = 'red;display:none', d => d.E[0][1] = 'missing'];
    for (const edit of edits) {
        const d = fixture();
        edit(d);
        assert.ok(validateData(d).errors.length);
    }
});
test('journeys support retries but require actual edges, target agreement and explicit discontinuities', () => {
    const d = fixture();
    d.JOURNEYS = [{ id: 'retry', name: 'Retry', steps: [...d.STEPS, ['a', 'Retry A', ['b', 'a']], ['b', 'Retry B', ['a', 'b']]], chapters: [[0, 'Start'], [2, 'Retry']] }];
    valid(d);
    d.JOURNEYS[0].steps[2][2] = ['a', 'b'];
    assert.ok(validateData(d).errors.length);
    d.JOURNEYS[0].steps[2] = ['a', 'Jump', null, { discontinuity: 'Operator restarts the workflow' }];
    valid(d);
    d.JOURNEYS[0].chapters[1][0] = 9;
    assert.ok(validateData(d).errors.length);
});
test('verified claims require source commit and evidence', () => {
    const d = fixture();
    d.N[0].status = 'verified';
    assert.ok(validateData(d).errors.length);
    d.N[0].evidence = [{ path: 'src/a.js', startLine: 1, endLine: 3 }];
    d.META.source = { commit: 'a'.repeat(40) };
    valid(d);
    d.N[0].evidence[0].endLine = 0;
    assert.ok(validateData(d).errors.length);
});
test('legacy JS and JSON load equivalently; malformed JSON cannot execute JavaScript', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-data-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const d = fixture(), json = path.join(dir, 'data.json'), js = path.join(dir, 'data.js');
    fs.writeFileSync(json, JSON.stringify(d));
    fs.writeFileSync(js, ['G', 'N', 'COPY', 'E', 'STEPS', 'META'].map(k => 'const ' + k + '=' + JSON.stringify(d[k]) + ';').join('\n'));
    assert.deepEqual(prepareData(json).data, prepareData(js).data);
    fs.writeFileSync(json, 'globalThis.executed=true');
    assert.throws(() => loadData(json));
    assert.equal(globalThis.executed, undefined);
});
test('serialization and build escape script termination and title HTML; invalid build preserves output', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-build-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const d = fixture();
    d.META.title = '</title><script>bad()</script>';
    d.N[0].w1 = '</script><script>bad()</script>';
    const serialized = serializeData(normalizeData(d));
    assert.ok(!serialized.includes('</script>'));
    const input = path.join(dir, 'data.json'), output = path.join(dir, 'atlas.html'), build = path.resolve(__dirname, '../scripts/build.py');
    fs.writeFileSync(input, JSON.stringify(d));
    let result = spawnSync('python3', [build, input, output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const page = fs.readFileSync(output, 'utf8');
    assert.ok(!page.includes('<script>bad()'));
    assert.ok(page.includes('&lt;/title&gt;'));
    fs.writeFileSync(input, '{}');
    result = spawnSync('python3', [build, input, output], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(output, 'utf8'), page);
});
test('--repo measures tracked files and checks evidence against clean commit', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-repo-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src/a.js'), 'one\ntwo\n');
    fs.writeFileSync(path.join(dir, 'src/b.js'), 'three');
    git('add', '.');
    git('commit', '-qm', 'fixture');
    const d = fixture();
    d.N[0].evidence = [{ path: 'src/a.js', startLine: 1, endLine: 2 }];
    const input = path.join(dir, '.git', 'atlas.json');
    fs.writeFileSync(input, JSON.stringify(d));
    let result = prepareData(input, { repo: dir }).data;
    assert.equal(result.META.metrics.mappedLines, 3);
    assert.equal(result.META.metrics.repositoryLines, 3);
    assert.equal(result.META.source.commit, git('rev-parse', 'HEAD'));
    assert.equal(result.N[0].lines, 2);
    d.N[0].evidence[0].endLine = 3;
    fs.writeFileSync(input, JSON.stringify(d));
    assert.throws(() => prepareData(input, { repo: dir }), /Evidence/);
    d.N[0].evidence[0].endLine = 2;
    d.META.source.commit = 'f'.repeat(40);
    fs.writeFileSync(input, JSON.stringify(d));
    assert.throws(() => prepareData(input, { repo: dir }), /commit/);
    delete d.META.source.commit;
    fs.writeFileSync(input, JSON.stringify(d));
    fs.writeFileSync(path.join(dir, 'src/a.js'), 'changed');
    assert.throws(() => prepareData(input, { repo: dir }), /clean/);
});
