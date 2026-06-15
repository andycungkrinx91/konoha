# Terraform GCP

> Read when: provisioning GCP infrastructure — VPC, GKE, Cloud Run, Cloud SQL, IAM, Secret Manager, Artifact Registry, or storage.

## Provider Setup

```hcl
terraform {
  required_version = ">= 1.5"
  required_providers {
    google      = { source = "hashicorp/google";      version = "~> 5.0" }
    google-beta = { source = "hashicorp/google-beta"; version = "~> 5.0" }
  }
  backend "gcs" { bucket = "my-project-tf-state"; prefix = "terraform/state" }
}

provider "google"      { project = var.project_id; region = var.region }
provider "google-beta" { project = var.project_id; region = var.region }
```

## Variables

```hcl
variable "project_id"  { type = string }
variable "region"      { type = string; default = "us-central1" }
variable "environment" {
  type = string
  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Must be dev, staging, or production."
  }
}
```

## Enable APIs

```hcl
resource "google_project_service" "apis" {
  for_each = toset([
    "compute.googleapis.com", "container.googleapis.com",
    "sqladmin.googleapis.com", "servicenetworking.googleapis.com",
    "run.googleapis.com", "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
  ])
  project = var.project_id
  service = each.value
  disable_on_destroy = false
}
```

## VPC & Subnets

```hcl
resource "google_compute_network" "vpc" {
  name                    = "${var.environment}-vpc"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
}

resource "google_compute_subnetwork" "gke" {
  name                     = "${var.environment}-gke-subnet"
  ip_cidr_range            = var.gke_subnet_cidr
  region                   = var.region
  network                  = google_compute_network.vpc.id
  private_ip_google_access = true
  secondary_ip_range { range_name = "pods";     ip_cidr_range = var.pods_cidr }
  secondary_ip_range { range_name = "services"; ip_cidr_range = var.services_cidr }
}

resource "google_compute_firewall" "allow_iap" {
  name    = "${var.environment}-allow-iap"
  network = google_compute_network.vpc.name
  allow { protocol = "tcp"; ports = ["22", "3389"] }
  source_ranges = ["35.235.240.0/20"]
}

resource "google_compute_router_nat" "nat" {
  name                               = "${var.environment}-nat"
  router                             = google_compute_router.router.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
  log_config { enable = true; filter = "ERRORS_ONLY" }
}
```

## GKE Cluster

```hcl
resource "google_container_cluster" "primary" {
  name     = "${var.environment}-cluster"
  location = var.region

  release_channel { channel = var.release_channel }
  workload_identity_config { workload_pool = "${var.project_id}.svc.id.goog" }
  network    = google_compute_network.vpc.name
  subnetwork = google_compute_subnetwork.gke.name

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }
  private_cluster_config {
    enable_private_nodes   = true
    master_ipv4_cidr_block = "172.16.0.0/28"
  }
  network_policy { enabled = true }
  logging_config    { enable_components = ["SYSTEM_COMPONENTS", "WORKLOADS"] }
  monitoring_config {
    enable_components = ["SYSTEM_COMPONENTS", "WORKLOADS"]
    managed_prometheus { enabled = true }
  }

  remove_default_node_pool = true
  initial_node_count       = 1
}

resource "google_container_node_pool" "primary" {
  name     = "primary-pool"
  cluster  = google_container_cluster.primary.name
  location = var.region

  autoscaling { min_node_count = var.min_nodes; max_node_count = var.max_nodes }
  management  { auto_repair = true; auto_upgrade = true }

  node_config {
    machine_type = var.machine_type
    disk_size_gb = 100
    oauth_scopes = ["https://www.googleapis.com/auth/cloud-platform"]
    shielded_instance_config { enable_secure_boot = true; enable_integrity_monitoring = true }
    metadata = { disable-legacy-endpoints = "true" }
  }
}
```

## Cloud SQL

```hcl
resource "google_sql_database_instance" "main" {
  name             = "${var.environment}-db"
  database_version = "POSTGRES_16"
  region           = var.region

  settings {
    tier              = var.db_tier
    availability_type = var.environment == "production" ? "REGIONAL" : "ZONAL"
    disk_type         = "PD_SSD"
    disk_autoresize   = true
    backup_configuration {
      enabled                        = true
      start_time                     = "02:00"
      point_in_time_recovery_enabled = true
    }
    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.vpc.id
      require_ssl     = true
    }
  }
  deletion_protection = var.environment == "production"
}
```

## IAM & Service Accounts

```hcl
resource "google_service_account" "app" {
  account_id   = "${var.environment}-app"
  display_name = "Application SA"
}

resource "google_project_iam_member" "app" {
  for_each = toset([
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.app.email}"
}

# Workload Identity binding
resource "google_service_account_iam_member" "workload_identity" {
  service_account_id = google_service_account.app.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[myapp/app-ksa]"
}
```

## Secret Manager

```hcl
resource "google_secret_manager_secret" "db_password" {
  secret_id = "${var.environment}-db-password"
  replication { auto {} }
}
```

## Artifact Registry

```hcl
resource "google_artifact_registry_repository" "docker" {
  repository_id = "${var.environment}-docker"
  location      = var.region
  format        = "DOCKER"
}
```

## Cloud Run (Serverless)

```hcl
resource "google_cloud_run_v2_service" "app" {
  name     = "${var.environment}-app"
  location = var.region
  template {
    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${var.environment}-docker/app:latest"
      resources { limits = { memory = "512Mi"; cpu = "1" } }
    }
    service_account = google_service_account.app.email
  }
}
```

## Workflow

```bash
terraform plan -var-file=environments/production.tfvars -out=tfplan
terraform apply tfplan
```

## GCP Module Checklist

- [ ] Provider version pinned (`~> 5.0`)
- [ ] Remote state in GCS with versioning
- [ ] APIs enabled via `google_project_service`
- [ ] Variables with validation
- [ ] GKE: private nodes, Workload Identity, shielded nodes, network policy
- [ ] Cloud SQL: private IP only, SSL required, backups enabled
- [ ] IAM: specific roles (no `roles/owner` or `roles/editor`)
- [ ] Service accounts per workload (not default SA)
- [ ] Workload Identity over service account keys
- [ ] Labels/tags on all resources
- [ ] `deletion_protection` on production databases
- [ ] Cloud NAT for outbound from private subnets
