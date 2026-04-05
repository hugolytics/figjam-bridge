// plugin/code.js
// Runs in Figma's plugin sandbox — no browser APIs (no WebSocket, fetch, setTimeout).
// WebSocket lives in ui.html. This file only touches the Figma scene.

figma.showUI(__html__, { width: 220, height: 280 });

var sessionFrameId = null;
var d2Source = '';

// ---- Spatial correlation ----
function associateStrokesWithNodes(strokes, nodes, threshold) {
  threshold = threshold || 80;
  return strokes.map(function(stroke) {
    var sc = { x: stroke.bounds.x + stroke.bounds.w / 2, y: stroke.bounds.y + stroke.bounds.h / 2 };
    var nearestId;
    var minDist = Infinity;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var nc = { x: node.x + node.w / 2, y: node.y + node.h / 2 };
      var dist = Math.sqrt(Math.pow(sc.x - nc.x, 2) + Math.pow(sc.y - nc.y, 2));
      if (dist < threshold && dist < minDist) { minDist = dist; nearestId = node.id; }
    }
    return nearestId ? Object.assign({}, stroke, { near_node_id: nearestId }) : stroke;
  });
}

// ---- Session frame ----
function getSessionFrame() {
  if (sessionFrameId) {
    var node = figma.getNodeById(sessionFrameId);
    if (node) return node;
  }
  return null;
}

function serializeCanvas() {
  var frame = getSessionFrame();
  if (!frame) return { nodes: [], edges: [], strokes: [] };

  var nodes = [];
  var edges = [];
  var strokes = [];

  frame.children.forEach(function(child) {
    if (child.type === 'CONNECTOR') {
      edges.push({
        id: child.id,
        from: child.connectorStart && child.connectorStart.endpointNodeId,
        to: child.connectorEnd && child.connectorEnd.endpointNodeId,
        label: child.text && child.text.characters,
      });
    } else if (child.type === 'VECTOR' || child.type === 'BOOLEAN_OPERATION') {
      var b = child.absoluteBoundingBox || { x: 0, y: 0, width: 10, height: 10 };
      strokes.push({ id: child.id, path: '', bounds: { x: b.x, y: b.y, w: b.width, h: b.height } });
    } else {
      var bb = child.absoluteBoundingBox || { x: 0, y: 0, width: 100, height: 50 };
      nodes.push({
        id: child.id,
        type: child.type.toLowerCase(),
        text: child.characters || (child.text && child.text.characters) || '',
        x: bb.x, y: bb.y, w: bb.width, h: bb.height,
      });
    }
  });

  strokes = associateStrokesWithNodes(strokes, nodes, 80);
  return { nodes: nodes, edges: edges, strokes: strokes };
}

