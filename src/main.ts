import { App, CfnCondition, CfnParameter, Fn, Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';
//import { SplitAtTargetGroup_LoadBalancerStack, SplitAtTargetGroup_ServiceStack } from './lib/split-at-targetgroup';
import { EcsServiceStack, LoadBalancerDefaultActionStack } from './lib/split-at-targetgroup-v2';

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    // define resources here...
  }
}

/**
 * Shared infrastructure -- VPC and Cluster
 */
class SharedInfraStack extends Stack {
  public readonly vpc: ec2.Vpc;
  public readonly cluster: ecs.Cluster;

  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    const Environment = new CfnParameter(this, 'Environment', {
      description: 'Environment',
      type: 'String',
      default: 'dev',
      allowedValues: ['dev', 'staging', 'qa', 'shared', 'prod'],
    });

    const MaxAZs = new CfnParameter(this, 'MaxAZs', {
      description: 'Max Availability Zones',
      type: 'Number',
      default: 2,
      maxValue: 4,
      minValue: 2,
    });

    const VPCCIDR = new CfnParameter(this, 'VPCCIDR', {
      description: 'CIDR block for the VPC',
      type: 'String',
      default: '10.229.0.0/16',
      constraintDescription: 'CIDR block parameter must be in the form x.x.x.x/16-28',
      allowedPattern: '^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])(\\/(1[6-9]|2[0-8]))$',
    });

    const PublicSubnetCIDRMask = new CfnParameter(this, 'PublicSubnetCIDRMask', {
      description: 'CIDR block for the Public Subnet',
      type: 'Number',
      default: 28,
      constraintDescription: 'CIDR network mask parameter must be in the form x.x.x.x/16-28',
    });

    const PrivateSubnetCIDRMask = new CfnParameter(this, 'PrivateSubnetCIDRMask', {
      description: 'CIDR block for the Private Subnet',
      type: 'Number',
      default: 24,
      constraintDescription: 'CIDR network mask parameter must be in the form x.x.x.x/16-28',
    });

    const DbSubnetCIDRMask = new CfnParameter(this, 'DbSubnetCIDRMask', {
      description: 'CIDR block for the DB Subnet',
      type: 'Number',
      default: 28,
      constraintDescription: 'CIDR network mask parameter must be in the form x.x.x.x/16-28',
    });

    const ECSCluster = new CfnParameter(this, 'ECSCluster', {
      description: 'Create ECS Cluster in VPC',
      type: 'String',
      default: 'false',
      allowedValues: ['true', 'false'],
    });
    const enableCreateECSCluster = new CfnCondition(this, 'EnableCreateECSCluster', {
      expression: Fn.conditionEquals('true', ECSCluster.valueAsString),
    });

    this.templateOptions.metadata = {
      'AWS::CloudFormation::Interface': {
        ParameterGroups: [
          {
            Label: {
              default: 'VPC Configuration',
            },
            Parameters: [
              'Environment',
              'MaxAZs',
              'VPCCIDR',
              'PublicSubnetCIDRMask',
              'PrivateSubnetCIDRMask',
              'DbSubnetCIDRMask',
            ],
          },
          {
            Label: {
              default: '(Optional)ECS Cluster in VPC',
            },
            Parameters: [
              'ECSCluster',
            ],
          },
        ],
      },
    };

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: `${Environment.valueAsString}-vpc`,
      cidr: '10.229.0.0/16' ?? VPCCIDR.valueAsString,
      natGateways: 1,
      maxAzs: 2 ?? MaxAZs.valueAsNumber,
      subnetConfiguration: [
        {
          cidrMask: 28 ?? PublicSubnetCIDRMask.valueAsNumber,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24 ?? PrivateSubnetCIDRMask.valueAsNumber,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
        },
        {
          cidrMask: 28 ?? DbSubnetCIDRMask.valueAsNumber,
          name: 'Db',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    this.cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: `${Environment.valueAsString}-cluster`,
      vpc: this.vpc,
    });

    const CfnCluster = this.cluster.node.defaultChild as ecs.CfnCluster;
    CfnCluster.cfnOptions.condition = enableCreateECSCluster;

  }
  get availabilityZones(): string[] {
    return ['ap-northeast-2a', 'ap-northeast-2c'];
  }
}

// for development, use account/region from cdk cli
/* const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
}; */

const app = new App();

const infra = new SharedInfraStack(app, 'VPCWithECSCLuster');

// Demo that splits at Target Group
/* const splitAtTargetGroupLBStack = new SplitAtTargetGroup_LoadBalancerStack(app, 'SplitAtTargetGroup-LBStack', {
  vpc: infra.vpc,
});
new SplitAtTargetGroup_ServiceStack(app, 'SplitAtTargetGroup-ServiceStack', {
  cluster: infra.cluster,
  vpc: infra.vpc,
  targetGroup: splitAtTargetGroupLBStack.targetGroup,
}); */

const splitAtTargetGroupLBStack = new LoadBalancerDefaultActionStack(app, 'SplitAtTargetGroup-LBStack', {
  vpc: infra.vpc,
});

new EcsServiceStack(app, 'SplitAtTargetGroup-ServiceStack', {
  cluster: infra.cluster,
  vpc: infra.vpc,
  listener: splitAtTargetGroupLBStack.listener,
  targetGroup: splitAtTargetGroupLBStack.targetGroup,
});


// new MyStack(app, 'my-stack-dev', { env: devEnv });
// new MyStack(app, 'my-stack-prod', { env: prodEnv });

app.synth();