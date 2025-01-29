#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ChatApiStack } from '../lib/chat-api-stack';
import { AuthStack } from '../lib/auth-stack';
import { ApiGatewayStack } from '../lib/api-gateway-stack';

const app = new cdk.App();

const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
};

// API Gatewayスタックを作成
const apiGatewayStack = new ApiGatewayStack(app, 'ApiGatewayStack', { env });

// ChatApiStackにAPIを渡す
new ChatApiStack(app, 'ChatApiStack', { 
    env,
    api: apiGatewayStack.api 
});

// AuthStackにAPIを渡す
new AuthStack(app, 'AuthStack', { 
    env,
    api: apiGatewayStack.api 
}); 