# Pulumi Kubernetes Guestbook with Prometheus and Grafana Monitoring

This project extends the Pulumi Kubernetes Guestbook example with a practical monitoring stack using Prometheus and Grafana.

The solution deploys:

- A Kubernetes Guestbook application in the `guestbook` namespace.
- Redis leader and replica services as the Guestbook backend.
- A frontend deployment with a lightweight Prometheus metrics sidecar.
- `kube-prometheus-stack` in the `monitoring` namespace using Pulumi + Helm.
- ServiceMonitor resources for Guestbook frontend metrics and Redis backend metrics.
- Redis exporter for backend Redis metrics.
- A basic Grafana dashboard for frontend, Redis, CPU, and memory metrics.
- Example Prometheus alerting rules for frontend availability and Redis health.

> Note: The original Pulumi Guestbook frontend image does not expose native application `/metrics`. To keep the exercise deployable in 1-2 hours without rebuilding the app image, this implementation adds a Prometheus example metrics sidecar to the frontend pod and uses Kubernetes/cAdvisor metrics for resource usage. In production, I would replace this with application-native metrics using OpenTelemetry or a Prometheus client library.

---

## Repository Structure

```text
.
├── Pulumi.yaml
├── README.md
├── index.ts
├── package.json
└── tsconfig.json
```

---

## Prerequisites

Install and configure:

- Node.js 20+
- Pulumi CLI
- kubectl
- A Kubernetes cluster, such as minikube, kind, AKS, EKS, GKE, or another cluster
- kubeconfig pointing to the target cluster

Verify access:

```bash
kubectl cluster-info
kubectl get nodes
```

---

## Deploy

Install dependencies:

```bash
npm install
```

Create and select a Pulumi stack:

```bash
pulumi stack init dev
```

For minikube or local clusters, keep `isMinikube=true` and expose Grafana through NodePort:

```bash
pulumi config set isMinikube true
pulumi config set grafanaServiceType NodePort
pulumi config set grafanaNodePort 32000
pulumi config set --secret grafanaAdminPassword 'admin123!'
```

For a cloud cluster that supports LoadBalancer services:

```bash
pulumi config set isMinikube false
pulumi config set grafanaServiceType LoadBalancer
pulumi config set --secret grafanaAdminPassword 'admin123!'
```

Preview and deploy:

```bash
pulumi preview
pulumi up
```

---

## Access the Guestbook Application

If running on minikube/local Kubernetes:

```bash
kubectl -n guestbook port-forward svc/frontend 8080:80
```

Open:

```text
http://localhost:8080
```

If running on a cloud cluster with `isMinikube=false`, use the Pulumi output:

```bash
pulumi stack output frontendAccess
```

---

## Access Grafana

Get Pulumi outputs:

```bash
pulumi stack output grafanaAccess
pulumi stack output grafanaAdminUsername
pulumi stack output grafanaAdminPasswordOutput --show-secrets
```

Default credentials used by this project:

```text
Username: admin
Password: admin123!
```

If using NodePort, open:

```text
http://<any-kubernetes-node-ip>:32000
```

If you prefer port-forwarding:

```bash
kubectl -n monitoring port-forward svc/monitoring-grafana 3000:80
```

Then open:

```text
http://localhost:3000
```

---

## Access Prometheus

```bash
kubectl -n monitoring port-forward svc/monitoring-kube-prometheus-prometheus 9090:9090
```

Open:

```text
http://localhost:9090
```

---

## Verify Resources

Check namespaces:

```bash
kubectl get ns guestbook monitoring
```

Check Guestbook pods and services:

```bash
kubectl -n guestbook get pods
kubectl -n guestbook get svc
```

Check Prometheus/Grafana pods:

```bash
kubectl -n monitoring get pods
kubectl -n monitoring get svc
```

Check ServiceMonitor resources:

```bash
kubectl -n guestbook get servicemonitor
```

Expected ServiceMonitors:

```text
guestbook-frontend
guestbook-redis-exporter
```

Check Redis exporter directly:

```bash
kubectl -n guestbook port-forward svc/redis-exporter 9121:9121
curl http://localhost:9121/metrics | grep redis_up
```

Check frontend metrics sidecar directly:

```bash
kubectl -n guestbook port-forward svc/frontend 8081:8080
curl http://localhost:8081/metrics | head
```

---

## Verify Guestbook Metrics in Prometheus

Open Prometheus and run these queries:

```promql
up{namespace="guestbook"}
```

```promql
redis_up{namespace="guestbook"}
```

```promql
sum(rate(http_requests_total{namespace="guestbook"}[5m]))
```

```promql
sum(rate(container_cpu_usage_seconds_total{namespace="guestbook",container!="",image!=""}[5m])) by (pod)
```

```promql
sum(container_memory_working_set_bytes{namespace="guestbook",container!="",image!=""}) by (pod)
```

These confirm that Prometheus is scraping:

- Guestbook frontend metrics sidecar
- Redis backend exporter
- Kubernetes pod CPU and memory metrics for Guestbook workloads

---

## Grafana Dashboard

A dashboard named **Guestbook Application Monitoring** is automatically loaded through a Grafana sidecar ConfigMap.

The dashboard includes:

- Frontend request/scrape metric rate
- Guestbook pod CPU usage
- Guestbook pod memory usage
- Redis backend health

If the dashboard does not appear immediately, wait 1-2 minutes and refresh Grafana.

---

## Cleanup

```bash
pulumi destroy
pulumi stack rm dev
```

---

## Design Notes

### Why kube-prometheus-stack?

`kube-prometheus-stack` gives a quick, production-aligned monitoring stack with Prometheus Operator, Grafana, kube-state-metrics, node-exporter, and Kubernetes scrape configuration. It is appropriate for this exercise because it demonstrates practical SRE monitoring patterns without hand-writing every Prometheus deployment manifest.

### Why ServiceMonitor?

ServiceMonitor resources are used because they express scrape configuration declaratively through Kubernetes resources. That keeps the monitoring configuration version-controlled and managed by Pulumi.

### Why a frontend metrics sidecar?

The stock Guestbook frontend image is a simple demo image and does not expose native Prometheus metrics. The sidecar makes the monitoring path testable without rebuilding the frontend image. In a production implementation, frontend application code would expose request counters, latency histograms, and error counters directly.

### What I would improve next

If this were going to production, I would add:

- Native application metrics in the frontend code.
- Request latency histograms and error-rate metrics.
- SLO-based alerting with burn-rate alerts.
- Persistent storage for Grafana dashboards.
- Ingress with TLS for Grafana.
- RBAC hardening and secret management through external secrets or Vault.
- GitHub Actions to run `npm run typecheck`, `pulumi preview`, and policy checks before deployment.
