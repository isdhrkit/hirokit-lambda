import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import OpenAI from 'openai';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import axios from 'axios';

const ssm = new SSMClient({});
let openai: OpenAI | null = null;
let googleApiKey: string | null = null;
let googleSearchEngineId: string | null = null;

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

async function initializeGoogleCredentials() {
    if (!googleApiKey || !googleSearchEngineId) {
        const apiKeyParamName = process.env.GOOGLE_API_KEY_PARAMETER_NAME;
        const searchEngineIdParamName = process.env.GOOGLE_SEARCH_ENGINE_ID_PARAMETER_NAME;

        if (!apiKeyParamName || !searchEngineIdParamName) {
            throw new Error('Google API parameter names are not set');
        }

        const [apiKeyResponse, searchEngineIdResponse] = await Promise.all([
            ssm.send(new GetParameterCommand({
                Name: apiKeyParamName,
                WithDecryption: true
            })),
            ssm.send(new GetParameterCommand({
                Name: searchEngineIdParamName,
                WithDecryption: true
            }))
        ]);

        googleApiKey = apiKeyResponse.Parameter?.Value ?? null;
        googleSearchEngineId = searchEngineIdResponse.Parameter?.Value ?? null;

        if (!googleApiKey || !googleSearchEngineId) {
            throw new Error('Failed to get Google API credentials from SSM');
        }
    }
    return { googleApiKey, googleSearchEngineId };
}

async function searchGoogle(query: string): Promise<any> {
    const { googleApiKey, googleSearchEngineId } = await initializeGoogleCredentials();
    
    const url = `https://www.googleapis.com/customsearch/v1?key=${googleApiKey}&cx=${googleSearchEngineId}&q=${encodeURIComponent(query)}&num=10`;
    
    try {
        const response = await axios.get(url);
        return response.data.items || [];
    } catch (error) {
        console.error('Google Search API error:', error);
        throw error;
    }
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

        const client = await initializeOpenAI();
        const { messages } = JSON.parse(event.body);

        // Function Callingを使用して検索の必要性を判断
        const functionCallResponse = await client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: messages,
            tools: [
                {
                    type: "function",
                    function: {
                        name: "search_google",
                        description: "Search Google for current information",
                        parameters: {
                            type: "object",
                            properties: {
                                query: {
                                    type: "string",
                                    description: "The search query"
                                }
                            },
                            required: ["query"]
                        }
                    }
                }
            ],
            tool_choice: "required"
        });

        const responseMessage = functionCallResponse.choices[0].message;

        // 検索が必要な場合
        if (responseMessage.tool_calls) {
            const toolCall = responseMessage.tool_calls[0];
            const functionArgs = JSON.parse(toolCall.function.arguments);
            const searchResults = await searchGoogle(functionArgs.query);

            console.log('Search Query:', functionArgs.query);
            console.log('Search Results:', searchResults);

            // 検索結果を含めた最終応答
            const finalResponse = await client.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    ...messages,
                    responseMessage,
                    {
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: "search_google",
                        content: JSON.stringify(searchResults)
                    }
                ]
            });
            return createResponse(200, {
                response: finalResponse.choices[0].message.content
            });
        }

        // 検索が不要な場合
        return createResponse(200, {
            response: responseMessage.content
        });
    } catch (error) {
        console.error('Error:', error);
        return createResponse(500, { error: 'Internal server error' });
    }
}; 