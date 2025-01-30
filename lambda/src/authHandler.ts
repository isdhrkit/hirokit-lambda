import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { 
    SecretsManagerClient, 
    GetSecretValueCommand 
} from '@aws-sdk/client-secrets-manager';
import * as crypto from 'crypto';
import * as awsCloudFrontSign from 'aws-cloudfront-sign';

const secretsManager = new SecretsManagerClient({
    maxAttempts: 3 // リトライ回数を制限
});

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

// シークレットのキャッシュ
let secretDataCache: SecretData | null = null;
let privateKeyCache: string | null = null;
let keyPairIdCache: string | null = null;

// シークレットを取得する関数を最適化
async function getSecrets(): Promise<{
    secretData: SecretData;
    privateKey: string;
    keyPairId: string;
}> {
    if (secretDataCache && privateKeyCache && keyPairIdCache) {
        return {
            secretData: secretDataCache,
            privateKey: privateKeyCache,
            keyPairId: keyPairIdCache
        };
    }

    const [secretResponse, privateKeyResponse] = await Promise.all([
        secretsManager.send(new GetSecretValueCommand({
            SecretId: process.env.AUTH_SECRET_NAME
        })),
        secretsManager.send(new GetSecretValueCommand({
            SecretId: process.env.PRIVATE_KEY_SECRET_NAME
        }))
    ]);

    secretDataCache = JSON.parse(secretResponse.SecretString || '{}');
    privateKeyCache = privateKeyResponse.SecretString || '';
    keyPairIdCache = process.env.CLOUDFRONT_KEY_GROUP_ID || null;

    if (!secretDataCache || !privateKeyCache || !keyPairIdCache) {
        throw new Error('Required secrets not found');
    }

    return {
        secretData: secretDataCache,
        privateKey: privateKeyCache,
        keyPairId: keyPairIdCache
    };
}

// パスワードハッシュのメモ化
const hashPasswordMemo = new Map<string, string>();
function hashPassword(password: string): string {
    const cached = hashPasswordMemo.get(password);
    if (cached) return cached;

    const hash = crypto
        .createHash('sha256')
        .update(password)
        .digest('hex');
    
    hashPasswordMemo.set(password, hash);
    return hash;
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

// クッキー検証の最適化
function validateSignedCookie(cookies: Record<string, string>): boolean {
    const requiredCookies = [
        'CloudFront-Policy',
        'CloudFront-Signature',
        'CloudFront-Key-Pair-Id'
    ];

    // 早期リターン
    if (!requiredCookies.every(cookieName => cookies[cookieName])) {
        return false;
    }

    try {
        const decodedPolicy = Buffer.from(cookies['CloudFront-Policy'], 'base64')
            .toString('utf-8')
            .replace(/[\uFFFD\u0000-\u001F\u007F-\u009F]/g, '')
            .trim();

        const policy = JSON.parse(decodedPolicy);
        const expireTime = policy.Statement[0].Condition.DateLessThan['AWS:EpochTime'];
        
        return Date.now() / 1000 < expireTime;
    } catch {
        return false;
    }
}

// レスポンス生成を最適化
const createResponse = (
    statusCode: number,
    body: Record<string, unknown>,
    cookies?: string[]
): APIGatewayProxyResult => ({
    statusCode,
    headers: CORS_HEADERS,
    ...(cookies && { multiValueHeaders: { 'Set-Cookie': cookies } }),
    body: JSON.stringify(body)
});

export const handler = async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
    // OPTIONSリクエストの早期リターン
    if (event.httpMethod === 'OPTIONS') {
        return createResponse(200, {});
    }

    // 認証チェックエンドポイントの処理
    if (event.resource === '/auth/check') {
        const cookies = event.headers?.cookie?.split(';')
            .reduce((acc: Record<string, string>, cookie) => {
                const [key, value] = cookie.trim().split('=');
                acc[key] = value;
                return acc;
            }, {}) || {};

        return createResponse(
            validateSignedCookie(cookies) ? 200 : 401,
            {
                authenticated: validateSignedCookie(cookies),
                message: validateSignedCookie(cookies) ? 'Valid authentication' : 'Not authenticated'
            }
        );
    }

    try {
        if (!event.body) {
            return createResponse(400, { error: 'Request body is missing' });
        }

        const credentials: AuthCredentials = JSON.parse(event.body);
        const { secretData, privateKey, keyPairId } = await getSecrets();

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

            const cookieHeaders = Object.entries(signedCookie).map(
                ([key, value]) =>
                    `${key}=${value}; Path=/; Domain=.hirokit.jp; Secure; HttpOnly`
            );

            return createResponse(
                200,
                { message: 'Authentication successful', expireTime },
                cookieHeaders
            );
        }

        return createResponse(401, { error: 'Invalid credentials' });

    } catch (error) {
        console.error('Error:', error);
        return createResponse(500, { error: 'Internal server error' });
    }
}; 