import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

const config = new pulumi.Config();

const isMinikube = config.getBoolean("isMinikube") ?? true;
const grafanaServiceType = config.get("grafanaServiceType") ?? "NodePort";
const grafanaNodePort = config.getNumber("grafanaNodePort") ?? 32000;
const grafanaAdminUser = "admin";
const grafanaAdminPassword = config.getSecret("grafanaAdminPassword") ?? pulumi.secret("admin123!");
const monitoringChartVersion = config.get("monitoringChartVersion") ?? "85.0.3";

const guestbookNamespaceName = "guestbook";
const monitoringNamespaceName = "monitoring";

const guestbookNs = new k8s.core.v1.Namespace("guestbook-ns", {
    metadata: {
        name: guestbookNamespaceName,
        labels: {
            "app.kubernetes.io/part-of": "guestbook-assignment",
        },
    },
});

const monitoringNs = new k8s.core.v1.Namespace("monitoring-ns", {
    metadata: {
        name: monitoringNamespaceName,
        labels: {
            "app.kubernetes.io/part-of": "guestbook-assignment",
        },
    },
});

const commonLabels = {
    "app.kubernetes.io/part-of": "guestbook",
    "app.kubernetes.io/managed-by": "pulumi",
};

// -----------------------------------------------------------------------------
// Redis leader backend
// -----------------------------------------------------------------------------
const redisLeaderLabels = {
    ...commonLabels,
    app: "redis-leader",
    "app.kubernetes.io/name": "redis-leader",
    "guestbook-role": "backend",
};

const redisLeaderDeployment = new k8s.apps.v1.Deployment("redis-leader", {
    metadata: {
        namespace: guestbookNamespaceName,
        labels: redisLeaderLabels,
    },
    spec: {
        selector: { matchLabels: { app: "redis-leader" } },
        replicas: 1,
        template: {
            metadata: { labels: redisLeaderLabels },
            spec: {
                containers: [{
                    name: "redis-leader",
                    image: "redis:7-alpine",
                    ports: [{ name: "redis", containerPort: 6379 }],
                    resources: {
                        requests: { cpu: "100m", memory: "128Mi" },
                        limits: { cpu: "500m", memory: "256Mi" },
                    },
                }],
            },
        },
    },
}, { dependsOn: [guestbookNs] });

const redisLeaderService = new k8s.core.v1.Service("redis-leader", {
    metadata: {
        name: "redis-leader",
        namespace: guestbookNamespaceName,
        labels: redisLeaderLabels,
    },
    spec: {
        type: "ClusterIP",
        selector: { app: "redis-leader" },
        ports: [{ name: "redis", port: 6379, targetPort: "redis" }],
    },
}, { dependsOn: [redisLeaderDeployment] });

// -----------------------------------------------------------------------------
// Redis replica backend
// -----------------------------------------------------------------------------
const redisReplicaLabels = {
    ...commonLabels,
    app: "redis-replica",
    "app.kubernetes.io/name": "redis-replica",
    "guestbook-role": "backend",
};

const redisReplicaDeployment = new k8s.apps.v1.Deployment("redis-replica", {
    metadata: {
        namespace: guestbookNamespaceName,
        labels: redisReplicaLabels,
    },
    spec: {
        selector: { matchLabels: { app: "redis-replica" } },
        replicas: 2,
        template: {
            metadata: { labels: redisReplicaLabels },
            spec: {
                containers: [{
                    name: "redis-replica",
                    image: "pulumi/guestbook-redis-replica",
                    env: [{ name: "GET_HOSTS_FROM", value: "dns" }],
                    ports: [{ name: "redis", containerPort: 6379 }],
                    resources: {
                        requests: { cpu: "100m", memory: "128Mi" },
                        limits: { cpu: "500m", memory: "256Mi" },
                    },
                }],
            },
        },
    },
}, { dependsOn: [redisLeaderService] });

const redisReplicaService = new k8s.core.v1.Service("redis-replica", {
    metadata: {
        name: "redis-replica",
        namespace: guestbookNamespaceName,
        labels: redisReplicaLabels,
    },
    spec: {
        type: "ClusterIP",
        selector: { app: "redis-replica" },
        ports: [{ name: "redis", port: 6379, targetPort: "redis" }],
    },
}, { dependsOn: [redisReplicaDeployment] });

