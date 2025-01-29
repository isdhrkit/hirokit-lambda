import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import path = require('path');

export class ChatApiStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // Lambda関数の作成
        const chatFunction = new nodejs.NodejsFunction(this, 'ChatFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            entry: path.join(__dirname, '../lambda/dist/bundle/chatHandler.js'),
            handler: 'handler',
            environment: {
                OPENAI_API_KEY_PARAMETER_NAME: '/chat-api/openai-api-key',
            },
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            initialPolicy: [
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: ['ssm:GetParameter'],
                    resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/chat-api/openai-api-key`]
                })
            ]
        });

        // Google Search用のLambda関数
        const searchFunction = new nodejs.NodejsFunction(this, 'SearchFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            entry: path.join(__dirname, '../lambda/dist/bundle/searchHandler.js'),
            handler: 'handler',
            environment: {
                OPENAI_API_KEY_PARAMETER_NAME: '/chat-api/openai-api-key',
                GOOGLE_API_KEY_PARAMETER_NAME: '/chat-api/google-api-key',
                GOOGLE_SEARCH_ENGINE_ID_PARAMETER_NAME: '/chat-api/google-search-engine-id',
            },
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            initialPolicy: [
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: ['ssm:GetParameter'],
                    resources: [
                        `arn:aws:ssm:${this.region}:${this.account}:parameter/chat-api/openai-api-key`,
                        `arn:aws:ssm:${this.region}:${this.account}:parameter/chat-api/google-api-key`,
                        `arn:aws:ssm:${this.region}:${this.account}:parameter/chat-api/google-search-engine-id`
                    ]
                })
            ]
        });

        // API Gatewayの作成
        const api = new apigateway.RestApi(this, 'ChatApi', {
            restApiName: 'Chat API',
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
                allowHeaders: ['Content-Type'],
            },
        });

        // APIリソースとメソッドの作成
        const chat = api.root.addResource('chat');
        chat.addMethod('POST', new apigateway.LambdaIntegration(chatFunction));

        // Google Search用のエンドポイント追加
        const search = api.root.addResource('search');
        search.addMethod('POST', new apigateway.LambdaIntegration(searchFunction));

        // 出力としてAPI URLを表示
        new cdk.CfnOutput(this, 'ApiUrl', {
            value: api.url,
            description: 'API Gateway endpoint URL',
        });
    }
} 