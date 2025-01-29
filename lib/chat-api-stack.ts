import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import path = require('path');

export class ChatApiStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: cdk.StackProps & { api: apigateway.RestApi }) {
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
            ],
            logRetention: logs.RetentionDays.ONE_MONTH,
        });

        // chatエンドポイントの作成
        const chat = props.api.root.addResource('chat');
        chat.addMethod('POST', new apigateway.LambdaIntegration(chatFunction));
    }
} 