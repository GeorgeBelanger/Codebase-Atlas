'use strict';
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v), str = v => typeof v === 'string' && !!v.trim();
const safe = v => str(v) && !v.startsWith('/') && !v.includes('\\') && !v.split('/').some(p => !p || p === '..' || p === '.') && !/^[a-z]:/i.test(v);
const count = v => Number.isSafeInteger(v) && v >= 0;
const identifier = v => str(v) && /^[a-zA-Z0-9_-]+$/.test(v) && !['__proto__', 'prototype', 'constructor'].includes(v);
const filePath = v => typeof v === 'string' ? v.replace(/\/$/, '') : v;
function loadData(file) {
    if (!file)
        throw Error('Data path required');
    const s = fs.readFileSync(file, 'utf8');
    // Legacy JS is trusted executable author input. JSON never executes code.
    return path.extname(file).toLowerCase() === '.json' || s.trimStart().startsWith('{') ? JSON.parse(s) : new Function(s + ';return{G,N,COPY,E,META,STEPS:typeof STEPS==="undefined"?undefined:STEPS,JOURNEYS:typeof JOURNEYS==="undefined"?undefined:JOURNEYS}')();
}
function validateData(d) {
    const errors = [], warnings = [], bad = s => errors.push(s);
    if (!obj(d))
        return { errors: ['data must be an object'], warnings };
    if (d.schemaVersion !== undefined && d.schemaVersion !== 2)
        bad('schemaVersion must be 2');
    for (const k of ['G', 'COPY', 'META'])
        if (!obj(d[k]))
            bad(k + ' must be an object');
    for (const k of ['N', 'E'])
        if (!Array.isArray(d[k]))
            bad(k + ' must be an array');
    if (errors.length)
        return { errors, warnings };
    const { G, N, COPY, E, META } = d, ids = new Set(), files = new Map();
    if (!N.length)
        bad('N must not be empty');
    for (const [id, g] of Object.entries(G))
        if (!identifier(id) || !obj(g) || !['n', 's', 'c'].every(k => str(g[k])) || !/^#[a-f\d]{6}$/i.test(g.c))
            bad('lane ' + id + ' requires safe id, n, s and six-digit hex c');
    function evidence(v, label, status) {
        if (status !== undefined && !['verified', 'inferred', 'fictional'].includes(status))
            bad(label + ': invalid status');
        if (status === 'verified' && (!Array.isArray(v) || !v.length || !str(META.source?.commit)))
            bad(label + ': verified requires evidence and source commit');
        if (v === undefined)
            return;
        if (!Array.isArray(v)) {
            bad(label + ': evidence must be array');
            return;
        }
        v.forEach(e => {
            if (!obj(e) || !safe(e.path) || !Number.isSafeInteger(e.startLine) || e.startLine < 1 || (e.endLine !== undefined && (!Number.isSafeInteger(e.endLine) || e.endLine < e.startLine)) || (e.symbol !== undefined && !str(e.symbol)))
                bad(label + ': malformed evidence');
        });
    }
    N.forEach((n, i) => {
        if (!obj(n)) {
            bad('block ' + i + ' must be object');
            return;
        }
        const l = str(n.id) ? n.id : 'block ' + i;
        if (!identifier(n.id) || ids.has(n.id))
            bad(l + ': missing, unsafe or duplicate id');
        else
            ids.add(n.id);
        if (!str(n.g) || !Object.hasOwn(G, n.g))
            bad(l + ': unknown lane');
        for (const k of ['n', 'c', 'w1', 'h1'])
            if (!str(n[k]))
                bad(l + ': missing ' + k);
        if (n.kind !== undefined && !['service', 'database', 'queue', 'frontend'].includes(n.kind))
            bad(l + ': kind must be service, database, queue or frontend');
        for (const k of ['x', 'y', 'w', 'h'])
            if (!(['x', 'y'].includes(k) && n[k] === undefined) && (typeof n[k] !== 'number' || !Number.isFinite(n[k]) || (['w', 'h'].includes(k) && n[k] <= 0)))
                bad(l + ': invalid geometry ' + k);
        if (n.z !== undefined && (!Number.isFinite(n.z) || n.z <= 0))
            bad(l + ': invalid z');
        if (!Array.isArray(n.s) || !n.s.length || !n.s.every(str))
            bad(l + ': malformed stack');
        if (!Array.isArray(n.f) || !n.f.length)
            bad(l + ': malformed files');
        else
            n.f.forEach(f => {
                if (!Array.isArray(f) || f.length !== 2 || !safe(filePath(f[0])) || !count(f[1]))
                    bad(l + ': malformed file tuple');
                else {
                    const p = filePath(f[0]);
                    if (files.has(p) && files.get(p) !== f[1])
                        bad('conflicting line counts: ' + p);
                    files.set(p, f[1]);
                }
            });
        if (n.icon !== undefined && (typeof n.icon !== 'string' || n.icon.length > 32 || [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(n.icon)].length !== 1 || !/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(n.icon)))
            bad(l + ': icon must be one emoji');
        if (n.aws !== undefined && (typeof n.aws !== 'string' || !['api-gateway', 'cloudfront', 'dynamodb', 'ecs', 'eks', 'lambda', 'rds', 's3', 'sns', 'sqs', 'step-functions', 'eventbridge', 'elasticache', 'fargate'].includes(n.aws.toLowerCase())))
            bad(l + ': invalid AWS service');
        const c = str(n.id) ? COPY[n.id] : undefined;
        if (!Array.isArray(c) || c.length !== 4 || !c.every(str))
            bad(l + ': COPY requires four strings');
        else if (c[0].length > 12)
            bad(l + ': COPY label too long');
        evidence(n.evidence, l, n.status);
    });
    for (const id of Object.keys(COPY))
        if (!ids.has(id))
            bad('unknown COPY block ' + id);
    const paths = [...files.keys()];
    for (const p of paths)
        for (const q of paths)
            if (q.startsWith(p + '/'))
                bad('overlapping aggregate/file paths: ' + p + ' and ' + q);
    for (let i = 0; i < N.length; i++)
        for (let j = i + 1; j < N.length; j++) {
            const a = N[i], b = N[j];
            if (obj(a) && obj(b) && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)
                bad('overlap: ' + a.id + ' and ' + b.id);
        }
    E.forEach((e, i) => {
        if (!Array.isArray(e) || e.length < 3 || e.length > 4 || !ids.has(e[0]) || !ids.has(e[1]) || ![0, 1].includes(e[2])) {
            bad('edge ' + i + ': malformed tuple or endpoints');
            return;
        }
        if (e[3] !== undefined) {
            if (!obj(e[3]))
                bad('edge ' + i + ': malformed metadata');
            else {
                if (e[3].kind !== undefined && !['call', 'event', 'read', 'write', 'dependency'].includes(e[3].kind))
                    bad('edge ' + i + ': invalid kind');
                evidence(e[3].evidence, 'edge ' + i, e[3].status);
            }
        }
    });
    const js = d.JOURNEYS === undefined ? [{ id: 'default', name: 'Main', steps: d.STEPS, chapters: META.chapters || [] }] : d.JOURNEYS, jids = new Set();
    if (!Array.isArray(js) || !js.length)
        bad('JOURNEYS must be nonempty array');
    else
        js.forEach((j, ji) => {
            const l = 'journey ' + ji;
            if (!obj(j)) {
                bad(l + ': malformed');
                return;
            }
            if (!str(j.id) || jids.has(j.id) || !str(j.name))
                bad(l + ': invalid id/name');
            jids.add(j.id);
            if (j.done !== undefined && !str(j.done))
                bad(l + ': invalid done');
            if (!Array.isArray(j.steps) || !j.steps.length) {
                bad(l + ': steps must be nonempty array');
                return;
            }
            let prev = -1;
            if (j.chapters !== undefined && !Array.isArray(j.chapters))
                bad(l + ': invalid chapters');
            else
                (j.chapters || []).forEach(c => {
                    if (!Array.isArray(c) || c.length !== 2 || !Number.isInteger(c[0]) || c[0] < 0 || c[0] >= j.steps.length || c[0] <= prev || !str(c[1]))
                        bad(l + ': invalid chapter');
                    if (Array.isArray(c))
                        prev = c[0];
                });
            j.steps.forEach((s, i) => {
                if (!Array.isArray(s) || s.length < 2 || s.length > 4 || !ids.has(s[0]) || !str(s[1])) {
                    bad(l + ' step ' + i + ': invalid tuple');
                    return;
                }
                const e = s[2], r = s[3];
                if (r !== undefined && (!obj(r) || !str(r.discontinuity)))
                    bad(l + ' step ' + i + ': discontinuity needs reason');
                if (e !== null && e !== undefined) {
                    if (!Array.isArray(e) || e.length !== 2 || e[1] !== s[0] || !E.some(x => Array.isArray(x) && x[0] === e[0] && x[1] === e[1]))
                        bad(l + ' step ' + i + ': edge must exist and end at target');
                    else if (i > 0 && e[0] !== j.steps[i - 1]?.[0] && !str(r?.discontinuity))
                        bad(l + ' step ' + i + ': edge must continue previous step or explain discontinuity');
                }
                else if (i > 0 && s[0] !== j.steps[i - 1]?.[0] && !str(r?.discontinuity))
                    bad(l + ' step ' + i + ': missing transition edge or discontinuity');
            });
        });
    for (const k of ['title', 'name', 'tag', 'run', 'cta', 'done'])
        if (!str(META[k]))
            bad('META.' + k + ' requires string');
    if (META.movementsLabel !== undefined && !str(META.movementsLabel))
        bad('META.movementsLabel requires string');
    for (const k of ['stats', 'key'])
        if (!Array.isArray(META[k]) || !META[k].every(t => Array.isArray(t) && t.length === 2 && t.every(str)))
            bad('META.' + k + ' requires string pairs');
    if (!obj(META.intro) || !str(META.intro.eyebrow) || !str(META.intro.h) || !Array.isArray(META.intro.p) || !META.intro.p.every(str))
        bad('META.intro malformed');
    if (!Array.isArray(META.movements) || !META.movements.every(t => Array.isArray(t) && t.length === 3 && t.every(str) && ids.has(t[2])))
        bad('META.movements malformed');
    if (META.legend !== undefined && (!Array.isArray(META.legend) || !META.legend.every(str)))
        bad('META.legend malformed');
    if (META.source !== undefined) {
        const s = META.source;
        if (!obj(s))
            bad('META.source malformed');
        else {
            if (s.repository !== undefined) {
                try {
                    const u = new URL(s.repository);
                    if (u.protocol !== 'https:' || u.username || u.password)
                        bad('META.source.repository requires HTTPS URL');
                }
                catch {
                    bad('META.source.repository invalid');
                }
            }
            if (s.commit !== undefined && (typeof s.commit !== 'string' || !/^[a-f\d]{40}(?:[a-f\d]{24})?$/i.test(s.commit)))
                bad('META.source.commit requires full Git SHA');
            if (s.generatedAt !== undefined && (!str(s.generatedAt) || !Number.isFinite(Date.parse(s.generatedAt))))
                bad('META.source.generatedAt invalid');
            if (s.fictional !== undefined && typeof s.fictional !== 'boolean')
                bad('META.source.fictional invalid');
        }
    }
    if (META.inventory !== undefined) {
        if (!Array.isArray(META.inventory))
            bad('META.inventory malformed');
        else {
            const seen = new Set();
            META.inventory.forEach(f => {
                if (!obj(f) || !safe(f.path) || !count(f.lines) || seen.has(f.path))
                    bad('META.inventory invalid or duplicate file');
                else {
                    seen.add(f.path);
                    if (files.has(f.path) && files.get(f.path) !== f.lines)
                        bad('inventory count conflict: ' + f.path);
                }
            });
            for (const p of paths)
                if (!seen.has(p))
                    bad('inventory missing mapped file ' + p);
        }
    }
    if (!META.source)
        warnings.push('Missing source provenance; add repository, commit, generatedAt or fictional: true.');
    if (META.review !== undefined) {
        const r = META.review, label = 'META.review';
        const sha = v => typeof v === 'string' && /^[a-f\d]{40}(?:[a-f\d]{24})?$/i.test(v);
        if (!obj(r) || !['base', 'head', 'mergeBase'].every(k => sha(r[k])) || !Array.isArray(r.files) || !obj(r.nodes) || !Array.isArray(r.unmapped)) {
            bad(label + ': requires revisions, files, nodes and unmapped paths');
        } else {
            const reviewIds = new Set(ids), changedPaths = new Set();
            if (r.removedNodes !== undefined && !Array.isArray(r.removedNodes)) bad(label + ': invalid removedNodes');
            for (const n of Array.isArray(r.removedNodes) ? r.removedNodes : []) {
                if (!obj(n) || !identifier(n.id) || reviewIds.has(n.id)) { bad(label + ': invalid removed node id'); continue; }
                reviewIds.add(n.id);
                const meta = { ...META, movements: [], chapters: [] }; delete meta.review; delete meta.inventory;
                const check = validateData({ G: { [n.g]: n.group }, N: [n], COPY: { [n.id]: n.copy }, E: [], STEPS: [[n.id, 'Historical component', null]], META: meta });
                if (check.errors.length) bad(label + ': invalid historical component ' + n.id + ': ' + check.errors.join('; '));
            }
            for (const f of r.files) {
                if (!obj(f) || !safe(f.path) || changedPaths.has(f.path) || (f.oldPath !== undefined && !safe(f.oldPath)) || !['added', 'deleted', 'renamed', 'copied', 'modified'].includes(f.status) || ![f.additions, f.deletions].every(v => v === null || count(v))) bad(label + ': invalid changed file');
                else changedPaths.add(f.path);
            }
            for (const [id, change] of Object.entries(r.nodes)) {
                if (!reviewIds.has(id) || !obj(change) || !['added', 'modified', 'removed'].includes(change.status) || !Array.isArray(change.files) || !change.files.every(p => changedPaths.has(p))) bad(label + ': invalid component change ' + id);
            }
            if (!r.unmapped.every(p => changedPaths.has(p))) bad(label + ': invalid unmapped path');
            if (r.edges !== undefined && (!Array.isArray(r.edges) || !r.edges.every(e => obj(e) && reviewIds.has(e.from) && reviewIds.has(e.to) && ['added', 'modified', 'removed'].includes(e.status)))) bad(label + ': invalid connection changes');
            if (r.prUrl !== undefined) {
                try { const url = new URL(r.prUrl); if (url.protocol !== 'https:' || url.username || url.password) bad(label + ': invalid PR URL'); }
                catch { bad(label + ': invalid PR URL'); }
            }
        }
    }
    if (!errors.length) {
        const sum = [...files.values()].reduce((a, b) => a + b, 0);
        META.stats.forEach(([l, v]) => {
            if (/lines|\bloc\b/i.test(l) && /^\d[\d,]*$/.test(v) && Number(v.replaceAll(',', '')) !== sum)
                warnings.push('Hardcoded LOC ' + v + ' differs from mapped lines ' + sum + '; use #lines.');
        });
    }
    return { errors, warnings };
}
function normalizeData(input) {
    const d = structuredClone(input), files = new Map();
    d.schemaVersion = 2;
    if (d.N.some(n => n.x === undefined || n.y === undefined)) d.N = require('../assets/graph').layout(d.N, d.E);
    d.N.forEach(n => {
        n.f = [...new Map(n.f.map(([p, lines]) => [filePath(p), lines]))];
        n.status = n.status || (d.META.source?.fictional ? 'fictional' : 'inferred');
        n.lines = n.f.reduce((sum, [p, l]) => {
            files.set(p, l);
            return sum + l;
        }, 0);
        n.z = Math.round(Math.min(80, 18 + n.lines / 28) * 10) / 10;
    });
    d.E.forEach(edge => {
        edge[3] = { ...edge[3], status: edge[3]?.status || (d.META.source?.fictional ? 'fictional' : 'inferred') };
    });
    d.META.metrics = { mappedFiles: files.size, mappedLines: [...files.values()].reduce((a, b) => a + b, 0), ...(d.META.inventory ? { repositoryLines: d.META.inventory.reduce((sum, f) => sum + f.lines, 0) } : {}) };
    d.META.stats = d.META.stats.map(([l, v]) => [l, v === '#lines' ? d.META.metrics.mappedLines.toLocaleString('en-US') : v === '#files' ? d.META.metrics.mappedFiles.toLocaleString('en-US') : v]);
    d.JOURNEYS = d.JOURNEYS || [{ id: 'default', name: d.META.tag || 'Main journey', steps: d.STEPS, chapters: d.META.chapters || [], done: d.META.done }];
    d.STEPS = d.JOURNEYS[0].steps;
    d.META.chapters = d.JOURNEYS[0].chapters || [];
    d.META.movementsLabel = d.META.movementsLabel || 'MOVEMENTS';
    return d;
}
function measureRepo(d, repo) {
    const root = fs.realpathSync(repo), git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(), commit = git(['rev-parse', 'HEAD']);
    if (d.META.source?.commit && d.META.source.commit !== commit)
        throw Error('Source commit differs from repository HEAD; regenerate evidence first');
    if (git(['status', '--porcelain', '--untracked-files=normal']))
        throw Error('--repo requires a clean repository to match evidence to commit');
    const inventory = new Map();
    execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean).forEach(p => {
        if (!safe(p))
            return;
        const full = path.join(root, p);
        if (!fs.lstatSync(full).isFile())
            return;
        const b = fs.readFileSync(full);
        if (b.includes(0))
            return;
        inventory.set(p, b.length ? b.toString('utf8').split('\n').length - (b.at(-1) === 10 ? 1 : 0) : 0);
    });
    d.N.forEach(n => {
        n.f = n.f.flatMap(([rawPath]) => {
            const p = filePath(rawPath);
            const found = [...inventory].filter(([f]) => f === p || f.startsWith(p + '/'));
            if (!found.length)
                throw Error('Referenced path missing, binary or symlink: ' + p);
            return found;
        });
    });
    [...d.N.map(n => n.evidence), ...d.E.map(e => e[3]?.evidence)].filter(Boolean).flat().forEach(e => {
        if (!inventory.has(e.path) || (e.endLine || e.startLine) > inventory.get(e.path))
            throw Error('Evidence path/range outside repository: ' + e.path);
    });
    d.META.inventory = [...inventory].map(([p, lines]) => ({ path: p, lines }));
    d.META.source = { ...d.META.source, commit, generatedAt: new Date().toISOString(), fictional: false, freshness: 'current', dirty: false };
    if (!d.META.source.repository) {
        try {
            const remote = git(['remote', 'get-url', 'origin']);
            const url = remote.replace(/^git@([^:]+):/, 'https://').replace(/\.git$/, '');
            if (url.startsWith('https://')) d.META.source.repository = url;
        } catch { /* A repository can be local-only. */ }
    }
}
function prepareData(file, { repo } = {}) {
    const data = loadData(file), first = validateData(data);
    if (first.errors.length)
        throw Error(first.errors.join('\n'));
    if (repo)
        measureRepo(data, repo);
    const checked = validateData(data);
    if (checked.errors.length)
        throw Error(checked.errors.join('\n'));
    return { data: normalizeData(data), warnings: checked.warnings };
}
function serializeData(d) {
    return ['G', 'N', 'COPY', 'E', 'STEPS', 'META', 'JOURNEYS'].map(k => 'const ' + k + '=' + JSON.stringify(d[k]).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029') + ';').join('\n');
}
module.exports = { loadData, validateData, normalizeData, prepareData, serializeData };
if (require.main === module) {
    try {
        const r = prepareData(process.argv[2], { repo: process.argv.includes('--repo') ? process.argv[process.argv.indexOf('--repo') + 1] : undefined });
        r.warnings.forEach(w => console.error('warn ' + w));
        process.stdout.write(JSON.stringify(r.data));
    }
    catch (e) {
        console.error('FAIL — ' + e.message);
        process.exitCode = 1;
    }
}
