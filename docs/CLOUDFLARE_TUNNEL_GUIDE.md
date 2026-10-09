# Cloudflare Tunnel & Zero Trust Ingress Guide

**Konoha MCP Version:** v2.1.17  
**Module:** `src/tunnel/`  
**Target Service:** `http://127.0.0.1:1404` (Konoha Web UI)  
**CLI Interface:** `konoha tunnel <command>`  
**Web UI Route:** `/remote`

---

## 1. Overview

Cloudflare Tunnel (`cloudflared`) allows you to securely expose the Konoha Web UI (`localhost:1404`) to the public internet without opening inbound firewall ports or configuring router port forwarding.

### Core Security Architecture: Mode A (Zero Trust Edge Authentication)
- **Zero In-App PIN**: Access to the Konoha dashboard is protected at the Cloudflare Edge using **Cloudflare Zero Trust Access** (Google SSO, GitHub, or Email OTP).
- **Zero Inbound Ports**: The `cloudflared` daemon creates an outbound-only encrypted tunnel to Cloudflare's nearest edge data center.
- **Bot & Scanner Defense**: Unauthenticated visitors and crawlers are blocked at the Cloudflare edge before reaching your machine.

---

## 2. Quick Ephemeral Tunnel (Testing)

For quick testing from your mobile phone without a custom domain:

```bash
# Start ephemeral tunnel
konoha tunnel start --provider cloudflare

# Check status and public URL
konoha tunnel status
# Output:
# Public URL: https://konoha-worker-xyz.trycloudflare.com
```

*Or click **Start Cloudflare Tunnel** on `http://localhost:1404/remote`.*

---

## 3. Production Setup: Named Tunnel with Zero Trust Protection

To use a permanent custom domain (e.g. `konoha.yourdomain.com`) protected by Google SSO:

### Step 1: Install cloudflared
```bash
# Linux (Debian/Ubuntu)
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /etc/apt/trusted.gpg.d/cloudflare.gpg >/dev/null
echo 'deb https://pkg.cloudflare.com/cloudflared bullseye main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install cloudflared
```

### Step 2: Create Tunnel in Cloudflare Zero Trust Dashboard
1. Log into [one.dash.cloudflare.com](https://one.dash.cloudflare.com).
2. Go to **Networks -> Tunnels -> Add a Tunnel**.
3. Select **Cloudflare Tunnel** and provide a name (e.g., `konoha-workstation`).
4. Copy the tunnel run token.
5. In **Public Hostname**:
   - **Subdomain**: `konoha`
   - **Domain**: `yourdomain.com`
   - **Service Type**: `HTTP`
   - **URL**: `localhost:1404`

### Step 3: Configure Cloudflare Zero Trust Access Application
1. In Cloudflare Zero Trust, go to **Access -> Applications -> Add an Application**.
2. Choose **Self-hosted**.
3. **Application Name**: `Konoha Web Dashboard`.
4. **Domain**: `konoha.yourdomain.com`.
5. Under **Policies**:
   - **Policy Name**: `Allow My Personal Email`
   - **Action**: `Allow`
   - **Rule Type**: Include -> `Emails` -> Add your email (e.g. `your-email@gmail.com`).
6. Save the application.

---

## 4. Running the Tunnel with Konoha CLI

```bash
# Save your custom domain
konoha tunnel config --domain "konoha.yourdomain.com"

# Start the tunnel daemon
konoha tunnel start

# Inspect live status
konoha tunnel status

# Terminate tunnel when finished
konoha tunnel stop
```

---

## 5. Web UI Remote Management

Navigate to `http://localhost:1404/remote`:
- **Live Status Card**: Shows whether the tunnel is active, current uptime, and process PID.
- **Copy Link**: One-click button to copy the public URL to your clipboard.
- **Direct Launch**: Open the public dashboard in a new browser tab.
- **Toggle Button**: Start or stop the tunnel process with a single click.

---

## 6. Pairing with Telegram Integration

Combine both capabilities for a complete remote workflow:
1. When away from your workstation, send a prompt via Telegram:
   ```text
   /run run tests and fix lints
   ```
2. Once the task finishes, your Telegram bot replies with the completion summary and your secure Cloudflare link:
   ```text
   [KONOHA TASK REPORT]
   Task: Run tests and fix lints
   Status: [SUCCESS]
   Duration: 5.1s
   Remote Dashboard: https://konoha.yourdomain.com
   ```
3. Tapping the link opens your dashboard after authenticating through Google SSO at the edge.
