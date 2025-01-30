import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';

export class ApiGatewayStack extends cdk.Stack {
    public readonly api: apigateway.RestApi;

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // 既存のホストゾーンを参照
        const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
            domainName: 'hirokit.jp'
        });

        // us-east-1リージョンでACM証明書を作成
        const certificate = new acm.Certificate(this, 'ApiCertificate', {
            domainName: 'api.hirokit.jp',
            validation: acm.CertificateValidation.fromDns(hostedZone)
        });

        // API Gatewayの作成
        this.api = new apigateway.RestApi(this, 'SharedApi', {
            restApiName: 'Shared API',
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
                allowHeaders: ['Content-Type'],
            },
            domainName: {
                domainName: 'api.hirokit.jp',
                certificate: certificate,
                endpointType: apigateway.EndpointType.EDGE
            }
        });

        // Route53レコードの作成
        new route53.ARecord(this, 'ApiAliasRecord', {
            zone: hostedZone,
            target: route53.RecordTarget.fromAlias(
                new targets.ApiGateway(this.api)
            ),
            recordName: 'api'
        });

        // 出力としてAPI URLを表示
        new cdk.CfnOutput(this, 'ApiUrl', {
            value: this.api.url,
            description: 'API Gateway endpoint URL'
        });

        new cdk.CfnOutput(this, 'CustomDomainUrl', {
            value: `https://api.hirokit.jp`,
            description: 'Custom domain URL'
        });
    }
} 