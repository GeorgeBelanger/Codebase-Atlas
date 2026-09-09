const test = require('node:test');
const assert = require('node:assert/strict');
const { layout, route, collapse } = require('../assets/graph.js');
const node = (id, g, x = 0, y = 0, w = 4, h = 3) => ({ id, g, x, y, w, h, z: 30, n: id, f: [[id + '.js', 10]] });
test('cyclic and equal-rank groups follow top-left to bottom-right in screen space',()=>{
  const nodes=[node('start','z_first',0),node('middle','a_second',8),node('end','m_third',16)];
  for(const edges of [[],[['start','middle'],['middle','end'],['end','start']]]){
    const result=layout(nodes,edges);
    for(let i=1;i<result.length;i++){
      assert.ok(result[i].x-result[i].y>result[i-1].x-result[i-1].y);
      assert.ok(result[i].x+result[i].y>result[i-1].x+result[i-1].y);
    }
  }
});

test('layout separates unequal blocks, groups related components, and terminates for cycles', () => {
  const nodes = [node('a', 'one', 0, 0, 8, 2), node('b', 'one'), node('c', 'two'), node('d', 'three')];
  const edges = [['a', 'c'], ['c', 'a'], ['c', 'd']];
  const original = JSON.stringify(nodes), result = layout(nodes, edges);
  assert.equal(JSON.stringify(nodes), original);
  assert.deepEqual(result, layout(nodes, edges));
  assert.deepEqual(result.slice().sort((a, b) => a.id.localeCompare(b.id)), layout(nodes.slice().reverse(), edges.slice().reverse()).sort((a, b) => a.id.localeCompare(b.id)));
  for (const a of result) for (const b of result) if (a.id !== b.id) {
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
  }
  assert.equal(result[0].w, 8);
  assert.ok(result[3].x > result[2].x);
});

test('routing detours orthogonally around inflated nonendpoint blocks', () => {
  const nodes = [node('a', 'one'), node('b', 'two', 20), node('obstacle', 'other', 8, -2, 5, 8)];
  const edges = [['a', 'b', 1, { kind: 'call' }]];
  const result = route(nodes, edges), e = result[0];
  assert.deepEqual(result, route(nodes, edges));
  assert.equal(edges[0].p, undefined);
  assert.equal(e.unroutable, false);
  assert.ok(e.p.length >= 4);
  for (let i = 1; i < e.p.length; i++) {
    const a = e.p[i - 1], b = e.p[i];
    assert.ok(a.x === b.x || a.y === b.y);
    assert.ok(!(a.x === b.x
      ? a.x > 7.7 && a.x < 13.3 && Math.max(a.y, b.y) > -2.3 && Math.min(a.y, b.y) < 6.3
      : a.y > -2.3 && a.y < 6.3 && Math.max(a.x, b.x) > 7.7 && Math.min(a.x, b.x) < 13.3));
  }
  assert.ok(e.L > 20);
});

test('unroutable overlapping geometry is explicit and missing endpoints are safe', () => {
  const nodes = [node('a', 'one'), node('b', 'two', 20), node('overlap', 'other', -2, -2, 10, 10)];
  const e = route(nodes, [['a', 'b']])[0];
  assert.equal(e.unroutable, true); assert.deepEqual(e.p, []);
  assert.deepEqual(route(nodes, [['missing', 'b']])[0].p, []);
  assert.deepEqual(route([], []), []);
});

test('collapse deduplicates external connections and shared files without mutating sources', () => {
  const nodes = [node('a', 'one'), node('b', 'one', 8), node('c', 'two', 20)];
  nodes[1].f = [['a.js', 10], ['b.js', 20]];
  const edges = [['a', 'b', 0], ['a', 'c', 0], ['b', 'c', 1]];
  const result = collapse(nodes, edges, ['one']);
  assert.equal(result.nodes.length, 2);
  assert.deepEqual(result.nodes[0].memberIds, ['a', 'b']);
  assert.equal(result.nodes[0].lines, 30);
  assert.equal(result.edges.length, 1);
  assert.deepEqual(result.edges[0].slice(0, 3), ['__group_one', 'c', 1]);
  assert.equal(result.edges[0].memberEdges.length, 2);
  assert.equal(nodes[0].id, 'a'); assert.equal(edges[1][0], 'a');
  assert.deepEqual(layout([], []), []);
});

test('synthetic IDs avoid authored IDs deterministically and remap edges to the generated ID', () => {
  const nodes = [node('a', 'one'), node('__group_one', 'two'), node('__group_one_1', 'two')];
  const result = collapse(nodes, [['a', '__group_one', 0]], ['one']);
  assert.equal(result.nodes[0].id, '__group_one_2');
  assert.equal(new Set(result.nodes.map(n => n.id)).size, result.nodes.length);
  assert.equal(result.edges[0][0], '__group_one_2');
  const reversed = collapse(nodes.slice().reverse(), [], ['one']);
  assert.equal(reversed.nodes.find(n => n.memberIds)?.id, '__group_one_2');
});

test('collapsed review edges preserve unanimous statuses and mark mixed relationships modified', () => {
  const nodes = [node('a', 'one'), node('b', 'one'), node('c', 'two')];
  for (const [statuses, expected] of [
    [['added', 'added'], 'added'], [['removed', 'removed'], 'removed'],
    [['added', 'removed'], 'modified'], [['added', undefined], 'modified']
  ]) {
    const edges = [['a', 'c', 0, { reviewStatus: statuses[0] }], ['b', 'c', 0, { reviewStatus: statuses[1] }]];
    const original = JSON.stringify(edges);
    assert.equal(collapse(nodes, edges, ['one']).edges[0][3].reviewStatus, expected);
    assert.equal(JSON.stringify(edges), original);
  }
});
