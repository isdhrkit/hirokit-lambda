import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import OpenAI from 'openai';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});
let openai: OpenAI | null = null;

// OpenAIクライアントを初期化する関数
async function initializeOpenAI() {
    if (!openai) {
        const parameterName = process.env.OPENAI_API_KEY_PARAMETER_NAME;
        if (!parameterName) {
            throw new Error('OPENAI_API_KEY_PARAMETER_NAME is not set');
        }

        const command = new GetParameterCommand({
            Name: parameterName,
            WithDecryption: true
        });

        const response = await ssm.send(command);
        const apiKey = response.Parameter?.Value;
        
        if (!apiKey) {
            throw new Error('Failed to get OpenAI API key from SSM');
        }

        openai = new OpenAI({
            apiKey: apiKey
        });
    }
    return openai;
}

interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

const createResponse = (statusCode: number, body: any) => ({
    statusCode,
    headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type'
    },
    body: JSON.stringify(body)
});

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        if (!event.body) {
            return createResponse(400, { error: 'Request body is missing' });
        }

        // OpenAIクライアントの初期化
        const client = await initializeOpenAI();

        const { messages } = JSON.parse(event.body) as { messages: ChatMessage[] };

        const completion = await client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: messages,
        });

        return createResponse(200, {
            response: completion.choices[0].message.content
        });

    } catch (error) {
        if (error instanceof SyntaxError) {
            return createResponse(400, { error: 'Invalid JSON in request body' });
        }
        
        console.error('Error:', error);
        return createResponse(500, { error: 'Internal server error' });
    }
}; 