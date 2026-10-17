import { describe, expect, it } from 'vitest';
import { AnthropicCompatibleModel, OpenAICompatibleModel } from '../../packages/supervisor/src/index.js';

const turn = { stage: 'solving' as const, challenge: { id: 'c', target: 'http://127.0.0.1', description: 'x' }, observations: [] };

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('model adapters', () => {
  it('uses the Anthropic Messages wire format without leaking the API key', async () => {
    let request!: Request;
    const model = new AnthropicCompatibleModel({
      id: 'deepseek-v4-flash',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
      apiKey: 'secret',
      fetchImpl: async (input, init) => {
        request = new Request(input, init);
        return jsonResponse({ content: [{ type: 'text', text: 'CANDIDATE: flag{x}' }], usage: { input_tokens: 5, output_tokens: 7 } });
      }
    });
    const result = await model.invoke(turn);
    expect(new URL(request.url).toString()).toBe('https://ark.cn-beijing.volces.com/api/coding/v1/messages');
    expect(request.headers.get('x-api-key')).toBe('secret');
    const body = await request.json();
    expect(body.model).toBe('deepseek-v4-flash');
    expect(result).toEqual({ text: 'CANDIDATE: flag{x}', observableTokens: 12 });
  });

  it('uses the OpenAI-compatible chat wire format', async () => {
    let request!: Request;
    const model = new OpenAICompatibleModel({
      id: 'model-x',
      baseUrl: 'https://example.test/v1',
      apiKey: 'secret',
      fetchImpl: async (input, init) => {
        request = new Request(input, init);
        return jsonResponse({ choices: [{ message: { content: 'ok' } }], usage: { total_tokens: 3 } });
      }
    });
    await expect(model.invoke(turn)).resolves.toEqual({ text: 'ok', observableTokens: 3 });
    expect(new URL(request.url).pathname).toBe('/v1/chat/completions');
  });
});

describe('Anthropic tool loop', () => {
  it('executes tool_use, returns tool_result, and accepts the final answer', async () => {
    let call = 0;
    const requests: any[] = [];
    const model = new AnthropicCompatibleModel({
      id: 'deepseek-v4-flash',
      baseUrl: 'https://ark.example/api/coding',
      apiKey: 'secret',
      maxToolRounds: 2,
      tools: [{
        name: 'http_request',
        description: 'HTTP GET',
        input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
        execute: async input => ({ status: 200, body: `flag for ${(input as any).url}` })
      }],
      fetchImpl: async (input, init) => {
        requests.push(JSON.parse(String(init?.body)));
        call++;
        if (call === 1) {
          return jsonResponse({
            content: [
              { type: 'text', text: 'Checking target.' },
              { type: 'tool_use', id: 'tool_1', name: 'http_request', input: { url: 'http://target/robots.txt' } }
            ],
            usage: { input_tokens: 10, output_tokens: 5 }
          });
        }
        return jsonResponse({ content: [{ type: 'text', text: 'CANDIDATE: flag{found}' }], usage: { input_tokens: 20, output_tokens: 3 } });
      }
    });
    const result = await model.invoke(turn);
    expect(result).toEqual({ text: 'CANDIDATE: flag{found}', observableTokens: 38 });
    expect(requests[1].messages.at(-1).content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tool_1' });
  });
});
