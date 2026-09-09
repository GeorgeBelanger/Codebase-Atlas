/* Deterministic, dependency-free graph geometry. Coordinates use atlas world units.
 * layout(nodes, edges): copy nodes into ranked group columns, retaining dimensions.
 * route(nodes, edges): copy edge tuples and add orthogonal p, length L, and t=0.
 * collapse(nodes, edges, ids): replace selected groups with aggregate nodes/edges.
 * Inputs are never mutated. Node IDs and group IDs are compared as strings.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AtlasGraph = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const compare = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  const dimensions = n => ({ w: n.w || 4, h: n.h || 3 });

  function layout(nodes, edges) {
    const groups = new Map(), byId = new Map(nodes.map(n => [n.id, n]));
    for (const n of nodes) {
      if (!groups.has(n.g)) groups.set(n.g, []);
      groups.get(n.g).push(n);
    }
    const keys = [...groups.keys()].sort(compare);
    const next = new Map(keys.map(g => [g, new Set()]));
    for (const e of edges) {
      const a = byId.get(e[0]), b = byId.get(e[1]);
      if (a && b && a.g !== b.g) next.get(a.g).add(b.g);
    }
    // Collapse cycles before ranking, so feedback paths cannot grow ranks forever.
    let index = 0;
    const indices = new Map(), low = new Map(), stack = [], active = new Set(), components = [];
    function visit(g) {
      indices.set(g, index); low.set(g, index++); stack.push(g); active.add(g);
      for (const h of [...next.get(g)].sort(compare)) {
        if (!indices.has(h)) { visit(h); low.set(g, Math.min(low.get(g), low.get(h))); }
        else if (active.has(h)) low.set(g, Math.min(low.get(g), indices.get(h)));
      }
      if (low.get(g) === indices.get(g)) {
        const component = []; let h;
        do { h = stack.pop(); active.delete(h); component.push(h); } while (h !== g);
        components.push(component.sort(compare));
      }
    }
    keys.forEach(g => { if (!indices.has(g)) visit(g); });
    const componentOf = new Map();
    components.forEach((gs, i) => gs.forEach(g => componentOf.set(g, i)));
    const incoming = components.map(() => new Set());
    for (const g of keys) for (const h of next.get(g)) {
      const a = componentOf.get(g), b = componentOf.get(h);
      if (a !== b) incoming[b].add(a);
    }
    const ranks = new Map();
    function rank(i) {
      if (!ranks.has(i)) ranks.set(i, Math.max(0, ...[...incoming[i]].map(j => rank(j) + 1)));
      return ranks.get(i);
    }
    const columns = new Map();
    for (const g of keys) {
      const r = rank(componentOf.get(g));
      if (!columns.has(r)) columns.set(r, []);
      columns.get(r).push(g);
    }
    const placed = new Map(); let x = 0;
    for (const r of [...columns.keys()].sort((a, b) => a - b)) {
      let y = 0, columnWidth = 0;
      for (const g of columns.get(r)) {
        const members = groups.get(g).slice().sort((a, b) => compare(a.id, b.id));
        const across = Math.ceil(Math.sqrt(members.length));
        const cellW = Math.max(...members.map(n => dimensions(n).w)) + 3;
        const cellH = Math.max(...members.map(n => dimensions(n).h)) + 3;
        members.forEach((n, i) => placed.set(n.id, { ...n, x: x + (i % across) * cellW, y: y + Math.floor(i / across) * cellH }));
        columnWidth = Math.max(columnWidth, across * cellW);
        y += Math.ceil(members.length / across) * cellH + 5;
      }
      x += columnWidth + 6;
    }
    return nodes.map(n => placed.get(n.id));
  }

  function collapse(nodes, edges, collapsedGroupIds) {
    const collapsed = new Set(collapsedGroupIds), groups = new Map(), mapping = new Map();
    const occupied = new Set(nodes.map(n => n.id)), groupIds = new Map();
    for (const g of [...new Set(nodes.map(n => n.g))].sort(compare)) {
      if (!collapsed.has(g)) continue;
      const prefix = '__group_' + g;
      let id = prefix, suffix = 1;
      while (occupied.has(id)) id = prefix + '_' + suffix++;
      occupied.add(id); groupIds.set(g, id);
    }
    for (const n of nodes) {
      if (!groups.has(n.g)) groups.set(n.g, []);
      groups.get(n.g).push(n);
      mapping.set(n.id, collapsed.has(n.g) ? groupIds.get(n.g) : n.id);
    }
    const result = [], emitted = new Set();
    for (const n of nodes) {
      if (!collapsed.has(n.g)) { result.push({ ...n }); continue; }
      if (emitted.has(n.g)) continue;
      emitted.add(n.g);
      const members = groups.get(n.g), files = new Map();
      members.forEach(m => (m.f || []).forEach(f => { if (!files.has(f[0])) files.set(f[0], f[1]); }));
      const minX = Math.min(...members.map(m => m.x)), maxX = Math.max(...members.map(m => m.x + dimensions(m).w));
      const minY = Math.min(...members.map(m => m.y)), maxY = Math.max(...members.map(m => m.y + dimensions(m).h));
      const f = [...files].sort((a, b) => compare(a[0], b[0]));
      result.push({
        id: groupIds.get(n.g), g: n.g, n: n.g, c: n.c,
        x: (minX + maxX) / 2 - 2, y: (minY + maxY) / 2 - 1.5,
        w: 4, h: 3, z: 30, f, lines: f.reduce((sum, entry) => sum + entry[1], 0),
        s: members.length + ' components', w1: 'Expand this group to explore its components.',
        h1: 'Aggregates ' + members.length + ' mapped components.', d: '', t: [],
        memberIds: members.map(m => m.id), componentType: 'service',
        status: members.every(m => m.status === members[0].status) ? members[0].status : 'inferred'
      });
    }
    const remapped = new Map();
    for (const edge of edges) {
      const a = mapping.get(edge[0]), b = mapping.get(edge[1]);
      if (!a || !b || a === b) continue;
      const key = JSON.stringify([a, b]);
      if (!remapped.has(key)) {
        const e = [...edge]; e[0] = a; e[1] = b; e.memberEdges = [];
        remapped.set(key, e);
      }
      const e = remapped.get(key);
      e.memberEdges.push([...edge]); e[2] = Math.max(e[2] || 0, edge[2] || 0);
    }
    for (const e of remapped.values()) {
      const statuses = e.memberEdges.map(member => member[3]?.reviewStatus);
      if (statuses.some(Boolean)) {
        e[3] = { ...e[3], reviewStatus: statuses.every(status => status === statuses[0]) ? statuses[0] : 'modified' };
      }
    }
    return { nodes: result, edges: [...remapped.values()] };
  }

  // A coordinate-compressed visibility grid includes a lane around every obstacle.
  // Dijkstra searches it with a binary heap; boundary contact is allowed, interiors aren't.
  function pathBetween(a, b, obstacles) {
    const xs = [...new Set([a.x, b.x, ...obstacles.flatMap(o => [o.l, o.r])])].sort((a, b) => a - b);
    const ys = [...new Set([a.y, b.y, ...obstacles.flatMap(o => [o.t, o.b])])].sort((a, b) => a - b);
    const width = xs.length, start = ys.indexOf(a.y) * width + xs.indexOf(a.x), end = ys.indexOf(b.y) * width + xs.indexOf(b.x);
    const point = id => ({ x: xs[id % width], y: ys[Math.floor(id / width)] });
    const blocked = (p, q) => obstacles.some(o => p.x === q.x
      ? p.x > o.l && p.x < o.r && Math.max(p.y, q.y) > o.t && Math.min(p.y, q.y) < o.b
      : p.y > o.t && p.y < o.b && Math.max(p.x, q.x) > o.l && Math.min(p.x, q.x) < o.r);
    const heap = [], distance = new Map([[start, 0]]), previous = new Map();
    function push(item) {
      heap.push(item); let i = heap.length - 1;
      while (i) { const parent = (i - 1) >> 1; if (heap[parent][0] <= item[0]) break; heap[i] = heap[parent]; i = parent; }
      heap[i] = item;
    }
    function pop() {
      const first = heap[0], last = heap.pop();
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let child = i * 2 + 1;
          if (child + 1 < heap.length && heap[child + 1][0] < heap[child][0]) child++;
          if (heap[child][0] >= last[0]) break;
          heap[i] = heap[child]; i = child;
        }
        heap[i] = last;
      }
      return first;
    }
    push([0, start]);
    while (heap.length) {
      const [cost, id] = pop();
      if (cost !== distance.get(id)) continue;
      if (id === end) break;
      const p = point(id), ix = id % width, iy = Math.floor(id / width);
      const neighbors = [ix > 0 ? id - 1 : -1, ix + 1 < width ? id + 1 : -1, iy > 0 ? id - width : -1, iy + 1 < ys.length ? id + width : -1];
      for (const other of neighbors) {
        if (other < 0) continue;
        const q = point(other);
        if (blocked(p, q)) continue;
        const nextCost = cost + Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
        if (nextCost < (distance.get(other) ?? Infinity)) {
          distance.set(other, nextCost); previous.set(other, id); push([nextCost, other]);
        }
      }
    }
    if (!distance.has(end)) return null;
    const points = []; let cursor = end;
    while (cursor !== undefined) { points.push(point(cursor)); cursor = previous.get(cursor); }
    points.reverse();
    return points.filter((p, i) => !i || i === points.length - 1 ||
      !(points[i - 1].x === p.x && p.x === points[i + 1].x || points[i - 1].y === p.y && p.y === points[i + 1].y));
  }

  function route(nodes, edges) {
    const byId = new Map(nodes.map(n => [n.id, n]));
    return edges.map(edge => {
      const e = Object.assign([...edge], edge), a = byId.get(e[0]), b = byId.get(e[1]);
      e.t = 0; e.L = 0; e.p = [];
      if (!a || !b) return e;
      const center = n => ({ x: n.x + dimensions(n).w / 2, y: n.y + dimensions(n).h / 2 });
      const obstacles = nodes.filter(n => n.id !== a.id && n.id !== b.id).map(n => ({ l: n.x - .3, r: n.x + dimensions(n).w + .3, t: n.y - .3, b: n.y + dimensions(n).h + .3 }));
      e.p = pathBetween(center(a), center(b), obstacles) || [];
      // Overlapping authored geometry may have no safe route: expose it instead of
      // drawing a misleading line through an unrelated block.
      e.unroutable = !e.p.length;
      for (let i = 1; i < e.p.length; i++) e.L += Math.hypot(e.p[i].x - e.p[i - 1].x, e.p[i].y - e.p[i - 1].y);
      return e;
    });
  }
  return { layout, route, collapse };
});
