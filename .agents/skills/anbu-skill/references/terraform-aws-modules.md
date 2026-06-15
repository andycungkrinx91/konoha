# Terraform AWS Modules

> Read when: creating AWS Terraform modules, provisioning VPC, EKS, ECS, RDS, S3, Lambda, IAM, or CloudWatch resources.

## Module Structure

```text
modules/<resource>/
├── main.tf          # Resources
├── variables.tf     # Inputs with validation
├── outputs.tf       # Output values
├── versions.tf      # Provider version constraints
├── locals.tf        # Computed values
└── data.tf          # Data sources
```

## Provider Setup (versions.tf)

```hcl
terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = { source = "hashicorp/aws"; version = "~> 5.0" }
  }
  backend "s3" {
    bucket         = "my-tf-state"
    key            = "prod/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "tf-lock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.region
  default_tags { tags = local.common_tags }
}
```

## Variables & Locals

```hcl
variable "environment" {
  type = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Must be dev, staging, or prod."
  }
}
variable "region" { type = string; default = "us-east-1" }
variable "project" { type = string }

locals {
  name_prefix = "${var.project}-${var.environment}"
  common_tags = {
    environment = var.environment
    project     = var.project
    managed_by  = "terraform"
  }
}
```

## VPC Module

```hcl
resource "aws_vpc" "this" {
  cidr_block           = var.cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = { Name = "${local.name_prefix}-vpc" }
}

resource "aws_subnet" "private" {
  for_each          = { for i, az in var.azs : az => cidrsubnet(var.cidr, 4, i) }
  vpc_id            = aws_vpc.this.id
  cidr_block        = each.value
  availability_zone = each.key
  tags = { Name = "${local.name_prefix}-private-${each.key}" }
}

output "vpc_id"          { value = aws_vpc.this.id }
output "private_subnets" { value = [for s in aws_subnet.private : s.id] }
```

## EKS Cluster

```hcl
resource "aws_eks_cluster" "main" {
  name     = "${local.name_prefix}-eks"
  role_arn = aws_iam_role.eks.arn
  version  = var.k8s_version

  vpc_config {
    subnet_ids              = var.private_subnets
    endpoint_private_access = true
    endpoint_public_access  = var.environment != "prod"
  }

  encryption_config {
    provider { key_arn = aws_kms_key.eks.arn }
    resources = ["secrets"]
  }

  enabled_cluster_log_types = ["api", "audit", "authenticator"]
}
```

## ECS Service (Fargate)

```hcl
resource "aws_ecs_service" "app" {
  name            = "${local.name_prefix}-app"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.environment == "prod" ? 3 : 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnets
    security_groups = [aws_security_group.app.id]
  }
}
```

## RDS

```hcl
resource "aws_db_instance" "main" {
  identifier              = "${local.name_prefix}-db"
  engine                  = "postgres"
  engine_version          = "16"
  instance_class          = var.environment == "prod" ? "db.r6g.large" : "db.t4g.micro"
  allocated_storage       = 20
  storage_encrypted       = true
  kms_key_id             = aws_kms_key.rds.arn
  db_subnet_group_name    = aws_db_subnet_group.main.name
  vpc_security_group_ids  = [aws_security_group.db.id]
  deletion_protection     = var.environment == "prod"
  backup_retention_period = var.environment == "prod" ? 14 : 1
  multi_az               = var.environment == "prod"
  skip_final_snapshot    = var.environment != "prod"
}
```

## S3 Bucket

```hcl
resource "aws_s3_bucket" "assets" {
  bucket = "${local.name_prefix}-assets"
}
resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id
  rule { apply_server_side_encryption_by_default { sse_algorithm = "aws:kms" } }
}
resource "aws_s3_bucket_public_access_block" "assets" {
  bucket                  = aws_s3_bucket.assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

## IAM (Least Privilege)

```hcl
resource "aws_iam_role" "app" {
  name = "${local.name_prefix}-app"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy" "app" {
  role = aws_iam_role.app.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject"]
      Resource = "${aws_s3_bucket.assets.arn}/*"
    }]
  })
}
```

**Rules:** No `*` in Action unless justified. No `*` in Resource. Use condition keys where possible.

## Secrets Manager

```hcl
resource "aws_secretsmanager_secret" "db" {
  name = "${local.name_prefix}/db-credentials"
  kms_key_id = aws_kms_key.secrets.arn
}
```

## Security Groups

```hcl
resource "aws_security_group" "app" {
  vpc_id = aws_vpc.this.id
  ingress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
```

## Terraform Conventions

- Use `for_each` over `count` for stable identity.
- Pin provider versions. Tag all resources via `default_tags`.
- `terraform fmt` and `terraform validate` before commits.
- `terraform plan -out=tfplan` before every `apply`.
- Never commit `.tfstate`. Use remote state with locking.
- Use `-target` sparingly.

## AWS Module Checklist

- [ ] Provider and Terraform version pinned
- [ ] Remote state with S3 + DynamoDB locking
- [ ] Variables have descriptions and validation
- [ ] All resources tagged via `default_tags`
- [ ] IAM follows least privilege (no wildcards)
- [ ] Encryption enabled (KMS for EBS, S3, RDS, Secrets)
- [ ] Security groups with minimal ingress
- [ ] `deletion_protection` on prod databases
- [ ] Outputs defined for downstream modules
- [ ] `for_each` over `count` where identity matters
