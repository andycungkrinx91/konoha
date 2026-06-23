# Terraform Azure

> Read when: provisioning Azure infrastructure with Terraform — resource groups, VNets, AKS, Key Vault, App Service, SQL, storage, or managed identities.

## Provider Setup

```hcl
terraform {
  required_version = ">= 1.5.0"
  required_providers {
    azurerm = { source = "hashicorp/azurerm"; version = "~> 3.80" }
    azuread = { source = "hashicorp/azuread"; version = "~> 2.47" }
  }
  backend "azurerm" {
    resource_group_name  = "tfstate-rg"
    storage_account_name = "tfstate12345abc"
    container_name       = "tfstate"
    key                  = "prod.terraform.tfstate"
  }
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy    = false
      recover_soft_deleted_key_vaults = true
    }
    resource_group {
      prevent_deletion_if_contains_resources = true
    }
  }
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
variable "location"     { type = string; default = "eastus" }
variable "project_name" { type = string }

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  common_tags = {
    environment = var.environment
    project     = var.project_name
    managed_by  = "terraform"
  }
}
```

## Resource Group

```hcl
resource "azurerm_resource_group" "main" {
  name     = "${local.name_prefix}-rg"
  location = var.location
  tags     = local.common_tags
}
```

## VNet & Subnets

```hcl
resource "azurerm_virtual_network" "main" {
  name                = "${local.name_prefix}-vnet"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  address_space       = ["10.0.0.0/16"]
  tags                = local.common_tags
}

resource "azurerm_subnet" "aks" {
  name                 = "aks-subnet"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.1.0/22"]
}

resource "azurerm_network_security_group" "app" {
  name                = "${local.name_prefix}-app-nsg"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  security_rule {
    name                       = "AllowHTTPS"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
  tags = local.common_tags
}
```

## AKS Cluster

```hcl
resource "azurerm_kubernetes_cluster" "main" {
  name                = "${local.name_prefix}-aks"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  dns_prefix          = local.name_prefix
  kubernetes_version  = "1.28"

  default_node_pool {
    name                = "system"
    vm_size             = "Standard_D4s_v5"
    enable_auto_scaling = true
    min_count           = 2
    max_count           = 5
    zones               = [1, 2, 3]
    vnet_subnet_id      = azurerm_subnet.aks.id
  }

  identity { type = "SystemAssigned" }

  network_profile {
    network_plugin    = "azure"
    network_policy    = "calico"
    load_balancer_sku = "standard"
  }

  azure_active_directory_role_based_access_control {
    managed            = true
    azure_rbac_enabled = true
  }

  key_vault_secrets_provider {
    secret_rotation_enabled = true
  }

  tags = local.common_tags
}
```

## Key Vault

```hcl
data "azurerm_client_config" "current" {}

resource "azurerm_key_vault" "main" {
  name                       = "${var.project_name}-${var.environment}-kv"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  soft_delete_retention_days = 90
  purge_protection_enabled   = true

  network_acls {
    default_action = "Deny"
    bypass         = "AzureServices"
  }

  tags = local.common_tags
}
```

## SQL Database

```hcl
resource "azurerm_mssql_server" "main" {
  name                         = "${local.name_prefix}-sql"
  resource_group_name          = azurerm_resource_group.main.name
  location                     = azurerm_resource_group.main.location
  version                      = "12.0"
  administrator_login          = "sqladmin"
  administrator_login_password = var.sql_admin_password
  minimum_tls_version          = "1.2"
  tags                         = local.common_tags
}

resource "azurerm_private_endpoint" "sql" {
  name                = "${local.name_prefix}-sql-pe"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  subnet_id           = azurerm_subnet.data.id
  private_service_connection {
    name                           = "sql-connection"
    private_connection_resource_id = azurerm_mssql_server.main.id
    subresource_names              = ["sqlServer"]
    is_manual_connection           = false
  }
}
```

## Module Layout

```text
project/
  modules/
    networking/   # VNet, subnets, NSGs
    aks/          # AKS cluster, node pools
    database/     # SQL Server, private endpoints
  environments/
    dev/          # main.tf, terraform.tfvars, backend.tf
    prod/
```

## Workflow Commands

```bash
terraform init
terraform validate && terraform fmt -recursive
terraform plan -var-file="terraform.prod.tfvars" -out=tfplan
terraform apply tfplan
```

## Azure Module Checklist

- [ ] Provider version pinned (`~> 3.80`)
- [ ] Remote state in Azure Storage with locking
- [ ] Variables with descriptions and validation
- [ ] All resources tagged via `local.common_tags`
- [ ] Key Vault with `purge_protection_enabled = true`
- [ ] NSGs with minimal ingress rules
- [ ] Private endpoints for databases and storage
- [ ] AKS with managed identity (not service principal)
- [ ] AKS with Azure RBAC and network policy
- [ ] `deletion_protection` on databases where possible
- [ ] Managed identities over service principal secrets
- [ ] Separate tfvars per environment
