const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-5';

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

// client = { complete({ messages }) => Promise<string> }
export function buildClaudeHandler(client) {
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
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${snapshot_png}` },
      });
    }

    const text = await client.complete({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    });

    try {
      return JSON.parse(text);
    } catch {
      return { message: text, writes: [] };
    }
  };
}

export function createOpenRouterClient(apiKey, model = DEFAULT_MODEL) {
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
  return {
    async complete({ messages }) {
      const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/hugolytics/figjam-bridge',
        },
        body: JSON.stringify({ model, messages, max_tokens: 1024 }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`OpenRouter error ${res.status}: ${err}`);
      }
      const data = await res.json();
      return data.choices[0]?.message?.content ?? '';
    },
  };
}
