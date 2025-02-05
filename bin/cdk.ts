#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ChatApiStack } from '../lib/chat-api-stack';
import { AuthStack } from '../lib/auth-stack';
import { ApiGatewayStack } from '../lib/api-gateway-stack';
import { FeatureRequestStack } from '../lib/feature-request-stack';

const app = new cdk.App();

// メインリージョンの環境設定
const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'ap-northeast-1'
};

// API Gatewayスタックを作成（ap-northeast-1に変更）
const apiGatewayStack = new ApiGatewayStack(app, 'ApiGatewayStack', { 
    env: env,
    crossRegionReferences: true
});

// Lambda関数を含むスタックもap-northeast-1に作成
new ChatApiStack(app, 'ChatApiStack', { 
    env: env,
    api: apiGatewayStack.api
});

new AuthStack(app, 'AuthStack', { 
    env: env,
    api: apiGatewayStack.api 
});

// Feature Requestスタックを追加
new FeatureRequestStack(app, 'FeatureRequestStack', { 
    env: env,
    api: apiGatewayStack.api 
}); 