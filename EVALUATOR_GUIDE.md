# Guestbook Pulumi Monitoring Project - Evaluator Guide

## 1. Public Application Access

**Guestbook application URL**

```text
http://139.144.165.250
```

**Expected result**

```text
Guestbook web page loads successfully.
```

---

## 2. Grafana Access

**Grafana URL**

```text
http://139.144.165.250/grafana
```

**Login**

```text
Username: admin
Password: Provided separately by project owner
```

To retrieve the Grafana password from Pulumi:

```bash
pulumi stack output grafanaAdminPasswordOutput --show-secrets
```

---

## 3. Prometheus Access Design

Prometheus is **not exposed publicly**.

This is intentional. Raw Prometheus can reveal internal Kubernetes metadata such as namespaces, pod names, service names, labels, node details, scrape targets, and operational metrics.

The evaluator should query Prometheus through Grafana instead.

**Grafana query path**

```text
Grafana → Explore → Select Prometheus
```

Run this PromQL query:

```promql
up{namespace="guestbook"}
```

**Expected result**

```text
3 frontend targets and 1 redis-exporter target should return value 1.
```

The result should include:

```text
frontend
redis-exporter
namespace="guestbook"
value="1"
```

---

## 4. Admin-Only Local Prometheus Access

For the project owner or administrator, Prometheus can still be accessed locally using port-forwarding.

Run:

```bash
kubectl -n monitoring port-forward svc/monitoring-kube-prometheus-prometheus 9090:9090
```

Then open:

```text
http://localhost:9090
```

Run this PromQL query in the Prometheus UI:

```promql
up{namespace="guestbook"}
```

**Expected result**

```text
3 frontend targets and 1 redis-exporter target should return value 1.
```

---

## 5. Kubernetes Validation Commands

Check all pods:

```bash
kubectl get pods -A
```

Check public Ingress routes:

```bash
kubectl get ingress -A
```

**Expected public Ingress routes**

```text
guestbook    guestbook-ingress      http://139.144.165.250/
monitoring   grafana-ingress        http://139.144.165.250/grafana
```

Prometheus should **not** appear as a public Ingress route.

This should **not** exist:

```text
monitoring   prometheus-ingress     http://139.144.165.250/prometheus
```

Check Guestbook ServiceMonitors:

```bash
kubectl get servicemonitor -A | grep guestbook
```

**Expected**

```text
guestbook-frontend
guestbook-redis-exporter
```

Check Guestbook Prometheus rules:

```bash
kubectl get prometheusrule -A | grep guestbook
```

**Expected**

```text
guestbook-rules
```

Check Grafana ServiceMonitor path:

```bash
kubectl get servicemonitor monitoring-grafana -n monitoring -o yaml | sed -n '/endpoints:/,/selector:/p'
```

**Expected**

```text
path: /grafana/metrics
```

---

## 6. Pulumi Output Validation

Run:

```bash
pulumi stack output
```

Expected public outputs should include:

```text
guestbookPublicAccess     http://139.144.165.250
grafanaPublicAccess       http://139.144.165.250/grafana
```

Prometheus public outputs should **not** be present.

These should **not** appear anymore:

```text
prometheusProtectedAccess
prometheusProtectedReadyCheck
prometheusGuestbookQueryCheck
```

---

## 7. Project Architecture Summary

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

The application is deployed with Pulumi, exposed through NGINX Ingress, monitored internally with Prometheus, and visualized publicly through Grafana.

---

## 8. Evaluator Testing Checklist

| Test | Command or Action | Expected Result |
|---|---|---|
| Guestbook loads | Open `http://139.144.165.250` | Guestbook page loads |
| Grafana loads | Open `http://139.144.165.250/grafana` | Grafana login page loads |
| Prometheus not public | `kubectl get ingress -A` | No `prometheus-ingress` |
| Prometheus data visible | Grafana → Explore → Prometheus → `up{namespace="guestbook"}` | 4 targets return `1` |
| ServiceMonitor exists | `kubectl get servicemonitor -A | grep guestbook` | Frontend and Redis exporter monitors exist |
| PrometheusRule exists | `kubectl get prometheusrule -A | grep guestbook` | `guestbook-rules` exists |
