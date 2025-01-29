import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import OpenAI from 'openai';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

// SSMクライアントをグローバルスコープで1回だけ初期化
const ssm = new SSMClient({
    maxAttempts: 3, // リトライ回数を制限
});

// OpenAIクライアントをキャッシュ
let openaiClient: OpenAI | null = null;
let apiKeyCache: string | null = null;

// レスポンスヘッダーを定数として定義
const CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'Content-Type'
} as const;

interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

// レスポンス生成を最適化
const createResponse = (statusCode: number, body: Record<string, unknown>): APIGatewayProxyResult => ({
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
});

// OpenAIクライアントの初期化を最適化
async function getOpenAIClient(): Promise<OpenAI> {
    if (openaiClient) return openaiClient;

    const parameterName = process.env.OPENAI_API_KEY_PARAMETER_NAME;
    if (!parameterName) {
        throw new Error('OPENAI_API_KEY_PARAMETER_NAME is not set');
    }

    if (!apiKeyCache) {
        const command = new GetParameterCommand({
            Name: parameterName,
            WithDecryption: true
        });

        const response = await ssm.send(command);
        apiKeyCache = response.Parameter?.Value ?? null;
        
        if (!apiKeyCache) {
            throw new Error('Failed to get OpenAI API key from SSM');
        }
    }

    openaiClient = new OpenAI({ apiKey: apiKeyCache });
    return openaiClient;
}

// メインハンドラー
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        // リクエストの検証
        if (!event.body) {
            return createResponse(400, { error: 'Request body is missing' });
        }

        // JSONパースを1回だけ実行
        let messages: ChatMessage[];
        try {
            ({ messages } = JSON.parse(event.body) as { messages: ChatMessage[] });
        } catch {
            return createResponse(400, { error: 'Invalid JSON in request body' });
        }

        // メッセージの基本的なバリデーション
        if (!Array.isArray(messages) || messages.length === 0) {
            return createResponse(400, { error: 'Invalid messages format' });
        }

        // ユーザーの最後のメッセージをログに出力
        const userMessage = [...messages].reverse().find(msg => msg.role === 'user');
        if (userMessage) {
            console.log('User question:', {
                content: userMessage.content,
                timestamp: new Date().toISOString(),
                requestId: event.requestContext?.requestId
            });
        }

        const client = await getOpenAIClient();
        
        // OpenAI APIの呼び出し
        const completion = await client.chat.completions.create({
            model: "gpt-4o-mini",
            messages,
            max_tokens: 1000, // トークン数を制限してレスポンス時間を短縮
            temperature: 0.7,
        });

        return createResponse(200, {
            response: completion.choices[0].message.content
        });

    } catch (error) {
        // エラーログの詳細化
        console.error('Error details:', {
            name: error instanceof Error ? error.name : 'Unknown',
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        });

        // エラーレスポンスの最適化
        return createResponse(500, {
            error: 'Internal server error',
            requestId: event.requestContext?.requestId
        });
    }
}; 