import { associateStrokesWithNodes } from '../spatial.js';

const nodes = [
  { id: 'n1', x: 0, y: 0, w: 100, h: 50 },
  { id: 'n2', x: 300, y: 300, w: 100, h: 50 },
];

test('associates stroke near node n1', () => {
  const strokes = [{ id: 's1', path: '', bounds: { x: 10, y: 10, w: 20, h: 20 } }];
  const result = associateStrokesWithNodes(strokes, nodes, 80);
  expect(result[0].near_node_id).toBe('n1');
});

test('no association when stroke is far from all nodes', () => {
  const strokes = [{ id: 's2', path: '', bounds: { x: 500, y: 500, w: 20, h: 20 } }];
  const result = associateStrokesWithNodes(strokes, nodes, 80);
  expect(result[0].near_node_id).toBeUndefined();
});

test('associates with nearest node when two are within threshold', () => {
  const strokes = [{ id: 's3', path: '', bounds: { x: 50, y: 25, w: 10, h: 10 } }];
  // Center of s3: (55, 30). n1 center: (50, 25). n2 center: (350, 325). Clearly n1.
  const result = associateStrokesWithNodes(strokes, nodes, 80);
  expect(result[0].near_node_id).toBe('n1');
});
