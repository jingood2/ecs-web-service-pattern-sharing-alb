import { CfnOutput, CfnParameter, Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';

export interface SplitAtTargetGroup_LoadBalancerStackProps extends StackProps {
  vpc: ec2.IVpc;
}

export class SplitAtTargetGroup_LoadBalancerStack extends Stack {
  public readonly targetGroup: elbv2.ApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: SplitAtTargetGroup_LoadBalancerStackProps) {
    super(scope, id, props);

    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'PublicALB', {
      vpc: props.vpc,
      internetFacing: true,
    });

    this.targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup80', {
      vpc: props.vpc,
      port: 80,
    });

    loadBalancer.addListener('Listener80', {
      port: 80,
      defaultTargetGroups: [this.targetGroup],
    });

    new CfnOutput(this, 'LoadBalancerDNS', { value: loadBalancer.loadBalancerDnsName, exportName: 'PUBLoadBalancerDNSName' });
    new CfnOutput(this, 'TargetGroup', { value: this.targetGroup.targetGroupName, exportName: 'TargetGroup80Name' });

  }
}

export interface SplitAtTargetGroup_ServiceStackProps extends StackProps {
  vpc: ec2.IVpc;
  cluster: ecs.ICluster;
  targetGroup: elbv2.IApplicationTargetGroup;
}

export class SplitAtTargetGroup_ServiceStack extends Stack {
  constructor(scope: Construct, id: string, props: SplitAtTargetGroup_ServiceStackProps) {
    super(scope, id, props);

    const serviceName = new CfnParameter(this, 'ServiceName', {
      type: 'String',
      description: 'This will set the Container, Task Definition, and Service name in Fargate',
      default: 'amazon-ecs-sample',
    });

    const containerPort = new CfnParameter(this, 'ContainerPort', {
      type: 'Number',
      description: 'port number exposed from the container image',
      default: 80,
    });

    // Standard ECS service setup
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef');
    const container = taskDefinition.addContainer('app', {
      image: ecs.ContainerImage.fromRegistry('amazon/amazon-ecs-sample'),
      memoryLimitMiB: 256,
    });

    container.addPortMappings({
      containerPort: containerPort.valueAsNumber,
      protocol: ecs.Protocol.TCP,
    });

    const service = new ecs.FargateService(this, 'FargateService', {
      serviceName: serviceName.valueAsString,
      cluster: props.cluster,
      taskDefinition,
    });

    props.targetGroup.addTarget(service);

  }
}