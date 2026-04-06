// plugin/code.js
// Runs in Figma's plugin sandbox — no browser APIs.
// WebSocket lives in ui.html. This file only touches the Figma scene.

figma.showUI(__html__, { width: 240, height: 420 });

// Load saved bridge URL and send to UI before anything else
figma.clientStorage.getAsync('bridgeUrl').then(function(saved) {
  figma.ui.postMessage({
    type: 'init',
    bridgeUrl: saved || 'ws://localhost:3100',
  });
});

var associatedNodeIds = [];   // ordered list of node IDs in context
var watchedContainerIds = []; // containers whose new children are auto-added
var watchAll = false;         // when true, auto-add every new node on the page
var savedSelection = [];      // saved before hover-highlight, restored on unhover
var d2Source = '';

// ---- Node helpers ----

function nodeIcon(node) {
  switch (node.type) {
    case 'FRAME':
    case 'GROUP': return '▣';
    case 'STICKY': return '◈';
    case 'SHAPE_WITH_TEXT': return '◆';
    case 'TEXT': return 'T';
    case 'CONNECTOR': return '↔';
    default: return '●';
  }
}

function nodeLabel(node) {
  var text = (node.characters) ||
             (node.text && node.text.characters) ||
             '';
  text = text.replace(/\n/g, ' ').trim().slice(0, 40);
  return text || node.name || node.type.toLowerCase();
}

// Recursively collect node + all descendant IDs
function collectIds(node) {
  var ids = [node.id];
  if (node.children) {
    node.children.forEach(function(child) {
      ids = ids.concat(collectIds(child));
    });
  }
  return ids;
}

function getAssociatedMeta() {
  return associatedNodeIds.map(function(id) {
    var node = figma.getNodeById(id);
    if (!node) return null;
    var bb = node.absoluteBoundingBox || { x: 0, y: 0, width: 100, height: 50 };
    return {
      id: id,
      type: node.type.toLowerCase(),
      label: nodeLabel(node),
      icon: nodeIcon(node),
      x: bb.x, y: bb.y, w: bb.width, h: bb.height,
    };
  }).filter(Boolean);
}

// ---- Spatial correlation ----
function associateStrokesWithNodes(strokes, nodes, threshold) {
  threshold = threshold || 80;
  return strokes.map(function(stroke) {
    var sc = { x: stroke.bounds.x + stroke.bounds.w / 2, y: stroke.bounds.y + stroke.bounds.h / 2 };
    var nearestId, minDist = Infinity;
    nodes.forEach(function(node) {
      var nc = { x: node.x + node.w / 2, y: node.y + node.h / 2 };
      var dist = Math.sqrt(Math.pow(sc.x - nc.x, 2) + Math.pow(sc.y - nc.y, 2));
      if (dist < threshold && dist < minDist) { minDist = dist; nearestId = node.id; }
    });
    return nearestId ? Object.assign({}, stroke, { near_node_id: nearestId }) : stroke;
  });
}

// Serialize only associated nodes for MCP canvas_read
function serializeAssociated() {
  var nodes = [], edges = [], strokes = [];
  associatedNodeIds.forEach(function(id) {
    var node = figma.getNodeById(id);
    if (!node) return;
    var bb = node.absoluteBoundingBox || { x: 0, y: 0, width: 100, height: 50 };
    if (node.type === 'CONNECTOR') {
      edges.push({
        id: node.id,
        from: node.connectorStart && node.connectorStart.endpointNodeId,
        to: node.connectorEnd && node.connectorEnd.endpointNodeId,
        label: node.text && node.text.characters,
      });
    } else if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION') {
      strokes.push({ id: node.id, path: '', bounds: { x: bb.x, y: bb.y, w: bb.width, h: bb.height } });
    } else {
      nodes.push({
        id: node.id,
        type: node.type.toLowerCase(),
        text: node.characters || (node.text && node.text.characters) || '',
        name: node.name,
        x: bb.x, y: bb.y, w: bb.width, h: bb.height,
      });
    }
  });
  strokes = associateStrokesWithNodes(strokes, nodes, 80);
  return { nodes: nodes, edges: edges, strokes: strokes };
}

