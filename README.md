# FigJam ↔ Claude Bridge

Local bridge that lets Claude read and write your FigJam session canvas via MCP.

## Setup

### 1. Install dependencies
cd tools/figjam-bridge
npm install

### 2. Load the plugin in Figma
- Open the Figma desktop app
- Go to Plugins → Development → Import plugin from manifest
- Select tools/figjam-bridge/plugin/manifest.json

### 3. Start a session
- Open any FigJam file
- Run the Claude Bridge plugin (Plugins → Development → Claude Bridge)
- Click New Session — a session frame appears on the canvas
- Note: The plugin reconnects automatically — you may see a brief disconnect on first
  load while Claude Code starts the bridge.

### 4. The bridge starts automatically
Claude Code starts bridge/index.js via MCP when you use a canvas_* tool.
Or start it manually: npm start from tools/figjam-bridge/.

## Usage

From Claude Code: Call any canvas_* MCP tool. Claude reads your canvas and can write
stickies, text, shapes, or a D2 diagram.

From FigJam: Draw, annotate, then click Ask Claude. Claude responds directly on your
canvas as a blue sticky.

## V2 Roadmap
- Plug into an existing board (scoped frame)
- Git-versioned D2 source
- Proper D2 layout via WASM
- Works when Figma is closed (Figma REST API read path)
