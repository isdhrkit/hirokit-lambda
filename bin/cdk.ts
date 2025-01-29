#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ChatApiStack } from '../lib/chat-api-stack';

const app = new cdk.App();
new ChatApiStack(app, 'ChatApiStack', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION
    },
}); 