#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ChatApiStack } from '../lib/chat-api-stack';
import { AuthStack } from '../lib/auth-stack';
import { ApiGatewayStack } from '../lib/api-gateway-stack';

const app = new cdk.App();

// メインリージョンの環境設定
const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
};

// us-east-1の環境設定
const usEast1Env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1'
};

// API Gatewayスタックを作成（証明書はus-east-1に作成）
const apiGatewayStack = new ApiGatewayStack(app, 'ApiGatewayStack', { 
    env: usEast1Env,
    crossRegionReferences: true
});

// Lambda関数を含むスタックもus-east-1に作成
new ChatApiStack(app, 'ChatApiStack', { 
    env: usEast1Env,
    api: apiGatewayStack.api
});

new AuthStack(app, 'AuthStack', { 
    env: usEast1Env,
    api: apiGatewayStack.api 
}); 