export function associateStrokesWithNodes(strokes, nodes, threshold = 80) {
  return strokes.map(stroke => {
    const sc = {
      x: stroke.bounds.x + stroke.bounds.w / 2,
      y: stroke.bounds.y + stroke.bounds.h / 2,
    };
    let nearestId;
    let minDist = Infinity;
    for (const node of nodes) {
      const nc = { x: node.x + node.w / 2, y: node.y + node.h / 2 };
      const dist = Math.hypot(sc.x - nc.x, sc.y - nc.y);
      if (dist < threshold && dist < minDist) {
        minDist = dist;
        nearestId = node.id;
      }
    }
    return nearestId ? { ...stroke, near_node_id: nearestId } : stroke;
  });
}
