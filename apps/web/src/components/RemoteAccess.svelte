<script>
  import { onMount } from "svelte";
  import { api } from "#lib/api.js";
  import { sweetAlert } from "#lib/sweetAlert.svelte.js";
  import { uiState } from "#lib/state/uiState.svelte.js";
  import { useScrollLock } from "#lib/scrollLock.svelte.js";

  // Telegram State
  let tgConfig = $state({
    enabled: 0,
    mode: "one_way",
    transport: "polling",
    bot_token: "",
    chat_id: "",
    last_notified_at: null,
    has_token: false,
    poller_running: false
  });
  let tgTokenInput = $state("");
  let tgChatIdInput = $state("");
  let tgModeInput = $state("one_way");
  let showToken = $state(false);
  let tgSaving = $state(false);
  let tgTesting = $state(false);

  // Tunnel State
  let tunnelStatus = $state({
    enabled: 0,
    provider: "cloudflare",
    mode: "ephemeral",
    public_url: "",
    active_pid: 0,
    custom_domain: "",
    token: ""
  });
  let tunnelTokenInput = $state("");
  let showTunnelToken = $state(false);
  let tunnelCustomDomain = $state("");
  let tunnelProvider = $state("cloudflare");
  let tunnelLoading = $state(false);
  let tunnelSaving = $state(false);

  // Queue State
  let prompts = $state([]);
  let newPromptText = $state("");
  let submittingPrompt = $state(false);

  let copiedUrl = $state(false);
  let showGuideModal = $state(false);

  useScrollLock(() => showGuideModal);

  async function loadData() {
    try {
      const [tgRes, tunRes, qRes] = await Promise.all([
        api.get("/api/v1/telegram/config"),
        api.get("/api/v1/tunnel/status"),
        api.get("/api/v1/queue/prompts?limit=15")
      ]);

      if (tgRes && tgRes.ok) {
        tgConfig = tgRes;
        if (!tgTokenInput || tgTokenInput === tgRes.bot_token) {
          tgTokenInput = tgRes.bot_token || "";
        }
        if (!tgChatIdInput || tgChatIdInput === tgRes.chat_id) {
          tgChatIdInput = tgRes.chat_id || "";
        }
        tgModeInput = tgRes.mode || "one_way";
      }

      if (tunRes && tunRes.ok) {
        tunnelStatus = tunRes;
        if (!tunnelCustomDomain || tunnelCustomDomain === tunRes.custom_domain) {
          tunnelCustomDomain = tunRes.custom_domain || "";
        }
        if (!tunnelTokenInput || tunnelTokenInput === tunRes.token) {
          tunnelTokenInput = tunRes.token || "";
        }
        tunnelProvider = tunRes.provider || "cloudflare";
      }

      if (qRes && qRes.ok) {
        prompts = qRes.prompts || [];
      }
    } catch (err) {
      uiState.addNotification(`Failed to load remote access data: ${err.message}`, "error");
    }
  }

  onMount(() => {
    loadData();
    const interval = setInterval(loadData, 8000);
    return () => clearInterval(interval);
  });

  async function saveTelegramSettings() {
    tgSaving = true;
    try {
      const payload = {
        mode: tgModeInput,
        chat_id: tgChatIdInput.trim()
      };
      if (tgTokenInput && !tgTokenInput.includes("...")) {
        payload.bot_token = tgTokenInput.trim();
      }
      const res = await api.post("/api/v1/telegram/config", payload);
      if (res && res.ok) {
        await sweetAlert.fire({
          title: "Telegram Settings Saved",
          text: "Telegram bot configuration persisted to SQLite.",
          icon: "success"
        });
        await loadData();
      }
    } catch (err) {
      await sweetAlert.fire({
        title: "Save Failed",
        text: err.message,
        icon: "error"
      });
    } finally {
      tgSaving = false;
    }
  }

  async function toggleTelegramEnabled() {
    try {
      const endpoint = tgConfig.enabled ? "/api/v1/telegram/disable" : "/api/v1/telegram/enable";
      await api.post(endpoint, {});
      await sweetAlert.fire({
        title: tgConfig.enabled ? "Integration Disabled" : "Integration Enabled",
        text: tgConfig.enabled ? "Telegram task reports and poller turned off." : "Telegram notifications active.",
        icon: "success"
      });
      await loadData();
    } catch (err) {
      await sweetAlert.fire({
        title: "Toggle Action Failed",
        text: err.message,
        icon: "error"
      });
    }
  }

  async function sendTelegramTest() {
    tgTesting = true;
    try {
      const payload = {
        chat_id: tgChatIdInput.trim() || null,
        bot_token: (tgTokenInput && !tgTokenInput.includes("...")) ? tgTokenInput.trim() : null
      };
      const res = await api.post("/api/v1/telegram/test", payload);
      if (res && res.ok) {
        await sweetAlert.fire({
          title: "Ping Delivered!",
          text: "Verification test ping successfully delivered to your Telegram chat. Check your Telegram app!",
          icon: "success"
        });
      } else {
        await sweetAlert.fire({
          title: "Telegram Test Ping Failed",
          text: res?.error || "Could not deliver message to Telegram. Check bot token and chat ID.",
          icon: "error"
        });
      }
    } catch (err) {
      await sweetAlert.fire({
        title: "Test Request Failed",
        text: err.message,
        icon: "error"
      });
    } finally {
      tgTesting = false;
    }
  }

  async function saveTunnelSettings() {
    tunnelSaving = true;
    try {
      const payload = {
        provider: tunnelProvider,
        token: tunnelTokenInput.trim(),
        custom_domain: tunnelCustomDomain.trim()
      };
      const res = await api.post("/api/v1/tunnel/config", payload);
      if (res && res.ok) {
        await sweetAlert.fire({
          title: "Tunnel Configuration Saved",
          text: "Cloudflare Tunnel Token and domain settings saved to SQLite.",
          icon: "success"
        });
        await loadData();
      }
    } catch (err) {
      await sweetAlert.fire({
        title: "Save Failed",
        text: err.message,
        icon: "error"
      });
    } finally {
      tunnelSaving = false;
    }
  }

  async function toggleTunnel() {
    tunnelLoading = true;
    try {
      if (tunnelStatus.enabled) {
        await api.post("/api/v1/tunnel/stop", {});
        await sweetAlert.fire({
          title: "Tunnel Stopped",
          text: "Cloudflare ingress tunnel supervisor process stopped.",
          icon: "success"
        });
      } else {
        const payload = {
          provider: tunnelProvider,
          token: tunnelTokenInput.trim() || undefined,
          domain: tunnelCustomDomain.trim() || undefined
        };
        const res = await api.post("/api/v1/tunnel/start", payload);
        await sweetAlert.fire({
          title: "Tunnel Initialized",
          text: res?.status?.public_url
            ? `Ingress established: ${res.status.public_url}`
            : "Cloudflare tunnel process spawned via token in background.",
          icon: "success"
        });
      }
      await loadData();
    } catch (err) {
      await sweetAlert.fire({
        title: "Tunnel Action Failed",
        text: err.message,
        icon: "error"
      });
    } finally {
      tunnelLoading = false;
    }
  }

  function copyPublicUrl() {
    if (!tunnelStatus.public_url) return;
    navigator.clipboard.writeText(tunnelStatus.public_url);
    copiedUrl = true;
    uiState.addNotification("Public URL copied to clipboard", "success");
    setTimeout(() => { copiedUrl = false; }, 3000);
  }

  async function submitQueuePrompt() {
    if (!newPromptText.trim() || submittingPrompt) return;
    submittingPrompt = true;
    try {
      const res = await api.post("/api/v1/queue/prompts", {
        prompt: newPromptText.trim(),
        source: "web"
      });
      if (res && res.ok) {
        newPromptText = "";
        await sweetAlert.fire({
          title: "Prompt Queued",
          text: `Task #${res.prompt?.id || ""} dispatched to task queue!`,
          icon: "success"
        });
        await loadData();
      }
    } catch (err) {
      await sweetAlert.fire({
        title: "Queue Failed",
        text: err.message,
        icon: "error"
      });
    } finally {
      submittingPrompt = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && showGuideModal) showGuideModal = false; }} />

