import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = `You are a thinking partner embedded in a FigJam canvas.
The user has shared their canvas state: nodes, edges, freehand strokes, and a screenshot.
Your job is to help them understand patterns, structure their thinking, and move towards testable hypotheses.

Respond ONLY with a JSON object in this format:
{
  "message": "<your response — will appear as a sticky on the canvas>",
  "writes": [
    { "tool": "canvas_write_sticky", "args": { "text": "...", "x": 100, "y": 200, "color": "yellow" } }
  ]
}
The "writes" array is optional. Use it to place stickies or text on the canvas.
If you have no canvas writes, return an empty array.
Do not wrap the JSON in markdown code fences.`;

export function buildClaudeHandler(anthropic) {
  return async function handleAskClaude(canvasPayload) {
    const { snapshot_png, ...structuredData } = canvasPayload;

    const userContent = [
      {
        type: 'text',
        text: `Canvas state:\n${JSON.stringify(structuredData, null, 2)}\n\nWhat do you see? Help me structure my thinking.`,
      },
    ];

    if (snapshot_png) {
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: snapshot_png },
      });
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });

    const text = response.content[0]?.text ?? '';

    try {
      return JSON.parse(text);
    } catch {
      return { message: text, writes: [] };
    }
  };
}

export function createAnthropicClient() {
  return new Anthropic();
}
