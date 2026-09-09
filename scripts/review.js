#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { prepareData } = require('./data');

function git(repo, args) {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}
function resolve(repo, ref) {
    if (typeof ref !== 'string' || !ref || ref.startsWith('-')) throw Error('A valid git revision is required');
    return git(repo, ['rev-parse', '--verify', '--end-of-options', ref + '^{commit}']).trim();
}
function changedFiles(repo, base, head) {
    const names = git(repo, ['diff', '--no-ext-diff', '--no-textconv', '-M', '--name-status', '-z', base, head, '--']).split('\0');
    const files = [];
    for (let i = 0; i < names.length && names[i];) {
        const code = names[i++], first = names[i++];
        const renamed = code[0] === 'R' || code[0] === 'C';
        files.push({ path: renamed ? names[i++] : first,
            ...(renamed ? { oldPath: first } : {}),
            status: ({ A: 'added', D: 'deleted', R: 'renamed', C: 'copied', T: 'modified', M: 'modified' })[code[0]] || 'modified',
            additions: null, deletions: null });
    }
    const stats = git(repo, ['diff', '--no-ext-diff', '--no-textconv', '-M', '--numstat', '-z', base, head, '--']).split('\0');
    const byPath = new Map(files.map(f => [f.path, f]));
    for (let i = 0; i < stats.length && stats[i];) {
        const record = stats[i++], firstTab = record.indexOf('\t'), secondTab = record.indexOf('\t', firstTab + 1);
        const additions = record.slice(0, firstTab), deletions = record.slice(firstTab + 1, secondTab);
        let file = record.slice(secondTab + 1);
        if (!file) { i++; file = stats[i++]; }
        const item = byPath.get(file);
        if (item) { item.additions = additions === '-' ? null : Number(additions); item.deletions = deletions === '-' ? null : Number(deletions); }
    }
    for (const file of files) {
        // Added/deleted text files have one range covering the entire file. This
        // also handles an old rename path being reused by a newly added file.
        if (file.status === 'added' || file.status === 'deleted') {
            const added = file.status === 'added', count = added ? file.additions : file.deletions;
            file.hunks = count ? [{ oldStart: added ? 0 : 1, oldCount: added ? 0 : count,
                newStart: added ? 1 : 0, newCount: added ? count : 0 }] : [];
            continue;
        }
        const paths = [...new Set([file.oldPath, file.path].filter(Boolean))];
        const patch = git(repo, ['diff', '--no-ext-diff', '--no-textconv', '-M', '--full-index', '--unified=0', base, head,
            '--', ...paths.map(p => ':(literal)' + p)]);
        // A renamed path may also have been reused by a different file. Match the
        // blob pair before reading ranges so that file cannot supply our hunks.
        const oldBlob = file.status === 'added' ? null : git(repo, ['rev-parse', '--verify', base + ':' + (file.oldPath || file.path)]).trim();
        const newBlob = file.status === 'deleted' ? null : git(repo, ['rev-parse', '--verify', head + ':' + file.path]).trim();
        let relevantPatch = patch.split(/^diff --git /m).filter(section => {
            const index = section.match(/^index ([0-9a-f]+)\.\.([0-9a-f]+)/m);
            return index && (oldBlob ? index[1] === oldBlob : /^0+$/.test(index[1])) &&
                (newBlob ? index[2] === newBlob : /^0+$/.test(index[2]));
        }).join('\n');
        // Rename detection can differ when its candidate paths are narrowed.
        // Compare the exact immutable blobs if the scoped patch lost that pair.
        if (!relevantPatch && oldBlob && newBlob && (file.additions || file.deletions)) {
            relevantPatch = git(repo, ['diff', '--no-ext-diff', '--no-textconv', '--unified=0', oldBlob, newBlob]);
        }
        file.hunks = [...relevantPatch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map(match => ({
            oldStart: Number(match[1]), oldCount: match[2] === undefined ? 1 : Number(match[2]),
            newStart: Number(match[3]), newCount: match[4] === undefined ? 1 : Number(match[4])
        }));
    }
    return files;
}
function changedEvidence(atlas, files, side) {
    if (!atlas) return [];
    const matches = [];
    const collect = (refs, owner) => {
        for (const ref of refs || []) {
            const touched = files.some(file => {
                if (ref.path !== (side === 'base' ? file.oldPath || file.path : file.path)) return false;
                return file.hunks.some(hunk => {
                    const start = side === 'base' ? hunk.oldStart : hunk.newStart;
                    const count = side === 'base' ? hunk.oldCount : hunk.newCount;
                    return count > 0 && ref.startLine <= start + count - 1 && (ref.endLine || ref.startLine) >= start;
                });
            });
            if (touched) matches.push({ ...ref, ...owner, side });
        }
    };
    for (const node of atlas.N) collect(node.evidence, { type: 'node', node: node.id });
    for (const edge of atlas.E) collect(edge[3]?.evidence, { type: 'edge', from: edge[0], to: edge[1] });
    return matches;
}
function owns(node, file) {
    const paths = [...node.f.map(f => f[0]), ...(node.evidence || []).map(e => e.path)];
    return paths.some(raw => {
        const p = raw.replace(/\/$/, '');
        return [file.path, file.oldPath].some(f => f && (f === p || f.startsWith(p + '/')));
    });
}
function nodeSignature(node, copy) {
    const { x, y, w, h, z, ...facts } = node;
    return canonical({ facts, copy });
}
function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
    return JSON.stringify(value);
}
function createReview(atlasFile, { repo, base, head, baseAtlas, prUrl }) {
    if (!repo || !base || !head) throw Error('--repo, --base and --head are required');
    if (prUrl) {
        const url = new URL(prUrl);
        if (url.protocol !== 'https:' || url.username || url.password) throw Error('--pr-url must be an HTTPS URL without credentials');
    }
    const baseCommit = resolve(repo, base), headCommit = resolve(repo, head);
    const mergeBase = git(repo, ['merge-base', baseCommit, headCommit]).trim();
    const data = prepareData(atlasFile).data;
    if (data.META.source?.commit && data.META.source.commit !== headCommit) throw Error('Head atlas source commit does not match --head');
    const previous = baseAtlas ? prepareData(baseAtlas).data : null;
    if (previous?.META.source?.commit && previous.META.source.commit !== mergeBase) throw Error('Base atlas source commit must match the PR merge base');
    const files = changedFiles(repo, mergeBase, headCommit);
    const oldNodes = new Map((previous?.N || []).map(n => [n.id, n]));
    const currentIds = new Set(data.N.map(n => n.id));
    const nodes = {}, mapped = new Set(), removedNodes = [];
    for (const node of data.N) {
        const matches = files.filter(file => owns(node, file) || (oldNodes.has(node.id) && owns(oldNodes.get(node.id), file)));
        matches.forEach(f => mapped.add(f.path));
        const added = previous && !oldNodes.has(node.id);
        const changed = previous && oldNodes.has(node.id) && nodeSignature(node, data.COPY[node.id]) !== nodeSignature(oldNodes.get(node.id), previous.COPY[node.id]);
        if (matches.length || added || changed) nodes[node.id] = { status: added ? 'added' : 'modified', files: matches.map(f => f.path) };
    }
    for (const node of previous?.N || []) {
        if (currentIds.has(node.id)) continue;
        const matches = files.filter(file => owns(node, file));
        matches.forEach(f => mapped.add(f.path));
        nodes[node.id] = { status: 'removed', files: matches.map(f => f.path) };
        removedNodes.push({ ...node, copy: previous.COPY[node.id], group: previous.G[node.g] });
    }
    const edges = [];
    if (previous) {
        const key = e => JSON.stringify(e.slice(0, 2));
        const oldEdges = new Map(previous.E.map(e => [key(e), e]));
        const newEdges = new Map(data.E.map(e => [key(e), e]));
        for (const [k, e] of newEdges) {
            const old = oldEdges.get(k);
            if (!old || canonical(old) !== canonical(e)) edges.push({ from: e[0], to: e[1], status: old ? 'modified' : 'added' });
        }
        for (const [k, e] of oldEdges) if (!newEdges.has(k)) edges.push({ from: e[0], to: e[1], status: 'removed' });
    }
    const unmapped = files.filter(f => !mapped.has(f.path)).map(f => f.path);
    const snapshotAvailable = (atlas, commit) => !!atlas && atlas.META.source?.commit === commit && !atlas.META.source.fictional && !atlas.META.source.dirty;
    const evidenceStatus = { head: snapshotAvailable(data, headCommit) ? 'available' : 'unavailable',
        base: snapshotAvailable(previous, mergeBase) ? 'available' : 'unavailable' };
    const evidence = [
        ...(evidenceStatus.head === 'available' ? changedEvidence(data, files, 'head') : []),
        ...(evidenceStatus.base === 'available' ? changedEvidence(previous, files, 'base') : [])
    ];
    data.META.review = { base: baseCommit, head: headCommit, mergeBase, files, nodes, edges, removedNodes, unmapped,
        evidence, evidenceStatus,
        summary: { files: files.length, nodes: Object.keys(nodes).length, unmapped: unmapped.length,
            additions: files.reduce((sum, f) => sum + (f.additions || 0), 0), deletions: files.reduce((sum, f) => sum + (f.deletions || 0), 0) },
        ...(prUrl ? { prUrl } : {}) };
    // A diff establishes its own revisions; it cannot verify an unversioned atlas.
    return data;
}
module.exports = { createReview, changedFiles, owns };
if (require.main === module) {
    try {
        const [input, ...args] = process.argv.slice(2), options = {};
        const flags = { '--repo': 'repo', '--base': 'base', '--head': 'head', '--output': 'output', '--base-atlas': 'baseAtlas', '--pr-url': 'prUrl' };
        for (let i = 0; i < args.length; i += 2) {
            if (!flags[args[i]] || !args[i + 1]) throw Error('Unknown option or missing value: ' + args[i]);
            options[flags[args[i]]] = args[i + 1];
        }
        if (!options.output) throw Error('--output is required');
        const result = createReview(input, options);
        fs.writeFileSync(options.output, JSON.stringify(result, null, 2) + '\n');
        console.log(`Review: ${result.META.review.summary.files} files, ${result.META.review.summary.nodes} components, ${result.META.review.summary.unmapped} unmapped`);
    } catch (error) { console.error('FAIL — ' + error.message); process.exitCode = 1; }
}