<div class="space-y-8 max-w-7xl mx-auto">
  <!-- Hero Section with Light Glass Gradient & High Contrast Typography -->
  <div
    class="glass-card-3d relative overflow-hidden rounded-[5px] p-8 border transition-all duration-300"
    style="background: linear-gradient(135deg, rgba(255, 255, 255, 0.96) 0%, rgba(255, 255, 255, 0.85) 100%), var(--color-primary-glow); border-color: var(--color-border); box-shadow: var(--shadow-3d);"
  >
    <div class="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
      <div class="space-y-2">
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-[5px] text-xs font-bold border" style="background-color: var(--color-primary-glow); color: var(--color-primary); border-color: var(--color-primary);">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Remote Ingress &amp; Integrations
        </div>
        <h2 class="text-2xl lg:text-3xl font-black tracking-tight" style="color: var(--color-text);">
          Remote Access Control
        </h2>
        <p class="text-sm font-semibold max-w-2xl leading-relaxed" style="color: var(--color-text-muted);">
          Cloudflare Zero Trust named tunnels (<span class="font-mono text-xs font-bold">cloudflared tunnel run --token</span>), Telegram task report alerts, and inbound queue prompting.
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-3 shrink-0">
        <button
          type="button"
          onclick={() => { showGuideModal = true; }}
          class="btn-3d inline-flex items-center gap-2 px-4 py-2.5 rounded-[5px] font-bold text-xs border transition-all cursor-pointer"
          style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
        >
          <svg class="w-4 h-4 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Setup Guide</span>
        </button>

        <button
          type="button"
          onclick={loadData}
          class="btn-3d inline-flex items-center gap-2 px-4 py-2.5 rounded-[5px] font-bold text-xs text-white transition-all cursor-pointer"
          style="background-color: var(--color-primary);"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>Refresh Telemetry</span>
        </button>
      </div>
    </div>
  </div>

  <!-- Primary Dual-Card Grid -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

    <!-- Card 1: Telegram Bot Integration -->
    <div
      class="glass-card-3d rounded-[5px] p-6 space-y-5 border"
      style="background: var(--glass-card); border-color: var(--color-border); box-shadow: var(--shadow-3d);"
    >
      <div class="flex items-center justify-between pb-3 border-b" style="border-color: var(--color-border);">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-[5px] flex items-center justify-center font-bold text-xs text-white shadow-sm" style="background: linear-gradient(135deg, #0284c7, #06b6d4);">
            TG
          </div>
          <div>
            <h3 class="text-base font-bold" style="color: var(--color-text);">Telegram Bot</h3>
            <p class="text-xs font-medium" style="color: var(--color-text-muted);">Task summary alerts &amp; remote prompting</p>
          </div>
        </div>
        <span class={`px-2.5 py-1 text-xs font-bold rounded-[5px] border ${
          tgConfig.enabled
            ? "bg-emerald-50 text-emerald-700 border-emerald-300"
            : "bg-slate-100 text-slate-600 border-slate-300"
        }`}>
          {tgConfig.enabled ? (tgConfig.mode === "two_way" ? "Active (Two-Way)" : "Active (One-Way)") : "Disabled"}
        </span>
      </div>

      <!-- Mode Selector -->
      <div class="space-y-1.5">
        <span class="text-xs font-bold uppercase tracking-wider block" style="color: var(--color-text-muted);">Operating Mode</span>
        <div class="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onclick={() => { tgModeInput = "one_way"; }}
            class="px-3.5 py-2.5 text-xs font-bold rounded-[5px] border text-left transition-all cursor-pointer"
            style={tgModeInput === "one_way"
              ? "border-color: var(--color-primary); background: var(--color-primary-glow); color: var(--color-primary);"
              : "border-color: var(--color-border); background: var(--color-surface); color: var(--color-text-muted);"}
          >
            <div>One-Way</div>
            <div class="text-[11px] font-normal opacity-80">Outbound task reports only. Zero listener ports.</div>
          </button>
          <button
            type="button"
            onclick={() => { tgModeInput = "two_way"; }}
            class="px-3.5 py-2.5 text-xs font-bold rounded-[5px] border text-left transition-all cursor-pointer"
            style={tgModeInput === "two_way"
              ? "border-color: var(--color-primary); background: var(--color-primary-glow); color: var(--color-primary);"
              : "border-color: var(--color-border); background: var(--color-surface); color: var(--color-text-muted);"}
          >
            <div>Two-Way</div>
            <div class="text-[11px] font-normal opacity-80">Alerts + inbound prompt execution via /run.</div>
          </button>
        </div>
      </div>

      <!-- Credentials Form -->
      <div class="space-y-4 pt-1">
        <div>
          <label for="tg-bot-token" class="text-xs font-bold block mb-1" style="color: var(--color-text);">
            Bot Token (from @BotFather)
          </label>
          <div class="relative">
            <input
              id="tg-bot-token"
              type={showToken ? "text" : "password"}
              bind:value={tgTokenInput}
              placeholder="e.g. 123456789:AAExampleBotTokenPlaceholder"
              class="w-full px-3 py-2 text-xs font-mono rounded-[5px] border pr-16 focus:outline-hidden transition-colors"
              style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
            />
            <button
              type="button"
              onclick={() => { showToken = !showToken; }}
              class="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-bold px-2 py-0.5 rounded-[5px] border cursor-pointer transition-colors"
              style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-muted);"
            >
              {showToken ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        <div>
          <label for="tg-chat-id" class="text-xs font-bold block mb-1" style="color: var(--color-text);">
            Authorized Chat ID
          </label>
          <input
            id="tg-chat-id"
            type="text"
            bind:value={tgChatIdInput}
            placeholder="e.g. 123456789"
            class="w-full px-3 py-2 text-xs font-mono rounded-[5px] border focus:outline-hidden transition-colors"
            style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
          />
          <p class="text-[11px] font-medium mt-1" style="color: var(--color-text-muted);">
            Message <span class="font-mono font-bold" style="color: var(--color-primary);">@userinfobot</span> on Telegram to get your numeric user ID.
          </p>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex flex-wrap items-center justify-between gap-2.5 pt-3 border-t" style="border-color: var(--color-border);">
        <div class="flex items-center gap-2">
          <button
            type="button"
            onclick={toggleTelegramEnabled}
            class={`btn-3d px-3.5 py-2 text-xs font-bold rounded-[5px] border cursor-pointer ${
              tgConfig.enabled
                ? "border-amber-300 bg-amber-50 text-amber-700"
                : "border-emerald-300 bg-emerald-50 text-emerald-700"
            }`}
          >
            {tgConfig.enabled ? "Disable Integration" : "Enable Integration"}
          </button>
          <button
            type="button"
            onclick={sendTelegramTest}
            disabled={tgTesting || (!tgConfig.bot_token && !tgTokenInput)}
            class="btn-3d px-3.5 py-2 text-xs font-bold rounded-[5px] border transition-colors disabled:opacity-50 cursor-pointer"
            style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
          >
            {tgTesting ? "Sending Ping..." : "Send Test Ping"}
          </button>
        </div>
        <button
          type="button"
          onclick={saveTelegramSettings}
          disabled={tgSaving}
          class="btn-3d px-4 py-2 text-xs font-bold rounded-[5px] text-white transition-colors disabled:opacity-50 cursor-pointer"
          style="background-color: var(--color-primary);"
        >
          {tgSaving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>

    <!-- Card 2: Public Tunnel & Cloudflare Ingress -->
    <div
      class="glass-card-3d rounded-[5px] p-6 space-y-5 border"
      style="background: var(--glass-card); border-color: var(--color-border); box-shadow: var(--shadow-3d);"
    >
      <div class="flex items-center justify-between pb-3 border-b" style="border-color: var(--color-border);">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-[5px] flex items-center justify-center font-bold text-xs text-white shadow-sm" style="background: linear-gradient(135deg, #f97316, #ea580c);">
            CF
          </div>
          <div>
            <h3 class="text-base font-bold" style="color: var(--color-text);">Public Ingress Tunnel</h3>
            <p class="text-xs font-medium" style="color: var(--color-text-muted);">Cloudflare Zero Trust edge protection</p>
          </div>
        </div>
        <span class={`px-2.5 py-1 text-xs font-bold rounded-[5px] border ${
          tunnelStatus.enabled
            ? "bg-emerald-50 text-emerald-700 border-emerald-300"
            : "bg-slate-100 text-slate-600 border-slate-300"
        }`}>
          {tunnelStatus.enabled ? "Connected" : "Inactive"}
        </span>
      </div>

      <!-- Tunnel Information Badge -->
      <div class="p-3.5 rounded-[5px] border space-y-2" style="background: rgba(255, 255, 255, 0.6); border-color: var(--color-border);">
        <div class="flex items-center justify-between text-xs">
          <span style="color: var(--color-text-muted);">Target Service:</span>
          <span class="font-mono font-bold" style="color: var(--color-text);">http://127.0.0.1:1404</span>
        </div>
        <div class="flex items-center justify-between text-xs">
          <span style="color: var(--color-text-muted);">Mode:</span>
          <span class="font-bold text-emerald-700">Zero Trust Named Tunnel (Token Run)</span>
        </div>
        <div class="flex items-center justify-between text-xs">
          <span style="color: var(--color-text-muted);">Command:</span>
          <span class="font-mono text-[11px]" style="color: var(--color-text);">cloudflared tunnel run --token ...</span>
        </div>
      </div>

      <!-- Active Public URL Banner -->
      {#if tunnelStatus.enabled && tunnelStatus.public_url}
        <div class="p-3.5 rounded-[5px] border space-y-2" style="background: var(--color-primary-glow); border-color: var(--color-primary);">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold" style="color: var(--color-primary);">Live Ingress Status</span>
            <span class="text-[11px] font-mono" style="color: var(--color-text-muted);">PID: {tunnelStatus.active_pid}</span>
          </div>
          <div class="flex items-center gap-2">
            <input
              type="text"
              readonly
              value={tunnelStatus.public_url}
              class="w-full px-2.5 py-1.5 text-xs font-mono rounded-[5px] border"
              style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
            />
            <button
              type="button"
              onclick={copyPublicUrl}
              class="btn-3d px-3 py-1.5 text-xs font-bold rounded-[5px] border shrink-0 cursor-pointer"
              style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
            >
              {copiedUrl ? "Copied!" : "Copy"}
            </button>
            {#if tunnelStatus.public_url.startsWith('http')}
              <a
                href={tunnelStatus.public_url}
                target="_blank"
                rel="noopener noreferrer"
                class="btn-3d px-3 py-1.5 text-xs font-bold rounded-[5px] text-white shrink-0 inline-flex items-center gap-1"
                style="background-color: var(--color-primary);"
              >
                Open
              </a>
            {/if}
          </div>
        </div>
      {:else}
        <div class="p-3.5 rounded-[5px] border border-dashed text-center" style="border-color: var(--color-border); background: rgba(255, 255, 255, 0.4);">
          <p class="text-xs font-medium" style="color: var(--color-text-muted);">
            No active ingress tunnel. Enter your Cloudflare Tunnel Token and click "Start Cloudflare Tunnel".
          </p>
        </div>
      {/if}

      <!-- Cloudflare Tunnel Token & Domain Settings -->
      <div class="space-y-3 pt-1">
        <div>
          <label for="tunnel-token" class="text-xs font-bold block mb-1" style="color: var(--color-text);">
            Cloudflare Tunnel Token (Zero Trust Dashboard)
          </label>
          <div class="relative">
            <input
              id="tunnel-token"
              type={showTunnelToken ? "text" : "password"}
              bind:value={tunnelTokenInput}
              placeholder="Paste token from: cloudflared tunnel run --token <TOKEN>"
              class="w-full px-3 py-2 text-xs font-mono rounded-[5px] border pr-16 focus:outline-hidden transition-colors"
              style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
            />
            <button
              type="button"
              onclick={() => { showTunnelToken = !showTunnelToken; }}
              class="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-bold px-2 py-0.5 rounded-[5px] border cursor-pointer transition-colors"
              style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-muted);"
            >
              {showTunnelToken ? "Hide" : "Show"}
            </button>
          </div>
          <p class="text-[11px] font-medium mt-1" style="color: var(--color-text-muted);">
            Obtained from Cloudflare Zero Trust &gt; Networks &gt; Tunnels &gt; Create Tunnel.
          </p>
        </div>

        <div>
          <label for="tunnel-custom-domain" class="text-xs font-bold block mb-1" style="color: var(--color-text);">
            Public Hostname / Domain (Optional)
          </label>
          <input
            id="tunnel-custom-domain"
            type="text"
            bind:value={tunnelCustomDomain}
            placeholder="e.g. remote.yourdomain.com"
            class="w-full px-3 py-2 text-xs rounded-[5px] border focus:outline-hidden transition-colors"
            style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
          />
        </div>
      </div>

      <!-- Tunnel Controls -->
      <div class="flex flex-wrap items-center justify-between gap-2.5 pt-3 border-t" style="border-color: var(--color-border);">
        <button
          type="button"
          onclick={saveTunnelSettings}
          disabled={tunnelSaving}
          class="btn-3d px-3.5 py-2 text-xs font-bold rounded-[5px] border cursor-pointer transition-colors"
          style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
        >
          {tunnelSaving ? "Saving..." : "Save Tunnel Settings"}
        </button>

        <button
          type="button"
          onclick={toggleTunnel}
          disabled={tunnelLoading}
          class={`btn-3d px-4 py-2 text-xs font-bold rounded-[5px] text-white cursor-pointer transition-colors ${
            tunnelStatus.enabled
              ? "bg-rose-600 hover:bg-rose-700"
              : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {tunnelLoading ? "Processing..." : (tunnelStatus.enabled ? "Stop Tunnel" : "Start Cloudflare Tunnel")}
        </button>
      </div>
    </div>
  </div>

  <!-- Card 3: Inbound Prompt Queue & Web Prompt Box -->
  <div
    class="glass-card-3d rounded-[5px] p-6 space-y-5 border"
    style="background: var(--glass-card); border-color: var(--color-border); box-shadow: var(--shadow-3d);"
  >
    <div class="flex items-center justify-between pb-3 border-b" style="border-color: var(--color-border);">
      <div>
        <h3 class="text-base font-bold" style="color: var(--color-text);">Inbound Prompt Queue</h3>
        <p class="text-xs font-medium" style="color: var(--color-text-muted);">Unified task inbox shared across Web UI, Telegram Bot, and Terminal Agents</p>
      </div>
      <span class="text-xs font-mono font-bold px-2.5 py-1 rounded-[5px] border" style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-muted);">
        {prompts.length} queued / recent tasks
      </span>
    </div>

    <!-- Quick Web Prompt Dispatcher -->
    <div class="flex flex-col sm:flex-row gap-2.5">
      <input
        type="text"
        bind:value={newPromptText}
        placeholder="Type a prompt to queue for your workstation (e.g. run unit tests and fix lints)..."
        class="flex-1 px-3.5 py-2.5 text-xs rounded-[5px] border focus:outline-hidden transition-colors"
        style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
        onkeydown={(e) => { if (e.key === "Enter") submitQueuePrompt(); }}
      />
      <button
        type="button"
        onclick={submitQueuePrompt}
        disabled={submittingPrompt || !newPromptText.trim()}
        class="btn-3d px-5 py-2.5 text-xs font-bold rounded-[5px] text-white transition-colors disabled:opacity-50 cursor-pointer shrink-0"
        style="background-color: var(--color-primary);"
      >
        {submittingPrompt ? "Dispatching..." : "Queue Prompt"}
      </button>
    </div>

    <!-- Prompts Table -->
    {#if prompts.length === 0}
      <div class="p-6 text-center text-xs font-medium border border-dashed rounded-[5px]" style="border-color: var(--color-border); color: var(--color-text-muted);">
        Queue is currently empty. Prompts sent via Telegram (<span class="font-mono font-bold">/run</span>) or Web UI will appear here.
      </div>
    {:else}
      <div class="overflow-x-auto rounded-[5px] border" style="border-color: var(--color-border);">
        <table class="w-full text-left text-xs">
          <thead>
            <tr class="border-b font-bold" style="border-color: var(--color-border); background: rgba(0, 0, 0, 0.02); color: var(--color-text-muted);">
              <th class="py-2.5 px-3">ID</th>
              <th class="py-2.5 px-3">Source</th>
              <th class="py-2.5 px-3">Prompt</th>
              <th class="py-2.5 px-3">Status</th>
              <th class="py-2.5 px-3">Created</th>
            </tr>
          </thead>
          <tbody class="divide-y" style="border-color: var(--color-border);">
            {#each prompts as p}
              <tr class="hover:bg-black/5 transition-colors">
                <td class="py-2.5 px-3 font-mono text-[11px] font-bold" style="color: var(--color-text);">{p.id}</td>
                <td class="py-2.5 px-3">
                  <span class={`px-2 py-0.5 text-[10px] font-bold rounded-[5px] border ${
                    p.source === "telegram"
                      ? "bg-sky-50 text-sky-700 border-sky-300"
                      : "bg-purple-50 text-purple-700 border-purple-300"
                  }`}>
                    {p.source.toUpperCase()}
                  </span>
                </td>
                <td class="py-2.5 px-3 font-medium max-w-md truncate" style="color: var(--color-text);" title={p.prompt}>
                  {p.prompt}
                </td>
                <td class="py-2.5 px-3">
                  <span class={`px-2.5 py-0.5 text-[10px] font-bold rounded-[5px] border ${
                    p.status === "completed"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                      : p.status === "processing"
                      ? "bg-amber-50 text-amber-700 border-amber-300"
                      : "bg-slate-50 text-slate-700 border-slate-300"
                  }`}>
                    {p.status.toUpperCase()}
                  </span>
                </td>
                <td class="py-2.5 px-3 text-[11px] font-mono whitespace-nowrap" style="color: var(--color-text-muted);">
                  {new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>

<!-- 3D Glass Setup Guide Modal -->
{#if showGuideModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    role="presentation"
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/35 backdrop-blur-sm animate-in fade-in duration-150"
    onclick={(e) => { if (e.target === e.currentTarget) showGuideModal = false; }}
  >
    <div
      class="modal-card w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 sm:p-8 rounded-[5px] border shadow-2xl space-y-6 animate-in zoom-in-95 duration-150 glass-frost-strong"
      style="background-color: var(--color-surface); border-color: var(--color-border); color: var(--color-text); box-shadow: var(--shadow-3d);"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between pb-3 border-b" style="border-color: var(--color-border);">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-[5px] flex items-center justify-center font-bold text-xs text-white" style="background: var(--color-primary);">
            ℹ️
          </div>
          <div>
            <h3 class="text-base font-bold" style="color: var(--color-text);">Remote Access Setup Guide</h3>
            <p class="text-xs" style="color: var(--color-text-muted);">Step-by-step setup for Cloudflare Tunnel and Telegram Bot</p>
          </div>
        </div>
        <button
          type="button"
          onclick={() => { showGuideModal = false; }}
          class="w-7 h-7 rounded-[5px] flex items-center justify-center text-xs font-bold border transition-colors hover:scale-105 cursor-pointer"
          style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-muted);"
        >
          ✕
        </button>
      </div>

      <div class="space-y-5 text-xs leading-relaxed" style="color: var(--color-text);">
        <!-- Cloudflare Tunnel Guide -->
        <div class="p-4 rounded-[5px] border space-y-2.5" style="background: var(--color-surface); border-color: var(--color-border);">
          <div class="font-bold flex items-center gap-2" style="color: var(--color-primary);">
            <span>1. Cloudflare Zero Trust Named Tunnel</span>
          </div>
          <ol class="list-decimal pl-4 space-y-1.5" style="color: var(--color-text-muted);">
            <li>Go to <strong>Cloudflare Zero Trust Dashboard &gt; Networks &gt; Tunnels</strong>.</li>
            <li>Click <strong>Create a Tunnel</strong>, choose <strong>Cloudflare Tunnel</strong>.</li>
            <li>Name your tunnel (e.g. <code>konoha-remote</code>) and choose your OS (Linux).</li>
            <li>Copy the token string from the command: <code>cloudflared tunnel run --token &lt;TOKEN&gt;</code>.</li>
            <li>Paste the token into the <strong>Cloudflare Tunnel Token</strong> field above and click <strong>Save Tunnel Settings</strong>.</li>
            <li>In the Cloudflare dashboard, configure a Public Hostname (e.g. <code>remote.yourdomain.com</code>) pointing to Service <code>http://localhost:1404</code>.</li>
            <li>Click <strong>Start Cloudflare Tunnel</strong> to establish the live ingress!</li>
          </ol>
        </div>

        <!-- Telegram Bot Guide -->
        <div class="p-4 rounded-[5px] border space-y-2.5" style="background: var(--color-surface); border-color: var(--color-border);">
          <div class="font-bold flex items-center gap-2" style="color: var(--color-primary);">
            <span>2. Telegram Bot Integration</span>
          </div>
          <ol class="list-decimal pl-4 space-y-1.5" style="color: var(--color-text-muted);">
            <li>Open Telegram and message <strong>@BotFather</strong>. Send <code>/newbot</code> and follow instructions to create a bot.</li>
            <li>Copy the HTTP API <strong>Bot Token</strong>.</li>
            <li>Message <strong>@userinfobot</strong> on Telegram to find your numeric <strong>Chat ID</strong>.</li>
            <li>Paste the Bot Token and Chat ID above, click <strong>Save Settings</strong>.</li>
            <li>Click <strong>Send Test Ping</strong> to verify direct delivery to your Telegram chat.</li>
            <li>Enable <strong>Two-Way Mode</strong> if you wish to dispatch prompts remotely by sending <code>/run &lt;prompt&gt;</code> to your bot!</li>
          </ol>
        </div>
      </div>

      <div class="flex justify-end pt-2 border-t" style="border-color: var(--color-border);">
        <button
          type="button"
          onclick={() => { showGuideModal = false; }}
          class="btn-3d px-4 py-2 text-xs font-bold rounded-[5px] text-white cursor-pointer"
          style="background-color: var(--color-primary);"
        >
          Got it
        </button>
      </div>
    </div>
  </div>
{/if}
