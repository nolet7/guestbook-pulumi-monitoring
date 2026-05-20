# Guestbook Pulumi Monitoring Project

## Assignment

**Objective:** Extend the existing Pulumi Kubernetes Guestbook example by integrating monitoring with Prometheus and Grafana to observe application performance.

This implementation deploys the Guestbook application, Redis backend, Prometheus, Grafana, NGINX Ingress, ServiceMonitors, Prometheus rules, and a basic Grafana dashboard using Pulumi.

---

## Current Public Access

| Component | Access |
|---|---|
| Guestbook Application | `http://139.144.165.250` |
| Grafana | `http://139.144.165.250/grafana` |
| Prometheus | Internal only; query through Grafana Explore |

Prometheus is intentionally **not exposed publicly**. This is a safer production-style design because Prometheus can reveal Kubernetes metadata such as namespaces, pod names, labels, node details, targets, and internal service names.

Evaluator should use:

```text
Grafana → Explore → Prometheus
```

---

## Architecture

```text
Internet
  ↓
Linode LoadBalancer: 139.144.165.250
  ↓
NGINX Ingress Controller
  ├── /         → guestbook/frontend service
  └── /grafana  → monitoring-grafana service

Internal monitoring path:
  Grafana → Prometheus datasource → monitoring-kube-prometheus-prometheus:9090
```

---

## What Was Implemented

| Requirement | Status | Implementation |
|---|---:|---|
| Deploy Prometheus and Grafana | Complete | Pulumi deploys `kube-prometheus-stack` using Helm |
| Monitor Guestbook frontend | Complete | Frontend ServiceMonitor scrapes metrics sidecar |
| Monitor Guestbook backend | Complete | Redis exporter deployed and scraped by ServiceMonitor |
| Expose simple metrics | Complete | `up`, frontend request metrics, Redis exporter metrics, pod/container resource metrics |
| Expose Grafana | Complete | Grafana exposed through NGINX Ingress at `/grafana` |
| Output Grafana access details | Complete | Pulumi outputs include Grafana URL and admin username/password output |
| Basic Grafana dashboard | Complete | Dashboard ConfigMap is deployed and discovered by Grafana sidecar |
| README with deployment and verification | Complete | This README provides deployment, access, and validation steps |

---

## Prerequisites

Install and configure these tools before deployment:

```bash
node --version
npm --version
pulumi version
kubectl version --client
```

You also need a working Kubernetes cluster and a valid kubeconfig.

Verify Kubernetes access:

```bash
kubectl get nodes
```

---

## Deployment Instructions

### 1. Clone the Repository

```bash
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd guestbook-pulumi-monitoring
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Select or Create Pulumi Stack

```bash
pulumi stack select dev || pulumi stack init dev
```

### 4. Verify Kubernetes Context

```bash
kubectl config current-context
kubectl get nodes
```

### 5. Preview the Deployment

```bash
pulumi preview
```

### 6. Deploy the Project

```bash
pulumi up
```

When prompted, type:

```text
yes
```

---

## Pulumi Outputs

After deployment, run:

```bash
pulumi stack output
```

Expected important outputs:

```text
guestbookPublicAccess      http://139.144.165.250
grafanaPublicAccess        http://139.144.165.250/grafana
grafanaAdminUsername       admin
grafanaAdminPasswordOutput [secret]
```

Retrieve the Grafana password:

```bash
pulumi stack output grafanaAdminPasswordOutput --show-secrets
```

---

## Grafana Access

Open:

```text
http://139.144.165.250/grafana
```

Login:

```text
Username: admin
Password: Use the value from:
          pulumi stack output grafanaAdminPasswordOutput --show-secrets
