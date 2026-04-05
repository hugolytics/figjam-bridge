// plugin/code.js
// Runs in Figma's plugin sandbox — no ES module imports.

figma.showUI(__html__, { width: 220, height: 280 });

const WS_URL = 'ws://localhost:3100';
let ws = null;
let sessionFrameId = null;
let d2Source = '';

// ---- Spatial correlation (inlined from spatial.js) ----
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

// ---- WebSocket ----
function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = function() { figma.ui.postMessage({ type: 'connection_status', connected: true }); };
  ws.onclose = function() {
    figma.ui.postMessage({ type: 'connection_status', connected: false });
    setTimeout(connect, 3000);
  };
  ws.onerror = function() { ws.close(); };
  ws.onmessage = function(event) {
    var cmd = JSON.parse(event.data);
    handleBridgeCommand(cmd);
  };
}
connect();

function sendResponse(id, result) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ id: id, result: result }));
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
  if (!frame) return { nodes: [], edges: [], strokes: [], snapshot_png: '' };

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
  return { nodes: nodes, edges: edges, strokes: strokes, snapshot_png: '' };
}

// ---- Bridge command handler ----
function handleBridgeCommand(cmd) {
  var frame = getSessionFrame();

  if (cmd.type === 'get_snapshot') {
    var payload = serializeCanvas();
    // Export frame as PNG
    if (frame) {
      frame.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } }).then(function(bytes) {
        var b64 = figma.base64Encode(bytes);
        payload.snapshot_png = b64;
        sendResponse(cmd.id, payload);
      });
    } else {
      sendResponse(cmd.id, payload);
    }
    return;
  }

  if (cmd.type === 'get_d2') {
    sendResponse(cmd.id, { d2_source: d2Source });
    return;
  }

  if (cmd.type === 'create_sticky') {
    if (!frame) { sendResponse(cmd.id, { error: 'No active session' }); return; }
    var sticky = figma.createSticky();
    sticky.text.characters = cmd.text || '';
    sticky.x = cmd.x || 0;
    sticky.y = cmd.y || 0;
    frame.appendChild(sticky);
    sendResponse(cmd.id, { node_id: sticky.id });
    return;
  }

  if (cmd.type === 'create_text') {
    if (!frame) { sendResponse(cmd.id, { error: 'No active session' }); return; }
    var text = figma.createText();
    figma.loadFontAsync({ family: 'Inter', style: 'Regular' }).then(function() {
      text.characters = cmd.text || '';
      text.x = cmd.x || 0;
      text.y = cmd.y || 0;
      frame.appendChild(text);
      sendResponse(cmd.id, { node_id: text.id });
    });
    return;
  }

  if (cmd.type === 'update_d2') {
    d2Source = cmd.d2_source || '';
    figma.ui.postMessage({ type: 'd2_update', d2_source: d2Source });
    // V1: parse nodes and edges from D2 and create basic shapes
    renderD2(d2Source, frame, cmd.id);
    return;
  }

  sendResponse(cmd.id, { error: 'Unknown command: ' + cmd.type });
}

// ---- D2 rendering (V1: basic, no layout engine) ----
function renderD2(source, frame, cmdId) {
  if (!frame) { sendResponse(cmdId, { ok: false, error: 'No frame' }); return; }

  // Parse lines like: "A -> B" or "A -> B: label" or standalone node "A"
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
    sendResponse(cmdId, { ok: true });
  });
}

// ---- UI message handler ----
figma.ui.onmessage = function(msg) {
  if (msg.type === 'new_session') {
    var date = new Date().toISOString().slice(0, 10);
    var frame = figma.createFrame();
    frame.name = '[Session — ' + date + ']';
    frame.resize(1200, 800);
    frame.x = figma.viewport.center.x - 600;
    frame.y = figma.viewport.center.y - 400;
    sessionFrameId = frame.id;
    figma.viewport.scrollAndZoomIntoView([frame]);
  }

  if (msg.type === 'ask_claude') {
    var payload = serializeCanvas();
    var frame = getSessionFrame();
    if (frame) {
      frame.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } }).then(function(bytes) {
        payload.snapshot_png = figma.base64Encode(bytes);
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ event: 'ask_claude', payload: payload }));
        }
      });
    }
  }
};