// -----------------------------------------------------------------------------
// Guestbook frontend
// The stock guestbook frontend image does not expose native Prometheus metrics.
// To keep the assignment lightweight, a Prometheus example sidecar is added to
// the frontend pod and exposed through the frontend Service on port 8080. In a
// production app, this would be replaced with application-native metrics using
// OpenTelemetry or a Prometheus client library.
// -----------------------------------------------------------------------------
const frontendLabels = {
    ...commonLabels,
    app: "frontend",
    "app.kubernetes.io/name": "frontend",
    "guestbook-role": "frontend",
};

const frontendDeployment = new k8s.apps.v1.Deployment("frontend", {
    metadata: {
        namespace: guestbookNamespaceName,
        labels: frontendLabels,
    },
    spec: {
        selector: { matchLabels: { app: "frontend" } },
        replicas: 3,
        template: {
            metadata: {
                labels: frontendLabels,
                annotations: {
                    "prometheus.io/scrape": "true",
                    "prometheus.io/port": "8080",
                    "prometheus.io/path": "/metrics",
                },
            },
            spec: {
                containers: [
                    {
                        name: "frontend",
                        image: "pulumi/guestbook-php-redis",
                        env: [{ name: "GET_HOSTS_FROM", value: "dns" }],
                        ports: [{ name: "http", containerPort: 80 }],
                        resources: {
                            requests: { cpu: "100m", memory: "128Mi" },
                            limits: { cpu: "500m", memory: "256Mi" },
                        },
                    },
                    {
                        name: "frontend-metrics",
                        image: "prom/prometheus-example-app:v0.4.2",
                        ports: [{ name: "metrics", containerPort: 8080 }],
                        resources: {
                            requests: { cpu: "25m", memory: "32Mi" },
                            limits: { cpu: "100m", memory: "64Mi" },
                        },
                    },
                ],
            },
        },
    },
}, { dependsOn: [redisLeaderService, redisReplicaService] });

const frontendService = new k8s.core.v1.Service("frontend", {
    metadata: {
        name: "frontend",
        namespace: guestbookNamespaceName,
        labels: frontendLabels,
        annotations: {
            "prometheus.io/scrape": "true",
            "prometheus.io/port": "8080",
            "prometheus.io/path": "/metrics",
        },
    },
    spec: {
        type: isMinikube ? "ClusterIP" : "LoadBalancer",
        selector: { app: "frontend" },
        ports: [
            { name: "http", port: 80, targetPort: "http" },
            { name: "metrics", port: 8080, targetPort: "metrics" },
        ],
    },
}, { dependsOn: [frontendDeployment] });

// -----------------------------------------------------------------------------
// Prometheus and Grafana using kube-prometheus-stack
// -----------------------------------------------------------------------------
const monitoringStack = new k8s.helm.v3.Release("kube-prometheus-stack", {
    name: "monitoring",
    namespace: monitoringNamespaceName,
    chart: "kube-prometheus-stack",
    version: monitoringChartVersion,
    repositoryOpts: {
        repo: "https://prometheus-community.github.io/helm-charts",
    },
    timeout: 600,
    values: {
        grafana: {
            enabled: true,
            adminUser: grafanaAdminUser,
            adminPassword: grafanaAdminPassword,
            service: grafanaServiceType === "NodePort"
                ? { type: "NodePort", nodePort: grafanaNodePort }
                : { type: "LoadBalancer" },
            sidecar: {
                dashboards: {
                    enabled: true,
                    label: "grafana_dashboard",
                    searchNamespace: "ALL",
                },
            },
        },
        prometheus: {
            prometheusSpec: {
                serviceMonitorSelectorNilUsesHelmValues: false,
                podMonitorSelectorNilUsesHelmValues: false,
                ruleSelectorNilUsesHelmValues: false,
                serviceMonitorNamespaceSelector: {},
                podMonitorNamespaceSelector: {},
                ruleNamespaceSelector: {},
            },
        },
    },
}, { dependsOn: [monitoringNs] });

// -----------------------------------------------------------------------------
// Redis exporter for backend metrics
// -----------------------------------------------------------------------------
const redisExporterLabels = {
    ...commonLabels,
    app: "redis-exporter",
    "app.kubernetes.io/name": "redis-exporter",
    "guestbook-role": "backend-metrics",
};

