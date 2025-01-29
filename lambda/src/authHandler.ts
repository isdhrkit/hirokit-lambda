import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { 
    SecretsManagerClient, 
    GetSecretValueCommand 
} from '@aws-sdk/client-secrets-manager';
import * as crypto from 'crypto';

const secretsManager = new SecretsManagerClient({});

// レスポンスヘッダーを定数として定義
const CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'https://www.hirokit.jp',
    'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true'
} as const;

interface AuthCredentials {
    username: string;
    password: string;
}

interface SecretData {
    username: string;
    password: string;
}

// CloudFront署名付きクッキーを生成する関数
function generateSignedCookie(
    privateKey: string,
    keyPairId: string,
    expireTime: number
): Record<string, string> {
    const policy = {
        Statement: [{
            Resource: '*',
            Condition: {
                DateLessThan: {
                    'AWS:EpochTime': expireTime
                }
            }
        }]
    };

    const policyString = JSON.stringify(policy);
    const encodedPolicy = Buffer.from(policyString).toString('base64');
    
    const signer = crypto.createSign('RSA-SHA1');
    signer.update(policyString);
    const signature = signer.sign(privateKey, 'base64');

    return {
        'CloudFront-Policy': encodedPolicy,
        'CloudFront-Signature': signature,
        'CloudFront-Key-Pair-Id': keyPairId
    };
}

export const handler = async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
    // OPTIONSリクエストに対する処理を追加
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: CORS_HEADERS,
            body: ''
        };
    }

    try {
        if (!event.body) {
            return {
                statusCode: 400,
                headers: CORS_HEADERS,
                body: JSON.stringify({ error: 'Request body is missing' })
            };
        }

        const credentials: AuthCredentials = JSON.parse(event.body);

        // 認証情報を取得
        const secretResponse = await secretsManager.send(new GetSecretValueCommand({
            SecretId: process.env.AUTH_SECRET_NAME
        }));

        const secretData: SecretData = JSON.parse(secretResponse.SecretString || '{}');

        // プライベートキーを取得
        const privateKeyResponse = await secretsManager.send(new GetSecretValueCommand({
            SecretId: process.env.PRIVATE_KEY_SECRET_NAME
        }));

        const privateKey = privateKeyResponse.SecretString;
        if (!privateKey) {
            throw new Error('Private key not found');
        }

        // キーペアIDを環境変数から取得
        const keyPairId = process.env.CLOUDFRONT_KEY_GROUP_ID;
        if (!keyPairId) {
            throw new Error('CLOUDFRONT_KEY_GROUP_ID is not set');
        }

        // 認証チェック
        if (
            credentials.username === secretData.username && 
            credentials.password === secretData.password
        ) {
            // 1時間有効な署名付きクッキーを生成
            const expireTime = Math.floor(Date.now() / 1000) + 1 * 60 * 60;
            const signedCookie = generateSignedCookie(
                privateKey,
                keyPairId,
                expireTime
            );

            return {
                statusCode: 200,
                headers: {
                    ...CORS_HEADERS,
                    'Set-Cookie': Object.entries(signedCookie).map(([key, value]) =>
                        `${key}=${value}; Path=/; Secure; HttpOnly; SameSite=None`
                    ).join('; ')
                },
                body: JSON.stringify({ 
                    message: 'Authentication successful',
                    expireTime
                })
            };
        }

        return {
            statusCode: 401,
            headers: CORS_HEADERS,
            body: JSON.stringify({ error: 'Invalid credentials' })
        };

    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            headers: CORS_HEADERS,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
}; 