function diffCollection(prev, next) {
  const prevMap = new Map((prev ?? []).map(item => [item.id, JSON.stringify(item)]));
  const nextMap = new Map((next ?? []).map(item => [item.id, JSON.stringify(item)]));

  const added = [];
  const removed = [];
  const changed = [];

  for (const [id, json] of nextMap) {
    if (!prevMap.has(id)) added.push(id);
    else if (prevMap.get(id) !== json) changed.push(id);
  }
  for (const id of prevMap.keys()) {
    if (!nextMap.has(id)) removed.push(id);
  }
  return { added, removed, changed };
}

export function diffCanvas(prev, next) {
  const prevPayload = prev ?? { nodes: [], edges: [], strokes: [] };
  const nodes = diffCollection(prevPayload.nodes, next.nodes);
  const edges = diffCollection(prevPayload.edges, next.edges);
  const strokes = diffCollection(prevPayload.strokes, next.strokes);
  return {
    added_nodes: nodes.added,
    removed_nodes: nodes.removed,
    changed_nodes: nodes.changed,
    added_edges: edges.added,
    removed_edges: edges.removed,
    changed_edges: edges.changed,
    added_strokes: strokes.added,
    removed_strokes: strokes.removed,
  };
}