const redisExporterDeployment = new k8s.apps.v1.Deployment("redis-exporter", {
    metadata: {
        namespace: guestbookNamespaceName,
        labels: redisExporterLabels,
    },
    spec: {
        selector: { matchLabels: { app: "redis-exporter" } },
        replicas: 1,
        template: {
            metadata: { labels: redisExporterLabels },
            spec: {
                containers: [{
                    name: "redis-exporter",
                    image: "oliver006/redis_exporter:v1.67.0",
                    args: [`--redis.addr=redis://redis-leader.${guestbookNamespaceName}.svc.cluster.local:6379`],
                    ports: [{ name: "metrics", containerPort: 9121 }],
                    resources: {
                        requests: { cpu: "25m", memory: "32Mi" },
                        limits: { cpu: "100m", memory: "64Mi" },
                    },
                }],
            },
        },
    },
}, { dependsOn: [redisLeaderService] });

const redisExporterService = new k8s.core.v1.Service("redis-exporter", {
    metadata: {
        name: "redis-exporter",
        namespace: guestbookNamespaceName,
        labels: redisExporterLabels,
    },
    spec: {
        type: "ClusterIP",
        selector: { app: "redis-exporter" },
        ports: [{ name: "metrics", port: 9121, targetPort: "metrics" }],
    },
}, { dependsOn: [redisExporterDeployment] });

// Prometheus Operator CRD: ServiceMonitor for frontend sidecar metrics.
const frontendServiceMonitor = new k8s.apiextensions.CustomResource("frontend-servicemonitor", {
    apiVersion: "monitoring.coreos.com/v1",
    kind: "ServiceMonitor",
    metadata: {
        name: "guestbook-frontend",
        namespace: guestbookNamespaceName,
        labels: {
            release: "monitoring",
            "app.kubernetes.io/part-of": "guestbook",
        },
    },
    spec: {
        selector: { matchLabels: { app: "frontend" } },
        namespaceSelector: { matchNames: [guestbookNamespaceName] },
        endpoints: [{
            port: "metrics",
            path: "/metrics",
            interval: "15s",
        }],
    },
}, { dependsOn: [monitoringStack, frontendService] });

// Prometheus Operator CRD: ServiceMonitor for Redis backend exporter metrics.
const redisExporterServiceMonitor = new k8s.apiextensions.CustomResource("redis-exporter-servicemonitor", {
    apiVersion: "monitoring.coreos.com/v1",
    kind: "ServiceMonitor",
    metadata: {
        name: "guestbook-redis-exporter",
        namespace: guestbookNamespaceName,
        labels: {
            release: "monitoring",
            "app.kubernetes.io/part-of": "guestbook",
        },
    },
    spec: {
        selector: { matchLabels: { app: "redis-exporter" } },
        namespaceSelector: { matchNames: [guestbookNamespaceName] },
        endpoints: [{
            port: "metrics",
            path: "/metrics",
            interval: "15s",
        }],
    },
}, { dependsOn: [monitoringStack, redisExporterService] });

const dashboard = {
    annotations: { list: [] },
    editable: true,
    graphTooltip: 0,
    refresh: "10s",
    schemaVersion: 39,
    style: "dark",
    tags: ["guestbook", "pulumi", "sre"],
    timezone: "browser",
    title: "Guestbook Application Monitoring",
    uid: "guestbook-monitoring",
    version: 1,
    panels: [
        {
            id: 1,
            type: "timeseries",
            title: "Frontend Request Rate",
            datasource: { type: "prometheus", uid: "prometheus" },
            gridPos: { h: 8, w: 12, x: 0, y: 0 },
            targets: [{
                expr: "sum(rate(http_requests_total{namespace=\"guestbook\"}[5m]))",
                legendFormat: "frontend requests/sec",
                refId: "A",
            }],
        },
        {
            id: 2,
            type: "timeseries",
            title: "Guestbook Pod CPU Usage",
            datasource: { type: "prometheus", uid: "prometheus" },
            gridPos: { h: 8, w: 12, x: 12, y: 0 },
            targets: [{
                expr: "sum(rate(container_cpu_usage_seconds_total{namespace=\"guestbook\",container!=\"\",image!=\"\"}[5m])) by (pod)",
                legendFormat: "{{pod}}",
                refId: "A",
            }],
        },
        {
            id: 3,
            type: "timeseries",
            title: "Guestbook Pod Memory Usage",
            datasource: { type: "prometheus", uid: "prometheus" },
            gridPos: { h: 8, w: 12, x: 0, y: 8 },
            targets: [{
                expr: "sum(container_memory_working_set_bytes{namespace=\"guestbook\",container!=\"\",image!=\"\"}) by (pod)",
                legendFormat: "{{pod}}",
                refId: "A",
            }],
        },
        {
            id: 4,
            type: "stat",
            title: "Redis Backend Health",
            datasource: { type: "prometheus", uid: "prometheus" },
            gridPos: { h: 8, w: 12, x: 12, y: 8 },
            targets: [{
                expr: "redis_up{namespace=\"guestbook\"}",
                legendFormat: "redis_up",
                refId: "A",
            }],
        },
    ],
};

