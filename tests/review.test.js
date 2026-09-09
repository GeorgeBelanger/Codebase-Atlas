'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createReview: generateReview, changedFiles, owns } = require('../scripts/review');
const { validateData } = require('../scripts/data');
function createReview(...args) { const data=generateReview(...args);assert.deepEqual(validateData(data).errors,[]);return data; }
function fixture(t) {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-review-'));
    t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
    const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
    git('init', '-q'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test');
    const write = (name, content) => fs.writeFileSync(path.join(repo, name), content);
    const commit = () => { git('add', '-A'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
    write('service.js', 'one\ntwo\nthree\n'); write('gone.js', 'delete me\n');
    const base = commit();
    const atlas = JSON.parse(fs.readFileSync(path.join(__dirname, '../examples/order-flow.data.json'), 'utf8'));
    const first = atlas.N[0];
    atlas.N = [{ ...first, id: 'service', f: [['service.js', 3]], status: 'inferred', evidence: undefined }];
    atlas.COPY = { service: atlas.COPY[first.id] }; atlas.E = []; atlas.STEPS = [['service', 'Inspect', null]];
    delete atlas.JOURNEYS; atlas.META.chapters = [[0, 'START']]; atlas.META.movements = [['START', 'Inspect', 'service']]; delete atlas.META.source;
    const atlasFile = path.join(repo, 'atlas.json');
    const save = (data = atlas, name = 'atlas.json') => { write(name, JSON.stringify(data)); return path.join(repo, name); };
    save();
    return { repo, git, write, commit, base, atlas, atlasFile, save };
}
test('maps rename old paths, deletion, binary and unmapped files with exact counts', t => {
    const f = fixture(t);
    f.git('mv', 'service.js', 'renamed.js'); fs.unlinkSync(path.join(f.repo, 'gone.js'));
    f.write('binary.dat', Buffer.from([0, 1, 2])); f.write('new.txt', 'new\n');
    const head = f.commit();
    const review = createReview(f.atlasFile, { repo: f.repo, base: f.base, head }).META.review;
    assert.deepEqual(review.files.find(f => f.path === 'renamed.js'), { path: 'renamed.js', oldPath: 'service.js', status: 'renamed', additions: 0, deletions: 0, hunks: [] });
    assert.equal(review.files.find(f => f.path === 'gone.js').status, 'deleted');
    assert.equal(review.files.find(f => f.path === 'binary.dat').additions, null);
    assert.deepEqual(review.nodes.service, { status: 'modified', files: ['renamed.js'] });
    assert.ok(review.unmapped.includes('new.txt'));
    assert.equal(review.mergeBase, f.base);
});
test('same revisions produce an empty review without inventing changes', t => {
    const f = fixture(t);
    const review = createReview(f.atlasFile, { repo: f.repo, base: f.base, head: f.base }).META.review;
    assert.deepEqual(review.files, []); assert.deepEqual(review.nodes, {});
});
test('PR comparison starts at merge base, excluding target-only edits', t => {
    const f = fixture(t);
    f.git('checkout', '-qb', 'feature'); f.write('service.js', 'feature\n'); const head = f.commit();
    f.git('checkout', '-qb', 'target', f.base); f.write('target-only.txt', 'target\n'); const base = f.commit(); f.save();
    const review = createReview(f.atlasFile, { repo: f.repo, base, head }).META.review;
    assert.equal(review.mergeBase, f.base); assert.ok(!review.files.some(f => f.path === 'target-only.txt'));
});
test('base atlas distinguishes removed and added architecture without contaminating current nodes', t => {
    const f = fixture(t);
    const previous = structuredClone(f.atlas);
    previous.N.push({ ...previous.N[0], id: 'gone', x: 2000, f: [['gone.js', 1]] });
    previous.COPY.gone = previous.COPY.service;
    previous.E = [['service', 'gone', 0]];
    const baseAtlas = f.save(previous, 'base-atlas.json');
    fs.unlinkSync(path.join(f.repo, 'gone.js')); const head = f.commit();
    const result = createReview(f.atlasFile, { repo: f.repo, base: f.base, head, baseAtlas });
    assert.equal(result.META.review.nodes.gone.status, 'removed');
    assert.equal(result.META.review.removedNodes[0].id, 'gone');
    assert.ok(!result.N.some(n => n.id === 'gone'));
    assert.deepEqual(result.META.review.edges, [{ from: 'service', to: 'gone', status: 'removed' }]);
});
test('rejects mismatched source commits and unsafe refs or URLs', t => {
    const f = fixture(t);
    f.atlas.META.source = { commit: 'a'.repeat(40) }; f.save();
    assert.throws(() => createReview(f.atlasFile, { repo: f.repo, base: f.base, head: f.base }), /does not match/);
    assert.throws(() => createReview(f.atlasFile, { repo: f.repo, base: '--help', head: f.base }), /valid git/);
    assert.throws(() => createReview(f.atlasFile, { repo: f.repo, base: f.base, head: f.base, prUrl: 'javascript:alert(1)' }), /HTTPS/);
});
test('ownership uses directory boundaries and source evidence', () => {
    const n = { f: [['src/api/', 5]], evidence: [{ path: 'config.json' }] };
    assert.equal(owns(n, { path: 'src/api/foo.js' }), true);
    assert.equal(owns(n, { path: 'src/api2/foo.js' }), false);
    assert.equal(owns(n, { path: 'config.json' }), true);
});
test('NUL parsing preserves tabs and newlines in renamed filenames', t => {
    const f = fixture(t), name = 'renamed\twith\nspaces.js';
    f.git('mv', 'service.js', name); const head = f.commit();
    const review = createReview(f.atlasFile, { repo: f.repo, base: f.base, head }).META.review;
    assert.deepEqual(review.nodes.service.files, [name]);
    assert.equal(review.files.find(file => file.path === name).additions, 0);
});
test('base snapshot marks newly authored components as added', t => {
    const f = fixture(t), baseAtlas = f.save(structuredClone(f.atlas), 'previous.json');
    f.atlas.N.push({ ...f.atlas.N[0], id: 'new', x: 2000, f: [['new.js', 1]] });
    f.atlas.COPY.new = f.atlas.COPY.service; f.atlas.E = [['service', 'new', 0]];
    f.save(); f.write('new.js', 'new\n'); const head = f.commit();
    const review = createReview(f.atlasFile, { repo: f.repo, base: f.base, head, baseAtlas }).META.review;
    assert.equal(review.nodes.new.status, 'added');
    assert.deepEqual(review.edges, [{ from: 'service', to: 'new', status: 'added' }]);
});
test('matches only changed ranges against the corresponding revision, including edge evidence', t => {
    const f = fixture(t), previous = structuredClone(f.atlas);
    previous.META.source = { commit: f.base };
    previous.N[0].evidence = [{ path: 'service.js', startLine: 2, symbol: 'oldHandler' }];
    const baseAtlas = f.save(previous, 'previous.json');
    f.write('service.js', 'one\nreplacement\nthree\n'); const head = f.commit();
    f.atlas.META.source = { commit: head };
    f.atlas.N[0].evidence = [{ path: 'service.js', startLine: 1 }, { path: 'service.js', startLine: 2, endLine: 3, symbol: 'handler' }];
    f.atlas.E = [['service', 'service', 0, { kind: 'call', status: 'inferred', evidence: [{ path: 'service.js', startLine: 2 }] }]];
    f.save();
    const review = createReview(f.atlasFile, { repo: f.repo, base: f.base, head, baseAtlas }).META.review;
    assert.deepEqual(review.files.find(file => file.path === 'service.js').hunks, [{ oldStart: 2, oldCount: 1, newStart: 2, newCount: 1 }]);
    assert.deepEqual(review.evidenceStatus, { head: 'available', base: 'available' });
    assert.deepEqual(review.evidence, [
        { type: 'node', node: 'service', path: 'service.js', startLine: 2, endLine: 3, symbol: 'handler', side: 'head' },
        { type: 'edge', from: 'service', to: 'service', path: 'service.js', startLine: 2, side: 'head' },
        { type: 'node', node: 'service', path: 'service.js', startLine: 2, symbol: 'oldHandler', side: 'base' }
    ]);
});
test('insertions do not touch adjacent base evidence and deletions do not touch adjacent head evidence', t => {
    for (const insertion of [true, false]) {
        const f = fixture(t), previous = structuredClone(f.atlas);
        previous.META.source = { commit: f.base };
        previous.N[0].evidence = [{ path: 'service.js', startLine: insertion ? 1 : 2 }];
        const baseAtlas = f.save(previous, 'previous.json');
        f.write('service.js', insertion ? 'one\ninserted\ntwo\nthree\n' : 'one\nthree\n'); const head = f.commit();
        f.atlas.META.source = { commit: head };
        f.atlas.N[0].evidence = [{ path: 'service.js', startLine: insertion ? 2 : 1 }]; f.save();
        const review = createReview(f.atlasFile, { repo: f.repo, base: f.base, head, baseAtlas }).META.review;
        assert.equal(review.evidence.length, 1);
        assert.equal(review.evidence[0].side, insertion ? 'head' : 'base');
    }
});
test('unversioned evidence cannot claim an exact changed-line match', t => {
    const f = fixture(t);
    f.write('service.js', 'replacement\ntwo\nthree\n'); const head = f.commit();
    f.atlas.N[0].evidence = [{ path: 'service.js', startLine: 1 }]; f.save();
    const review = createReview(f.atlasFile, { repo: f.repo, base: f.base, head }).META.review;
    assert.deepEqual(review.evidence, []);
    assert.deepEqual(review.evidenceStatus, { head: 'unavailable', base: 'unavailable' });
    assert.equal(review.nodes.service.status, 'modified');
});
test('renamed files match old and new evidence paths separately and literal glob characters stay literal', t => {
    const f = fixture(t), previous = structuredClone(f.atlas);
    previous.META.source = { commit: f.base };
    previous.N[0].evidence = [{ path: 'service.js', startLine: 2 }];
    const baseAtlas = f.save(previous, 'previous.json');
    const name = 'service[1].js';
    f.git('mv', 'service.js', name); f.write(name, 'one\nTWO\nthree\n');
    f.write('service1.js', 'unrelated\n'); const head = f.commit();
    f.atlas.META.source = { commit: head };
    f.atlas.N[0].f = [[name, 3]];
    f.atlas.N[0].evidence = [{ path: name, startLine: 2 }, { path: 'service.js', startLine: 2 }]; f.save();
    const review = createReview(f.atlasFile, { repo: f.repo, base: f.base, head, baseAtlas }).META.review;
    assert.equal(review.files.find(file => file.path === name).status, 'renamed');
    assert.deepEqual(review.evidence.map(e => [e.path, e.side]), [[name, 'head'], ['service.js', 'base']]);
});
test('moving then recreating a path preserves the distinct changes reported by Git', t => {
    const f = fixture(t);
    f.git('mv', 'service.js', 'renamed.js'); f.write('renamed.js', 'one\nTWO\nthree\n');
    f.write('service.js', 'a different implementation\nwith another line\n'); const head = f.commit();
    const files = changedFiles(f.repo, f.base, head);
    assert.deepEqual(files.find(file => file.path === 'renamed.js').hunks, [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 3 }]);
    assert.deepEqual(files.find(file => file.path === 'service.js').hunks, [{ oldStart: 1, oldCount: 3, newStart: 1, newCount: 2 }]);
});
test('dirty snapshots do not imply exact evidence matches even when commit is recorded', t => {
    const f = fixture(t);
    f.write('service.js', 'replacement\ntwo\nthree\n'); const head = f.commit();
    f.atlas.META.source = { commit: head, dirty: true };
    f.atlas.N[0].evidence = [{ path: 'service.js', startLine: 1 }]; f.save();
    const review = createReview(f.atlasFile, { repo: f.repo, base: f.base, head }).META.review;
    assert.equal(review.evidenceStatus.head, 'unavailable');
    assert.deepEqual(review.evidence, []);
});
