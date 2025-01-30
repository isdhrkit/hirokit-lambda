import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { 
    SecretsManagerClient, 
    GetSecretValueCommand 
} from '@aws-sdk/client-secrets-manager';
import * as crypto from 'crypto';
import * as awsCloudFrontSign from 'aws-cloudfront-sign';

const secretsManager = new SecretsManagerClient({});

// レスポンスヘッダーを定数として定義を修正
const CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'https://www.hirokit.jp',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',  // GETも追加
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
} as const;

interface AuthCredentials {
    username: string;
    password: string;
}

interface SecretData {
    username: string;
    password: string;  // ここに保存されているパスワードはハッシュ化済み
}

// CloudFront署名付きクッキーを生成する関数
function generateSignedCookie(
    privateKey: string,
    keyPairId: string,
    expireTime: number
): Record<string, string> {
    const options = {
        keypairId: keyPairId,
        privateKeyString: privateKey,
        expireTime: expireTime * 1000
    };

    return awsCloudFrontSign.getSignedCookies(
        '*.hirokit.jp/*',  // パスを/*に変更
        options
    );
}

// パスワードをハッシュ化する関数を追加
function hashPassword(password: string): string {
    console.log(crypto.createHash('sha256').update(password).digest('hex'));
    return crypto
        .createHash('sha256')
        .update(password)
        .digest('hex');
}

// CloudFrontの署名付きクッキーを検証する関数
function validateSignedCookie(cookies: Record<string, string>): boolean {
    // 必要なクッキーが全て存在するか確認
    const requiredCookies = [
        'CloudFront-Policy',
        'CloudFront-Signature',
        'CloudFront-Key-Pair-ID'
    ];

    const hasCookies = requiredCookies.every(cookieName => {
        return cookies[cookieName] !== undefined;
    });

    if (!hasCookies) {
        return false;
    }

    // ポリシーの有効期限をチェック
    try {
        const policy = JSON.parse(
            Buffer.from(cookies['CloudFront-Policy'], 'base64').toString()
        );
        const expireTime = policy.Statement[0].Condition.DateLessThan['AWS:EpochTime'];
        return Date.now() / 1000 < expireTime;
    } catch {
        return false;
    }
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

    // 認証チェックエンドポイントの処理を追加
    if (event.resource === '/auth/check') {
        const cookies = event.headers?.cookie?.split(';')
            .reduce((acc: Record<string, string>, cookie) => {
                const [key, value] = cookie.trim().split('=');
                acc[key] = value;
                return acc;
            }, {}) || {};

        if (validateSignedCookie(cookies)) {
            return {
                statusCode: 200,
                headers: CORS_HEADERS,
                body: JSON.stringify({ 
                    authenticated: true,
                    message: 'Valid authentication' 
                })
            };
        }

        return {
            statusCode: 401,
            headers: CORS_HEADERS,
            body: JSON.stringify({ 
                authenticated: false,
                message: 'Not authenticated' 
            })
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
            hashPassword(credentials.password) === secretData.password
        ) {
            const expireTime = Math.floor(Date.now() / 1000) + 1 * 60 * 60;
            const signedCookie = generateSignedCookie(
                privateKey,
                keyPairId,
                expireTime
            );

            // クッキーの設定を修正
            const cookieHeaders = Object.entries(signedCookie).map(
                ([key, value]) =>
                    `${key}=${value}; Path=/; Domain=.hirokit.jp; Secure; HttpOnly`
            );

            console.log({
                ...CORS_HEADERS,
                'Set-Cookie': cookieHeaders
            });

            return {
                statusCode: 200,
                headers: {
                    ...CORS_HEADERS
                },
                multiValueHeaders: {
                    'Set-Cookie': cookieHeaders
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