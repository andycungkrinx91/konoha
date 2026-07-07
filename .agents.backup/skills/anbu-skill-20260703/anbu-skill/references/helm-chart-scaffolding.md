# Helm Chart Scaffolding

> Read when: creating Helm charts, designing values.yaml, writing K8s templates, or scaffolding chart structure.

## Chart Structure

```bash
helm create my-app  # Scaffold
```

```text
my-app/
├── Chart.yaml           # Metadata, dependencies
├── values.yaml          # Default config
├── charts/              # Dependencies
├── templates/
│   ├── _helpers.tpl     # Template helpers
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   ├── serviceaccount.yaml
│   ├── hpa.yaml
│   ├── configmap.yaml
│   ├── NOTES.txt
│   └── tests/
│       └── test-connection.yaml
└── .helmignore
```

## Chart.yaml

```yaml
apiVersion: v2
name: my-app
description: A Helm chart for My Application
type: application
version: 1.0.0
appVersion: "2.1.0"
maintainers:
  - name: DevOps Team
    email: devops@example.com
dependencies:
  - name: postgresql
    version: "12.0.0"
    repository: "https://charts.bitnami.com/bitnami"
    condition: postgresql.enabled
```

## values.yaml Design

```yaml
image:
  repository: myapp
  tag: "1.0.0"
  pullPolicy: IfNotPresent

replicaCount: 3

service:
  type: ClusterIP
  port: 80
  targetPort: 8080

ingress:
  enabled: false
  className: nginx
  hosts:
    - host: app.example.com
      paths:
        - path: /
          pathType: Prefix

resources:
  requests:
    memory: "256Mi"
    cpu: "250m"
  limits:
    memory: "512Mi"
    cpu: "500m"

autoscaling:
  enabled: false
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80

securityContext:
  runAsNonRoot: true
  runAsUser: 65534
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  capabilities:
    drop: [ALL]

probes:
  liveness:
    path: /health
    initialDelaySeconds: 10
    periodSeconds: 10
  readiness:
    path: /ready
    initialDelaySeconds: 5
    periodSeconds: 5

env: []
configMap: {}
```

## Template Helpers (_helpers.tpl)

```yaml
{{- define "my-app.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "my-app.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "my-app.labels" -}}
helm.sh/chart: {{ include "my-app.chart" . }}
{{ include "my-app.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "my-app.selectorLabels" -}}
app.kubernetes.io/name: {{ include "my-app.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
```

## Deployment Template

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "my-app.fullname" . }}
  labels: {{- include "my-app.labels" . | nindent 4 }}
spec:
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ .Values.replicaCount }}
  {{- end }}
  selector:
    matchLabels: {{- include "my-app.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels: {{- include "my-app.selectorLabels" . | nindent 8 }}
    spec:
      serviceAccountName: {{ include "my-app.fullname" . }}
      securityContext: {{- toYaml .Values.securityContext | nindent 8 }}
      containers:
      - name: {{ .Chart.Name }}
        image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
        imagePullPolicy: {{ .Values.image.pullPolicy }}
        ports: [{ containerPort: {{ .Values.service.targetPort }} }]
        livenessProbe:
          httpGet: { path: {{ .Values.probes.liveness.path }}, port: {{ .Values.service.targetPort }} }
          initialDelaySeconds: {{ .Values.probes.liveness.initialDelaySeconds }}
        readinessProbe:
          httpGet: { path: {{ .Values.probes.readiness.path }}, port: {{ .Values.service.targetPort }} }
          initialDelaySeconds: {{ .Values.probes.readiness.initialDelaySeconds }}
        resources: {{- toYaml .Values.resources | nindent 10 }}
        env: {{- toYaml .Values.env | nindent 10 }}
```

## Common Patterns

### Conditional Resources
```yaml
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
...
{{- end }}
```

### Iterating Over Lists
```yaml
env:
{{- range .Values.env }}
- name: {{ .name }}
  value: {{ .value | quote }}
{{- end }}
```

### Global Values
```yaml
# values.yaml
global:
  imageRegistry: docker.io
  imagePullSecrets:
    - name: regcred
```

## Multi-Environment

```text
my-app/
├── values.yaml          # Defaults
├── values-dev.yaml
├── values-staging.yaml
└── values-prod.yaml
```

```bash
helm install my-app ./my-app -f values-prod.yaml --namespace production
```

## Validation & Testing

```bash
helm lint my-app/
helm template my-app ./my-app --dry-run --debug
helm template my-app ./my-app -f values-prod.yaml
helm install my-app ./my-app --dry-run --debug
helm test my-app
```

## Packaging & Distribution

```bash
helm package my-app/               # Creates my-app-1.0.0.tgz
helm repo index .                   # Create index
helm dependency update && helm dependency build
```

## Production Chart Checklist

- [ ] `securityContext` enforces non-root, read-only FS, drop ALL caps
- [ ] Resource requests and limits set
- [ ] Liveness and readiness probes defined
- [ ] No `:latest` tags
- [ ] Secrets from external store (not hardcoded in values)
- [ ] ConfigMaps for non-sensitive config
- [ ] HPA configured for production
- [ ] PodDisruptionBudget for critical workloads
- [ ] Network policies applied
- [ ] RBAC via ServiceAccount with minimal permissions
- [ ] Helm lint passes
- [ ] Template renders correctly for all environments
- [ ] NOTES.txt provides usage instructions
- [ ] Dependencies pinned in Chart.yaml
