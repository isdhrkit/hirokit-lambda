import { handler } from './chatHandler';
import OpenAI from 'openai';

jest.mock('openai', () => ({
  default: function() {
    return {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: 'テストレスポンス'
                }
              }
            ]
          })
        }
      }
    };
  }
}));

describe('chatHandler', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-api-key';
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('正常なリクエストを処理できること', async () => {
    const event = {
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'こんにちは' }
        ]
      })
    };

    const response = await handler(event as any);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      response: 'テストレスポンス'
    });
  });

  it('リクエストボディが無い場合400エラーを返すこと', async () => {
    const event = {};

    const response = await handler(event as any);

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: 'Request body is missing'
    });
  });

  it('不正なJSONの場合400エラーを返すこと', async () => {
    const event = {
      body: 'invalid json'
    };

    const response = await handler(event as any);

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: 'Invalid JSON in request body'
    });
  });
}); 