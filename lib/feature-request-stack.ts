import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import path = require('path');

export class FeatureRequestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps & { api: apigateway.RestApi }) {
    super(scope, id, props);

    // Lambda関数の作成
    const featureRequestFunction = new nodejs.NodejsFunction(this, 'FeatureRequestFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: path.join(__dirname, '../lambda/dist/bundle/featureRequestHandler.js'),
      handler: 'handler',
      environment: {
        FEATURE_REQUEST_TABLE_NAME: 'prod-feature-requests', // 既存のテーブル名を指定
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      initialPolicy: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'dynamodb:PutItem',
            'dynamodb:GetItem',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem'
          ],
          resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/prod-feature-requests`]
        })
      ]
    });

    // API Gatewayにエンドポイントを追加
    const featureRequests = props?.api.root.addResource('feature-request', {
      defaultCorsPreflightOptions: {
        allowOrigins: ['https://www.hirokit.jp'],
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization'],
        allowCredentials: true,
      }
    });

    if (!featureRequests) {
      throw new Error('Failed to create feature-requests resource');
    }

    featureRequests.addMethod('POST', new apigateway.LambdaIntegration(featureRequestFunction));
  }
} 