// ---- D2 rendering (V1: basic, no layout engine) ----
function renderD2(source, frame, replyId) {
  if (!frame) {
    figma.ui.postMessage({ type: 'bridge_response', id: replyId, result: { ok: false, error: 'No frame' } });
    return;
  }

  var lines = source.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
  var nodeNames = {};
  var edgeDefs = [];

  lines.forEach(function(line) {
    var arrowMatch = line.match(/^(.+?)\s*->\s*(.+?)(?::\s*(.+))?$/);
    if (arrowMatch) {
      var from = arrowMatch[1].trim().replace(/['"]/g, '');
      var to = arrowMatch[2].trim().replace(/['"]/g, '');
      var label = arrowMatch[3] ? arrowMatch[3].trim() : '';
      nodeNames[from] = true;
      nodeNames[to] = true;
      edgeDefs.push({ from: from, to: to, label: label });
    } else {
      nodeNames[line.replace(/['"]/g, '')] = true;
    }
  });

  var names = Object.keys(nodeNames);
  var createdNodes = {};
  var promises = names.map(function(name, i) {
    return figma.loadFontAsync({ family: 'Inter', style: 'Regular' }).then(function() {
      var shape = figma.createShapeWithText();
      shape.shapeType = 'ROUNDED_RECTANGLE';
      shape.text.characters = name;
      shape.x = (i % 4) * 180;
      shape.y = Math.floor(i / 4) * 120;
      frame.appendChild(shape);
      createdNodes[name] = shape;
    });
  });

  Promise.all(promises).then(function() {
    edgeDefs.forEach(function(e) {
      var fromNode = createdNodes[e.from];
      var toNode = createdNodes[e.to];
      if (!fromNode || !toNode) return;
      var connector = figma.createConnector();
      connector.connectorStart = { endpointNodeId: fromNode.id, magnet: 'AUTO' };
      connector.connectorEnd = { endpointNodeId: toNode.id, magnet: 'AUTO' };
      frame.appendChild(connector);
    });
    figma.ui.postMessage({ type: 'bridge_response', id: replyId, result: { ok: true } });
    figma.ui.postMessage({ type: 'd2_update', d2_source: source });
  });
}

// ---- UI message handler ----
// Messages arrive from ui.html — either user actions or forwarded bridge commands.
figma.ui.onmessage = async function(msg) {

  // --- User actions (no bridge response needed) ---

  if (msg.type === 'new_session') {
    var date = new Date().toISOString().slice(0, 10);
    var frame = figma.createFrame();
    frame.name = '[Session — ' + date + ']';
    frame.resize(1200, 800);
    frame.x = figma.viewport.center.x - 600;
    frame.y = figma.viewport.center.y - 400;
    sessionFrameId = frame.id;
    figma.viewport.scrollAndZoomIntoView([frame]);
    return;
  }

  // "Ask Claude" button: serialize canvas + PNG, send back to UI for forwarding to bridge
  if (msg.type === 'ask_claude') {
    var payload = serializeCanvas();
    var frame = getSessionFrame();
    if (frame) {
      var bytes = await frame.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } });
      figma.ui.postMessage({ type: 'ask_claude_payload', payload: payload, pngBytes: bytes });
    } else {
      figma.ui.postMessage({ type: 'ask_claude_payload', payload: payload, pngBytes: null });
    }
    return;
  }

  // --- Bridge commands forwarded from ui.html ---
  // All have { type, id, ...args } and expect { type: 'bridge_response', id, result }

  if (msg.type === 'get_snapshot') {
    var payload = serializeCanvas();
    var frame = getSessionFrame();
    if (frame) {
      var bytes = await frame.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } });
      figma.ui.postMessage({ type: 'snapshot_result', id: msg.id, payload: payload, pngBytes: bytes });
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
    var frame = getSessionFrame();
    if (!frame) { figma.ui.postMessage({ type: 'bridge_response', id: msg.id, result: { error: 'No active session' } }); return; }
    var sticky = figma.createSticky();
    sticky.text.characters = msg.text || '';
    sticky.x = msg.x || 0;
    sticky.y = msg.y || 0;
    if (msg.color) {
      var colorMap = { blue: { r: 0.44, g: 0.64, b: 1 }, yellow: { r: 1, g: 0.93, b: 0.44 }, green: { r: 0.44, g: 0.93, b: 0.6 }, pink: { r: 1, g: 0.44, b: 0.73 } };
      var c = colorMap[msg.color];
      if (c) sticky.fills = [{ type: 'SOLID', color: c }];
    }
    frame.appendChild(sticky);
    figma.ui.postMessage({ type: 'bridge_response', id: msg.id, result: { node_id: sticky.id } });
    return;
  }

  if (msg.type === 'create_text') {
    var frame = getSessionFrame();
    if (!frame) { figma.ui.postMessage({ type: 'bridge_response', id: msg.id, result: { error: 'No active session' } }); return; }
    var text = figma.createText();
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    text.characters = msg.text || '';
    text.x = msg.x || 0;
    text.y = msg.y || 0;
    frame.appendChild(text);
    figma.ui.postMessage({ type: 'bridge_response', id: msg.id, result: { node_id: text.id } });
    return;
  }

  if (msg.type === 'update_d2') {
    d2Source = msg.d2_source || '';
    renderD2(d2Source, getSessionFrame(), msg.id);
    return;
  }

  figma.ui.postMessage({ type: 'bridge_response', id: msg.id, result: { error: 'Unknown command: ' + msg.type } });
};
