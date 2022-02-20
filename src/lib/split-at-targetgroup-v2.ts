import { CfnCondition, CfnOutput, CfnParameter, Fn, Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface LoadBalancerDefaultActionStackStackProps extends StackProps {
  vpc: ec2.IVpc;
}

export class LoadBalancerDefaultActionStack extends Stack {
  public readonly listener : elbv2.ApplicationListener;
  //public readonly httpTargetGroup: elbv2.ApplicationTargetGroup;
  public readonly targetGroup: elbv2.ApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: LoadBalancerDefaultActionStackStackProps) {
    super(scope, id, props);

    const certiArn = new CfnParameter(this, 'CertificateArn', {
      description: 'use certificate',
      type: 'String',
    });

    const useCertificate = new CfnParameter(this, 'UseCertificate', {
      description: 'use certificate',
      type: 'String',
      default: 'false',
      allowedValues: ['true', 'false'],
    });
    const useCertiCondition = new CfnCondition(this, 'UseCertificateCondition', {
      expression: Fn.conditionEquals('true', useCertificate.valueAsString),
    });


    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'PublicALB', {
      vpc: props.vpc,
      internetFacing: true,
    });

    const cfnLB = loadBalancer.node.defaultChild as elbv2.CfnLoadBalancer;
    cfnLB.cfnOptions.condition = useCertiCondition;

    // loadbalancer add httplistener default action
    /*  this.listener = loadBalancer.addListener('Listener80', {
      port: 80,
      //defaultTargetGroups: [this.targetGroup],
      defaultAction: elbv2.ListenerAction.fixedResponse(404,
        { contentType: 'application/json', messageBody: '404 Not Found' }),
    });
    this.httpTargetGroup = new elbv2.ApplicationTargetGroup(this, 'HttpTargetGroup', {
      vpc: props.vpc,
      targetGroupName: 'HttpTargetGroup',
      port: 80,
    });

    */

    loadBalancer.addRedirect({
      sourceProtocol: elbv2.ApplicationProtocol.HTTP,
      sourcePort: 80,
      targetProtocol: elbv2.ApplicationProtocol.HTTPS,
      targetPort: 443,
    });

    const listenerCertificate = elbv2.ListenerCertificate.fromArn(certiArn.valueAsString);

    this.targetGroup = new elbv2.ApplicationTargetGroup(this, 'HttpsTargetGroup', {
      vpc: props.vpc,
      targetGroupName: 'HttpsTargetGroup',
      //port: 443,
      port: 80,
      targetType: elbv2.TargetType.IP,
    });

    this.listener = loadBalancer.addListener('HTTPSListener',
      {
        port: 443,
        defaultTargetGroups: [this.targetGroup],
        certificates: [listenerCertificate],
      },
    );

    // ToDo: httpListner defaultaction redirect to httpsListener


    new CfnOutput(this, 'LoadBalancerDNS', { value: loadBalancer.loadBalancerDnsName, exportName: 'PUBLoadBalancerDNSName' });
    //new CfnOutput(this, 'TargetGroup', { value: this.targetGroup.targetGroupName, exportName: 'TargetGroup80Name' });

  }
}

export interface EcsServiceStackProps extends StackProps {
  vpc: ec2.IVpc;
  cluster: ecs.ICluster;
  listener: elbv2.ApplicationListener;
  targetGroup: elbv2.IApplicationTargetGroup;
}

export class EcsServiceStack extends Stack {
  constructor(scope: Construct, id: string, props: EcsServiceStackProps) {
    super(scope, id, props);

    const serviceName = new CfnParameter(this, 'ServiceName', {
      type: 'String',
      description: 'This will set the Container, Task Definition, and Service name in Fargate',
      default: 'amazon-ecs-sample',
    });

    const ECRRepoName = new CfnParameter(this, 'ECRRepoName', {
      type: 'String',
      description: 'Name of Amazon Elastic Container Registry',
    });

    const healthCheckPath = new CfnParameter(this, 'HealthCheckPath', {
      type: 'String',
      description: 'Health Check Path for ECS Container',
      default: '/',
    });
    const healthCheckPort = new CfnParameter(this, 'HealthCheckPort', {
      type: 'Number',
      description: 'Health Check Path for ECS Container',
      default: 80,
    });

    const containerPort = new CfnParameter(this, 'ContainerPort', {
      type: 'Number',
      description: 'port number exposed from the container image',
      default: 80,
    });

    const priority = new CfnParameter(this, 'Priority', {
      type: 'Number',
      description: 'Priority of Listener Rule',
      default: 100,
    });

    /* const targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup80', {
      vpc: props.vpc,
      port: 80,
    }); */

    // ToDo: Add New TargetGroup to 443 Listener
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      targetGroupName: `${serviceName.valueAsString}-ecs-target-group`,
      vpc: props.vpc,
      port: 80,
      healthCheck: { path: healthCheckPath.valueAsString, port: healthCheckPort.valueAsString },
    });

    const taskExecutionRole = new iam.Role(this, 'ecs-task-execution-role', {
      roleName: `${serviceName.valueAsString}-ecs-task-execution-role`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    const executionRolePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ['*'],
      actions: [
        'ecr:GetAuthorizationToken',
        'ecr:BatchCheckLayerAvailability',
        'ecr:GetDownloadUrlForLayer',
        'ecr:BatchGetImage',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
    });

    taskExecutionRole.addToPolicy(executionRolePolicy);

    // Standard ECS service setup
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      executionRole: taskExecutionRole,
    });
    const container = taskDefinition.addContainer('app', {
      containerName: `${serviceName.valueAsString}`,
      image: ecs.ContainerImage.fromEcrRepository(ecr.Repository.fromRepositoryName(this, 'ECRRepo', `${ECRRepoName.valueAsString}`), 'latest'),
      memoryLimitMiB: 256,
    });

    container.addPortMappings({
      containerPort: containerPort.valueAsNumber,
      protocol: ecs.Protocol.TCP,
    });

    const service = new ecs.FargateService(this, 'FargateService', {
      serviceName: serviceName.valueAsString,
      cluster: props.cluster,
      //securityGroups: [],
      //desiredCount: 1,
      taskDefinition,
    });

    //service.attachToApplicationTargetGroup(targetGroup);


    new elbv2.ApplicationListenerRule(this, 'MyApplicationListenerRule', {
      listener: props.listener,
      priority: priority.valueAsNumber,
      // the properties below are optional
      conditions: [elbv2.ListenerCondition.hostHeaders(['hello.skcnctf.tk'])],
      //targetGroups: [props.targetGroup],
      targetGroups: [targetGroup],
    });


    //listenerRule.addCondition(elbv2.ListenerCondition.hostHeaders(['hello.skcnctf.tk']));

    //props.targetGroup.addTarget(service);
    targetGroup.addTarget(service);

  }
}