// ---- D2 rendering (V1) ----
function renderD2(source, replyId) {
  var lines = source.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
  var nodeNames = {}, edgeDefs = [];
  lines.forEach(function(line) {
    var m = line.match(/^(.+?)\s*->\s*(.+?)(?::\s*(.+))?$/);
    if (m) {
      var from = m[1].trim().replace(/['"]/g, '');
      var to = m[2].trim().replace(/['"]/g, '');
      nodeNames[from] = true; nodeNames[to] = true;
      edgeDefs.push({ from: from, to: to, label: m[3] ? m[3].trim() : '' });
    } else {
      nodeNames[line.replace(/['"]/g, '')] = true;
    }
  });

  var names = Object.keys(nodeNames);
  var created = {};
  var promises = names.map(function(name, i) {
    return figma.loadFontAsync({ family: 'Inter', style: 'Regular' }).then(function() {
      var shape = figma.createShapeWithText();
      shape.shapeType = 'ROUNDED_RECTANGLE';
      shape.text.characters = name;
      shape.x = (i % 4) * 180;
      shape.y = Math.floor(i / 4) * 120;
      figma.currentPage.appendChild(shape);
      created[name] = shape;
      if (associatedNodeIds.indexOf(shape.id) === -1) associatedNodeIds.push(shape.id);
    });
  });

  Promise.all(promises).then(function() {
    edgeDefs.forEach(function(e) {
      var fn = created[e.from], tn = created[e.to];
      if (!fn || !tn) return;
      var connector = figma.createConnector();
      connector.connectorStart = { endpointNodeId: fn.id, magnet: 'AUTO' };
      connector.connectorEnd = { endpointNodeId: tn.id, magnet: 'AUTO' };
      figma.currentPage.appendChild(connector);
    });
    figma.ui.postMessage({ type: 'bridge_response', id: replyId, result: { ok: true } });
    figma.ui.postMessage({ type: 'd2_update', d2_source: source });
    figma.ui.postMessage({ type: 'associated_updated', items: getAssociatedMeta() });
  });
}

// ---- Selection change listener ----
figma.on('selectionchange', function() {
  var sel = figma.currentPage.selection;
  figma.ui.postMessage({ type: 'selection_changed', count: sel.length });
});

function isInsideWatchedContainer(node) {
  var ancestor = node.parent;
  while (ancestor) {
    if (watchedContainerIds.indexOf(ancestor.id) !== -1) return true;
    ancestor = ancestor.parent;
  }
  return false;
}

// ---- Document change listener ----
figma.on('documentchange', function(event) {
  var changed = false;

  event.documentChanges.forEach(function(change) {
    // Remove deleted nodes from association
    if (change.type === 'DELETE') {
      var wasAssociated = associatedNodeIds.indexOf(change.id) !== -1;
      var wasWatched = watchedContainerIds.indexOf(change.id) !== -1;
      if (wasAssociated || wasWatched) {
        associatedNodeIds = associatedNodeIds.filter(function(id) { return id !== change.id; });
        watchedContainerIds = watchedContainerIds.filter(function(id) { return id !== change.id; });
        changed = true;
      }
      return;
    }

    // Auto-add newly created nodes
    if (change.type === 'CREATE') {
      var node = figma.getNodeById(change.id);
      if (!node) return;
      if (associatedNodeIds.indexOf(node.id) !== -1) return;
      if (watchAll || isInsideWatchedContainer(node)) {
        associatedNodeIds.push(node.id);
        changed = true;
      }
      return;
    }

    // Catch nodes dragged into a watched container (parent change)
    if (change.type === 'PROPERTY_CHANGE') {
      if (!change.changedProperties || change.changedProperties.indexOf('parent') === -1) return;
      var node = figma.getNodeById(change.id);
      if (!node) return;
      if (associatedNodeIds.indexOf(node.id) !== -1) return;
      if (watchAll || isInsideWatchedContainer(node)) {
        associatedNodeIds.push(node.id);
        changed = true;
      }
    }
  });

  if (changed) {
    figma.ui.postMessage({ type: 'associated_updated', items: getAssociatedMeta() });
  }
});

// ---- UI message handler ----
figma.ui.onmessage = function(msg) {

  // --- Association management ---

  if (msg.type === 'add_selection') {
    var sel = figma.currentPage.selection;
    if (sel.length === 0) return;
    sel.forEach(function(node) {
      // Track containers for live child updates
      if (node.type === 'FRAME' || node.type === 'GROUP' || node.type === 'SECTION') {
        if (watchedContainerIds.indexOf(node.id) === -1) watchedContainerIds.push(node.id);
      }
      collectIds(node).forEach(function(id) {
        if (associatedNodeIds.indexOf(id) === -1) associatedNodeIds.push(id);
      });
    });
    figma.ui.postMessage({ type: 'associated_updated', items: getAssociatedMeta() });
    return;
  }

  if (msg.type === 'add_all') {
    figma.currentPage.children.forEach(function(node) {
      if (node.type === 'FRAME' || node.type === 'GROUP' || node.type === 'SECTION') {
        if (watchedContainerIds.indexOf(node.id) === -1) watchedContainerIds.push(node.id);
      }
      collectIds(node).forEach(function(id) {
        if (associatedNodeIds.indexOf(id) === -1) associatedNodeIds.push(id);
      });
    });
    figma.ui.postMessage({ type: 'associated_updated', items: getAssociatedMeta() });
    return;
  }

  if (msg.type === 'set_watch_all') {
    watchAll = msg.enabled;
    return;
  }

  if (msg.type === 'remove_node') {
    associatedNodeIds = associatedNodeIds.filter(function(id) { return id !== msg.id; });
    watchedContainerIds = watchedContainerIds.filter(function(id) { return id !== msg.id; });
    figma.ui.postMessage({ type: 'associated_updated', items: getAssociatedMeta() });
    return;
  }

  if (msg.type === 'get_associated') {
    figma.ui.postMessage({ type: 'associated_updated', items: getAssociatedMeta() });
    return;
  }

  // --- Hover / focus ---

  if (msg.type === 'hover_node') {
    var node = figma.getNodeById(msg.id);
    if (node && node.removed !== true) {
      savedSelection = figma.currentPage.selection.filter(function(n) { return !n.removed; });
      try { figma.currentPage.selection = [node]; } catch(e) {}
    }
    return;
  }

  if (msg.type === 'unhover_node') {
    try { figma.currentPage.selection = savedSelection.filter(function(n) { return !n.removed; }); } catch(e) {}
    return;
  }

  if (msg.type === 'focus_node') {
    var node = figma.getNodeById(msg.id);
    if (node && node.removed !== true) {
      try {
        figma.currentPage.selection = [node];
        figma.viewport.scrollAndZoomIntoView([node]);
      } catch(e) {}
    }
    return;
  }

  // --- Send message snapshot (user clicked Send in chat) ---

  if (msg.type === 'get_snapshot_for_send') {
    var payload = serializeAssociated();
    // No PNG for send — keep payload lean, MCP canvas_read can fetch PNG separately
    figma.ui.postMessage({ type: 'snapshot_for_send', payload: payload });
    return;
  }

  // --- Bridge commands forwarded from ui.html (MCP tools) ---

  if (msg.type === 'get_snapshot') {
    var payload = serializeAssociated();
    var associated = associatedNodeIds.map(function(id) { return figma.getNodeById(id); }).filter(Boolean);
    if (associated.length > 0) {
      associated[0].exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 0.5 } }).then(function(bytes) {
        figma.ui.postMessage({ type: 'snapshot_result', id: msg.id, payload: payload, pngBytes: bytes });
      }).catch(function() {
        figma.ui.postMessage({ type: 'snapshot_result', id: msg.id, payload: payload, pngBytes: null });
      });
    } else {
      figma.ui.postMessage({ type: 'snapshot_result', id: msg.id, payload: payload, pngBytes: null });
    }
    return;
  }

  if (msg.type === 'get_d2') {
    figma.ui.postMessage({ type: 'bridge_response', id: msg.id, result: { d2_source: d2Source } });
    return;
  }

  if (msg.type === 'create_sticky') {
    Promise.all([
      figma.loadFontAsync({ family: 'Inter', style: 'Medium' }),
      figma.loadFontAsync({ family: 'Inter', style: 'Regular' }),
    ]).then(function() {
      var sticky = figma.createSticky();
      sticky.text.characters = msg.text || '';
      sticky.x = msg.x || 0;
      sticky.y = msg.y || 0;
      if (msg.color) {
        var map = { blue: { r: 0.44, g: 0.64, b: 1 }, yellow: { r: 1, g: 0.93, b: 0.44 }, green: { r: 0.44, g: 0.93, b: 0.6 }, pink: { r: 1, g: 0.44, b: 0.73 } };
        var c = map[msg.color];
        if (c) sticky.fills = [{ type: 'SOLID', color: c }];
      }
      figma.currentPage.appendChild(sticky);
      figma.ui.postMessage({ type: 'bridge_response', id: msg.id, result: { node_id: sticky.id } });
    });
    return;
  }

  if (msg.type === 'create_text') {
    figma.loadFontAsync({ family: 'Inter', style: 'Regular' }).then(function() {
      var text = figma.createText();
      text.characters = msg.text || '';
      text.x = msg.x || 0;
      text.y = msg.y || 0;
      figma.currentPage.appendChild(text);
      figma.ui.postMessage({ type: 'bridge_response', id: msg.id, result: { node_id: text.id } });
    });
    return;
  }

  if (msg.type === 'update_d2') {
    d2Source = msg.d2_source || '';
    renderD2(d2Source, msg.id);
    return;
  }

  if (msg.type === 'save_bridge_url') {
    figma.clientStorage.setAsync('bridgeUrl', msg.url);
    return;
  }

  if (msg.id) {
    figma.ui.postMessage({ type: 'bridge_response', id: msg.id, result: { error: 'Unknown command: ' + msg.type } });
  }
};
