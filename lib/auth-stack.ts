import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import path = require('path');

export class AuthStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: cdk.StackProps & { api: apigateway.RestApi }) {
        super(scope, id, props);

        // Lambda関数の作成
        const authFunction = new nodejs.NodejsFunction(this, 'AuthFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            entry: path.join(__dirname, '../lambda/dist/bundle/authHandler.js'),
            handler: 'handler',
            environment: {
                CLOUDFRONT_KEY_GROUP_ID: '9929ebc3-c285-4823-b72d-45db48af1a49',
                AUTH_SECRET_NAME: 'cloudfront/hirokit/secret',
                PRIVATE_KEY_SECRET_NAME: 'cloudfront/hirokit/secret/private_key'
            },
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            initialPolicy: [
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: ['secretsmanager:GetSecretValue'],
                    resources: [
                        `arn:aws:secretsmanager:${this.region}:${this.account}:secret:cloudfront/hirokit/secret-*`,
                        `arn:aws:secretsmanager:${this.region}:${this.account}:secret:cloudfront/hirokit/secret/private_key-*`
                    ]
                })
            ],
            logRetention: logs.RetentionDays.ONE_MONTH,
        });

        // 既存のAPI Gatewayにauthエンドポイントを追加
        const auth = props.api.root.addResource('auth', {
            defaultCorsPreflightOptions: {
                allowOrigins: ['https://www.hirokit.jp'],
                allowMethods: ['GET', 'POST', 'OPTIONS'],
                allowHeaders: ['Content-Type', 'Authorization'],
                allowCredentials: true,
                statusCode: 200
            }
        });
        auth.addMethod('POST', new apigateway.LambdaIntegration(authFunction), {
            methodResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': true,
                        'method.response.header.Access-Control-Allow-Headers': true,
                        'method.response.header.Access-Control-Allow-Methods': true,
                        'method.response.header.Access-Control-Allow-Credentials': true,
                        'method.response.header.Set-Cookie': true
                    }
                }
            ]
        });

        // 認証チェック用のエンドポイントを追加
        const check = auth.addResource('check');
        check.addMethod('GET', new apigateway.LambdaIntegration(authFunction), {
            methodResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': true,
                        'method.response.header.Access-Control-Allow-Headers': true,
                        'method.response.header.Access-Control-Allow-Methods': true,
                        'method.response.header.Access-Control-Allow-Credentials': true,
                        
                    }
                }
            ]
        });
    }
} 