```

---

## Verify Guestbook Application

Open the Guestbook application:

```text
http://139.144.165.250
```

Expected result:

```text
Guestbook web page loads successfully.
```

Verify the public Ingress:

```bash
kubectl get ingress -A
```

Expected public routes:

```text
guestbook    guestbook-ingress      139.144.165.250
monitoring   grafana-ingress        139.144.165.250
```

Prometheus should **not** appear as a public Ingress route.

This should not exist:

```text
monitoring   prometheus-ingress
```

---

## Verify Prometheus Scraping from Grafana

Prometheus is kept internal. To verify metrics, use Grafana Explore.

In Grafana:

```text
Explore → Select Prometheus datasource
```

Run:

```promql
up{namespace="guestbook"}
```

Expected result:

```text
3 frontend targets and 1 redis-exporter target should return value 1.
```

The result should include targets similar to:

```text
job="frontend"
job="redis-exporter"
namespace="guestbook"
value=1
```

---

## Verify Guestbook Frontend Request Metrics

In Grafana Explore, run:

```promql
sum(rate(http_requests_total{namespace="guestbook", job="frontend"}[5m]))
```

Expected result:

```text
A numeric request rate for the Guestbook frontend metrics endpoint.
```

If the value is zero, generate traffic by refreshing:

```text
http://139.144.165.250
```

Then run the query again.

---

## Verify Backend Redis Metrics

In Grafana Explore, run:

```promql
up{namespace="guestbook", job="redis-exporter"}
```

Expected result:

```text
redis-exporter target returns 1.
```

You can also check Redis-specific exported metrics:

```promql
redis_up{namespace="guestbook"}
```

Expected result:

```text
redis_up returns 1.
```

---

## Verify Resource Usage Metrics

In Grafana Explore, run:

```promql
sum(rate(container_cpu_usage_seconds_total{namespace="guestbook", container!="", pod!=""}[5m])) by (pod)
```

Expected result:

```text
CPU usage data for Guestbook pods.
```

Run memory usage query:

```promql
sum(container_memory_working_set_bytes{namespace="guestbook", container!="", pod!=""}) by (pod)
```

Expected result:

```text
Memory usage data for Guestbook pods.
```

---

## Admin-Only Local Prometheus Access

Prometheus is not exposed publicly. For admin troubleshooting only, use port-forwarding:

```bash
kubectl -n monitoring port-forward svc/monitoring-kube-prometheus-prometheus 9090:9090
```

Then open:

```text
http://localhost:9090
```

Run:

```promql
up{namespace="guestbook"}
```

Expected result:

```text
3 frontend targets and 1 redis-exporter target should return value 1.
```

Stop port-forwarding with:

```text
CTRL+C
```

---

## Kubernetes Validation Commands

### Check Pods

```bash
kubectl get pods -A
```

Expected namespaces include:

```text
guestbook
monitoring
ingress-nginx
kube-system
```

Expected Guestbook pods:

```text
frontend
redis-leader
redis-replica
redis-exporter
```

Expected Monitoring pods:

```text
monitoring-grafana
prometheus-monitoring-kube-prometheus-prometheus-0
alertmanager-monitoring-kube-prometheus-alertmanager-0
monitoring-kube-state-metrics
monitoring-prometheus-node-exporter
monitoring-kube-prometheus-operator
```

### Check Services

```bash
kubectl get svc -n guestbook
kubectl get svc -n monitoring
kubectl get svc -n ingress-nginx
```

### Check Ingress

```bash
kubectl get ingress -A
```

Expected:

```text
guestbook    guestbook-ingress
monitoring   grafana-ingress
```

Not expected:

```text
monitoring   prometheus-ingress
```

### Check ServiceMonitors

```bash
kubectl get servicemonitor -A | grep guestbook
```

Expected:

```text
guestbook-frontend
guestbook-redis-exporter
```

### Check Prometheus Rules

```bash
kubectl get prometheusrule -A | grep guestbook
```

Expected:

```text
guestbook-rules
```

### Check Grafana ServiceMonitor Path

Because Grafana is served under `/grafana`, its metrics path must be `/grafana/metrics`.

Run:

```bash
kubectl get servicemonitor monitoring-grafana -n monitoring -o yaml | sed -n '/endpoints:/,/selector:/p'
```

Expected:

```text
path: /grafana/metrics
```

---

## Grafana Dashboard

The project includes a basic Grafana dashboard ConfigMap discovered by the Grafana sidecar.

In Grafana:

```text
Dashboards → Browse
```

Look for:

```text
guestbook-grafana-dashboard
```

The dashboard is intended to show Guestbook-related health and monitoring signals such as:

```text
Frontend target health
Redis exporter health
Request rate
Pod/resource usage
```

---

## Security Notes

Prometheus was initially tested behind Basic Auth, but the final design keeps Prometheus internal only.

Final public exposure:

```text
Guestbook application: Public
Grafana: Public
Prometheus: Internal only
```

This is a better SRE design because evaluators can still run PromQL through Grafana Explore while raw Prometheus remains private.

---

## Cleanup

To destroy the stack:

```bash
pulumi destroy
```

When prompted, type:

```text
yes
```

Then remove the stack if needed:

```bash
pulumi stack rm dev
```

---

## Submission Checklist

| Item | Status |
|---|---:|
| Pulumi code included | Complete |
| Kubernetes Guestbook deployed | Complete |
| Prometheus deployed | Complete |
| Grafana deployed | Complete |
| Prometheus scrapes Guestbook frontend | Complete |
| Prometheus scrapes Redis backend/exporter | Complete |
| Grafana exposed publicly | Complete |
| Grafana credentials available through Pulumi output | Complete |
| Metrics verification steps documented | Complete |
| Basic dashboard included | Complete |
| Prometheus kept internal for security | Complete |

---

## Quick Evaluator Checklist

1. Open Guestbook:

```text
http://139.144.165.250
```

2. Open Grafana:

```text
http://139.144.165.250/grafana
```

3. Retrieve Grafana password:

```bash
pulumi stack output grafanaAdminPasswordOutput --show-secrets
```

4. In Grafana Explore, run:

```promql
up{namespace="guestbook"}
```

5. Confirm:

```text
3 frontend targets and 1 redis-exporter target return value 1.
```

6. Confirm Prometheus is not public:

```bash
kubectl get ingress -A
```

Expected:

```text
No prometheus-ingress exists.
```