const dashboardConfigMap = new k8s.core.v1.ConfigMap("guestbook-grafana-dashboard", {
    metadata: {
        name: "guestbook-grafana-dashboard",
        namespace: monitoringNamespaceName,
        labels: {
            grafana_dashboard: "1",
            "app.kubernetes.io/part-of": "guestbook",
        },
    },
    data: {
        "guestbook-dashboard.json": JSON.stringify(dashboard, null, 2),
    },
}, { dependsOn: [monitoringStack] });

// Optional alerting rules to demonstrate operational ownership and RCA-oriented monitoring.
const guestbookRules = new k8s.apiextensions.CustomResource("guestbook-prometheus-rules", {
    apiVersion: "monitoring.coreos.com/v1",
    kind: "PrometheusRule",
    metadata: {
        name: "guestbook-rules",
        namespace: guestbookNamespaceName,
        labels: {
            release: "monitoring",
            "app.kubernetes.io/part-of": "guestbook",
        },
    },
    spec: {
        groups: [{
            name: "guestbook.rules",
            rules: [
                {
                    alert: "GuestbookFrontendUnavailable",
                    expr: "sum(kube_deployment_status_replicas_available{namespace=\"guestbook\",deployment=\"frontend\"}) < 1",
                    for: "2m",
                    labels: { severity: "critical" },
                    annotations: {
                        summary: "Guestbook frontend has no available replicas",
                        description: "No frontend replicas are available for more than 2 minutes.",
                    },
                },
                {
                    alert: "GuestbookRedisExporterDown",
                    expr: "redis_up{namespace=\"guestbook\"} == 0",
                    for: "2m",
                    labels: { severity: "warning" },
                    annotations: {
                        summary: "Redis exporter reports backend is down",
                        description: "Prometheus can scrape redis-exporter, but Redis is not responding successfully.",
                    },
                },
            ],
        }],
    },
}, { dependsOn: [monitoringStack, frontendServiceMonitor, redisExporterServiceMonitor] });

// Grafana is created by the kube-prometheus-stack Helm release.
// Do not import the Helm-created Service during preview because it does not exist yet.
// Instead, output the expected NodePort or post-deployment lookup command.

export const frontendAccess = isMinikube
    ? "http://localhost:8080  (run: kubectl -n guestbook port-forward svc/frontend 8080:80)"
    : frontendService.status.loadBalancer.ingress[0].apply((ingress) => {
        const host = ingress?.hostname ?? ingress?.ip;
        return host ? `http://${host}` : "pending";
    });

export const grafanaAccess = grafanaServiceType === "NodePort"
    ? pulumi.interpolate`http://<kind-node-ip>:${grafanaNodePort}  (or run: kubectl -n ${monitoringNamespaceName} port-forward svc/monitoring-grafana 3000:80)`
    : `Run after deployment: kubectl -n ${monitoringNamespaceName} get svc monitoring-grafana`;

export const grafanaPortForward = `kubectl -n ${monitoringNamespaceName} port-forward svc/monitoring-grafana 3000:80`;
export const prometheusPortForward = `kubectl -n ${monitoringNamespaceName} port-forward svc/monitoring-kube-prometheus-prometheus 9090:9090`;
export const grafanaAdminUsername = grafanaAdminUser;
export const grafanaAdminPasswordOutput = grafanaAdminPassword;
export const frontendServiceMonitorName = frontendServiceMonitor.metadata.name;
export const redisExporterServiceMonitorName = redisExporterServiceMonitor.metadata.name;
export const dashboardName = dashboardConfigMap.metadata.name;
export const alertRuleName = guestbookRules.metadata.name;
