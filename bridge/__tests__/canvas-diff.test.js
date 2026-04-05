import { diffCanvas } from '../canvas-diff.js';

const base = {
  nodes: [{ id: 'n1', text: 'hello', x: 0, y: 0, w: 100, h: 50, type: 'sticky' }],
  edges: [{ id: 'e1', from: 'n1', to: 'n2' }],
  strokes: [{ id: 's1', path: 'M0 0', bounds: { x: 0, y: 0, w: 10, h: 10 } }],
};

test('no diff on identical payloads', () => {
  const diff = diffCanvas(base, base);
  expect(diff.added_nodes).toHaveLength(0);
  expect(diff.removed_nodes).toHaveLength(0);
  expect(diff.changed_nodes).toHaveLength(0);
});

test('detects added node', () => {
  const next = { ...base, nodes: [...base.nodes, { id: 'n2', text: 'world', x: 0, y: 0, w: 100, h: 50, type: 'shape' }] };
  const diff = diffCanvas(base, next);
  expect(diff.added_nodes).toContain('n2');
});

test('detects removed edge', () => {
  const next = { ...base, edges: [] };
  const diff = diffCanvas(base, next);
  expect(diff.removed_edges).toContain('e1');
});

test('detects changed node (text changed)', () => {
  const next = { ...base, nodes: [{ ...base.nodes[0], text: 'changed' }] };
  const diff = diffCanvas(base, next);
  expect(diff.changed_nodes).toContain('n1');
});

test('detects added stroke', () => {
  const next = { ...base, strokes: [...base.strokes, { id: 's2', path: 'M1 1', bounds: { x: 1, y: 1, w: 5, h: 5 } }] };
  const diff = diffCanvas(base, next);
  expect(diff.added_strokes).toContain('s2');
});

test('returns empty diff when prev is null (first read)', () => {
  const diff = diffCanvas(null, base);
  expect(diff.added_nodes).toContain('n1');
  expect(diff.added_edges).toContain('e1');
  expect(diff.added_strokes).toContain('s1');
});
