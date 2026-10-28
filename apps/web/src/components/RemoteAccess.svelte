<script>
  import { onMount } from "svelte";
  import { api } from "#lib/api.js";
  import { toast } from "#lib/state/toast.svelte.ts";
  import { uiState } from "#lib/state/uiState.svelte.js";
  import { useScrollLock } from "#lib/scrollLock.svelte.js";
  import PageHero from "./PageHero.svelte";

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

  // Queue State
  let prompts = $state([]);
  let newPromptText = $state("");
  let submittingPrompt = $state(false);

  // Webhook State (Feedback 6)
  let webhooks = $state([]);
  let whNameInput = $state("");
  let whUrlInput = $state("");
  let whAuthType = $state("none");
  let whTokenInput = $state("");
  let whCustomHeader = $state("");
  let whSaving = $state(false);
  let whTesting = $state(null);

  let showGuideModal = $state(false);

  useScrollLock(() => showGuideModal);

  async function loadData() {
    try {
      const [tgRes, qRes, whRes] = await Promise.all([
        api.get("/api/v1/telegram/config"),
        api.get("/api/v1/queue/prompts?limit=15"),
        api.get("/api/v1/webhooks")
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

      if (qRes && qRes.ok) {
        prompts = qRes.prompts || [];
      }

      if (whRes && whRes.ok) {
        webhooks = whRes.webhooks || [];
      }
    } catch (err) {
      uiState.addNotification(`Failed to load remote access data: ${err.message}`, "error");
    }
  }

  async function saveWebhook() {
    if (!whNameInput.trim() || !whUrlInput.trim()) {
      toast.warning("Webhook name and full endpoint URL are required.");
      return;
    }
    whSaving = true;
    try {
      const payload = {
        name: whNameInput.trim(),
        url: whUrlInput.trim(),
        auth_type: whAuthType,
        auth_token: whTokenInput.trim(),
        custom_header: whCustomHeader.trim()
      };
      const res = await api.post("/api/v1/webhooks", payload);
      if (res && res.ok) {
        toast.success(`Webhook "${whNameInput}" created successfully!`);
        whNameInput = "";
        whUrlInput = "";
        whAuthType = "none";
        whTokenInput = "";
        whCustomHeader = "";
        await loadData();
      }
    } catch (err) {
      toast.error("Failed to add webhook: " + err.message);
    } finally {
      whSaving = false;
    }
  }

  async function testWebhook(id) {
    whTesting = id;
    try {
      const res = await api.post(`/api/v1/webhooks/${id}/test`, {});
      if (res && res.ok) {
        toast.success(`Webhook test delivered successfully! Status: HTTP ${res.status}`);
      } else {
        toast.error(`Webhook test failed: ${res.error || `HTTP ${res.status}`}`);
      }
      await loadData();
    } catch (err) {
      toast.error("Test failed: " + err.message);
    } finally {
      whTesting = null;
    }
  }

  async function deleteWebhook(id, name) {
    try {
      await api.delete(`/api/v1/webhooks/${id}`);
      toast.info(`Webhook "${name}" deleted.`);
      await loadData();
    } catch (err) {
      toast.error("Delete failed: " + err.message);
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
        toast.success("Telegram bot configuration persisted to SQLite.");
        await loadData();
      }
    } catch (err) {
      toast.error("Save failed: " + err.message);
    } finally {
      tgSaving = false;
    }
  }

  async function toggleTelegramEnabled() {
    try {
      const endpoint = tgConfig.enabled ? "/api/v1/telegram/disable" : "/api/v1/telegram/enable";
      await api.post(endpoint, {});
      toast.success(tgConfig.enabled ? "Telegram task reports and poller turned off." : "Telegram notifications active.");
      await loadData();
    } catch (err) {
      toast.error("Toggle action failed: " + err.message);
    }
  }

  async function sendTelegramTest() {
    tgTesting = true;
    const progressToast = toast.loading("Delivering test ping to Telegram...");
    try {
      const payload = {
        chat_id: tgChatIdInput.trim() || null,
        bot_token: (tgTokenInput && !tgTokenInput.includes("...")) ? tgTokenInput.trim() : null
      };
      const res = await api.post("/api/v1/telegram/test", payload);
      if (res && res.ok) {
        progressToast.success("Verification test ping successfully delivered to your Telegram chat!");
      } else {
        progressToast.error(res?.error || "Could not deliver message to Telegram. Check bot token and chat ID.");
      }
    } catch (err) {
      progressToast.error("Test request failed: " + err.message);
    } finally {
      tgTesting = false;
    }
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
        toast.success(`Task #${res.prompt?.id || ""} dispatched to task queue!`);
        await loadData();
      }
    } catch (err) {
      toast.error("Queue failed: " + err.message);
    } finally {
      submittingPrompt = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && showGuideModal) showGuideModal = false; }} />

<div class="space-y-8 w-full">
  {#snippet heroDesc()}
    Telegram task report alerts, inbound queue prompting, and outbound webhook integrations.
  {/snippet}

  {#snippet heroActions()}
    <button
      type="button"
      onclick={() => { showGuideModal = true; }}
      class="btn-3d btn-3d-secondary inline-flex items-center gap-2 px-4 py-2.5 rounded-[3px] font-bold text-xs border transition-all cursor-pointer"
    >
      <svg class="w-4 h-4 text-[var(--theme-info)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>Setup Guide</span>
    </button>

    <button
      type="button"
      onclick={loadData}
      class="btn-3d btn-3d-primary inline-flex items-center gap-2 px-4 py-2.5 rounded-[3px] font-bold text-xs text-white transition-all cursor-pointer shadow-md"
    >
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      <span>Refresh Telemetry</span>
    </button>
  {/snippet}

  <!-- Hero Section: themed translucent surface with high-contrast typography -->
  <PageHero
    title="Remote Access Control"
    badgeText="Remote Ingress & Integrations"
    desc={heroDesc}
    actions={heroActions}
  />

  <!-- Primary Dual-Card Grid (3D Perspective View) -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 perspective-container">

    <!-- Card 1: Telegram Bot Integration -->
    <div
      class="metric-card-3d rounded-[5px] p-6 space-y-5 border"
      style="border-color: color-mix(in srgb, var(--theme-grad-1) 28%, var(--color-border));"
    >
      <div class="flex items-center justify-between pb-3 border-b" style="border-color: var(--color-border);">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-[3px] flex items-center justify-center font-bold text-xs text-white shadow-sm" style="background: linear-gradient(135deg, #0284c7, #06b6d4);">
            TG
          </div>
          <div>
            <h3 class="text-base font-bold" style="color: var(--color-text);">Telegram Bot</h3>
            <p class="text-xs font-medium" style="color: var(--color-text-muted);">Task summary alerts &amp; remote prompting</p>
          </div>
        </div>
        <span class={`px-2.5 py-1 text-xs font-bold rounded-[3px] border ${
          tgConfig.enabled
            ? "bg-status-success-soft text-status-success border-status-success-soft"
            : "theme-bg-subtle theme-text-secondary theme-border"
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
            class="px-3.5 py-2.5 text-xs font-bold rounded-[3px] border text-left transition-all cursor-pointer"
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
            class="px-3.5 py-2.5 text-xs font-bold rounded-[3px] border text-left transition-all cursor-pointer"
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
              class="w-full px-3 py-2 text-xs font-mono rounded-[3px] border pr-16 login-field-effect focus:outline-hidden transition-colors"
              style="background: var(--color-surface); color: var(--color-text);"
            />
            <button
              type="button"
              onclick={() => { showToken = !showToken; }}
              class="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-bold px-2 py-0.5 rounded-[3px] border cursor-pointer transition-colors"
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
            class="w-full px-3 py-2 text-xs font-mono rounded-[3px] border login-field-effect focus:outline-hidden transition-colors"
            style="background: var(--color-surface); color: var(--color-text);"
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
            class={`btn-3d px-3.5 py-2 text-xs font-bold rounded-[3px] border cursor-pointer ${
              tgConfig.enabled
                ? "border-status-warning-soft bg-status-warning-soft text-status-warning"
                : "border-status-success-soft bg-status-success-soft text-status-success"
            }`}
          >
            {tgConfig.enabled ? "Disable Integration" : "Enable Integration"}
          </button>
          <button
            type="button"
            onclick={sendTelegramTest}
            disabled={tgTesting || (!tgConfig.bot_token && !tgTokenInput)}
            class="btn-3d btn-3d-secondary px-3.5 py-2 text-xs font-bold rounded-[3px] border transition-colors disabled:opacity-50 cursor-pointer"
          >
            {tgTesting ? "Sending Ping..." : "Send Test Ping"}
          </button>
        </div>
        <button
          type="button"
          onclick={saveTelegramSettings}
          disabled={tgSaving}
          class="btn-3d btn-3d-primary px-4 py-2 text-xs font-bold rounded-[3px] text-white disabled:opacity-50 cursor-pointer shadow-md"
        >
          {tgSaving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>

    <!-- Card 2: Inbound Prompt Queue & Web Prompt Box -->
    <div
      class="metric-card-3d rounded-[5px] p-6 space-y-5 border"
      style="border-color: color-mix(in srgb, var(--theme-grad-2) 28%, var(--color-border));"
    >
    <div class="flex items-center justify-between pb-3 border-b" style="border-color: var(--color-border);">
      <div>
        <h3 class="text-base font-bold" style="color: var(--color-text);">Inbound Prompt Queue</h3>
        <p class="text-xs font-medium" style="color: var(--color-text-muted);">Unified task inbox shared across Web UI, Telegram Bot, and Terminal Agents</p>
      </div>
      <span class="text-xs font-mono font-bold px-2.5 py-1 rounded-[3px] border" style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-muted);">
        {prompts.length} queued / recent tasks
      </span>
    </div>

    <!-- Quick Web Prompt Dispatcher -->
    <div class="flex flex-col sm:flex-row gap-2.5">
      <input
        type="text"
        bind:value={newPromptText}
        placeholder="Type a prompt to queue for your workstation (e.g. run unit tests and fix lints)..."
        class="flex-1 px-3.5 py-2.5 text-xs rounded-[3px] border login-field-effect focus:outline-hidden transition-colors"
        style="background: var(--color-surface); color: var(--color-text);"
        onkeydown={(e) => { if (e.key === "Enter") submitQueuePrompt(); }}
      />
      <button
        type="button"
        onclick={submitQueuePrompt}
        disabled={submittingPrompt || !newPromptText.trim()}
        class="btn-3d btn-3d-primary px-5 py-2.5 text-xs font-bold rounded-[3px] text-white disabled:opacity-50 cursor-pointer shrink-0 shadow-md"
      >
        {submittingPrompt ? "Dispatching..." : "Queue Prompt"}
      </button>
    </div>

    <!-- Prompts Table -->
    {#if prompts.length === 0}
      <div class="p-6 text-center text-xs font-medium border border-dashed rounded-[3px]" style="border-color: var(--color-border); color: var(--color-text-muted);">
        Queue is currently empty. Prompts sent via Telegram (<span class="font-mono font-bold">/run</span>) or Web UI will appear here.
      </div>
    {:else}
      <div class="overflow-x-auto rounded-[3px] border" style="border-color: var(--color-border);">
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
                  <span class={`px-2 py-0.5 text-[10px] font-bold rounded-[3px] border ${
                    p.source === "telegram"
                      ? "bg-status-info-soft text-status-info border-status-info-soft"
                      : "bg-status-info-soft text-action-primary border-status-info-soft"
                  }`}>
                    {p.source.toUpperCase()}
                  </span>
                </td>
                <td class="py-2.5 px-3 font-medium max-w-md truncate" style="color: var(--color-text);" title={p.prompt}>
                  {p.prompt}
                </td>
                <td class="py-2.5 px-3">
                  <span class={`px-2.5 py-0.5 text-[10px] font-bold rounded-[3px] border ${
                    p.status === "completed"
                      ? "bg-status-success-soft text-status-success border-status-success-soft"
                      : p.status === "processing"
                      ? "bg-status-warning-soft text-status-warning border-status-warning-soft"
                      : "theme-bg-muted theme-text-secondary theme-border"
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

  <!-- Card 4: Webhook Outbound Integration (Feedback 6) -->
  <div
    class="glass-card-3d p-6 rounded-[3px] border space-y-6"
    style="background: var(--color-surface); border-color: color-mix(in srgb, var(--theme-grad-1) 25%, var(--color-border));"
  >
    <div class="flex items-start justify-between gap-4 border-b pb-4" style="border-color: var(--color-border);">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-[3px] flex items-center justify-center font-bold text-white shadow-sm" style="background: var(--theme-4gradient);">
          <svg class="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        </div>
        <div>
          <h2 class="text-base font-bold flex items-center gap-2" style="color: var(--color-text);">
            Outbound Webhook Integration
            <span class="px-2 py-0.5 text-[10px] font-bold rounded-[3px] border bg-status-success-soft text-status-success border-status-success-soft">
              {webhooks.length} Active
            </span>
          </h2>
          <p class="text-xs" style="color: var(--color-text-muted);">
            Broadcast task dispatches and event alerts to external HTTP endpoints (Discord, Slack, n8n, Zapier, custom servers).
          </p>
        </div>
      </div>
    </div>

    <!-- Webhook Creation Form -->
    <div class="p-4 rounded-[3px] border space-y-4" style="background: color-mix(in srgb, var(--color-surface) 95%, var(--theme-grad-1)); border-color: var(--color-border);">
      <div class="text-xs font-bold uppercase tracking-wider" style="color: var(--color-primary);">Add Webhook Target</div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label for="wh-name" class="text-xs font-bold block mb-1" style="color: var(--color-text);">Webhook Name</label>
          <input
            id="wh-name"
            type="text"
            bind:value={whNameInput}
            placeholder="e.g. Discord Village Alerts or CI/CD Pipeline"
            class="w-full px-3 py-2 text-xs font-mono rounded-[3px] border login-field-effect focus:outline-hidden"
            style="background: var(--color-surface); color: var(--color-text);"
          />
        </div>
        <div>
          <label for="wh-url" class="text-xs font-bold block mb-1" style="color: var(--color-text);">Full Endpoint URL</label>
          <input
            id="wh-url"
            type="url"
            bind:value={whUrlInput}
            placeholder="https://example.com/api/webhook or Discord/Slack URL"
            class="w-full px-3 py-2 text-xs font-mono rounded-[3px] border login-field-effect focus:outline-hidden"
            style="background: var(--color-surface); color: var(--color-text);"
          />
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label for="wh-auth-type" class="text-xs font-bold block mb-1" style="color: var(--color-text);">Authentication Type</label>
          <select
            id="wh-auth-type"
            bind:value={whAuthType}
            class="w-full px-3 py-2 text-xs font-bold rounded-[3px] border focus:outline-hidden cursor-pointer"
            style="background: var(--color-surface); color: var(--color-text);"
          >
            <option value="none">No Auth (Public / Webhook URL)</option>
            <option value="bearer">Bearer Token (Authorization: Bearer ...)</option>
            <option value="api_key">API Key (X-API-Key: ...)</option>
            <option value="jwt">JWT Token (Authorization: Bearer &lt;jwt&gt;)</option>
            <option value="custom_header">Custom Header</option>
          </select>
        </div>

        {#if whAuthType !== 'none'}
          <div>
            <label for="wh-token" class="text-xs font-bold block mb-1" style="color: var(--color-text);">
              {whAuthType === 'api_key' ? 'API Key Secret' : (whAuthType === 'jwt' ? 'JWT Token' : 'Bearer Token')}
            </label>
            <input
              id="wh-token"
              type="password"
              bind:value={whTokenInput}
              placeholder="Enter secret token or key"
              class="w-full px-3 py-2 text-xs font-mono rounded-[3px] border login-field-effect focus:outline-hidden"
              style="background: var(--color-surface); color: var(--color-text);"
            />
          </div>
        {/if}

        {#if whAuthType === 'custom_header'}
          <div>
            <label for="wh-header" class="text-xs font-bold block mb-1" style="color: var(--color-text);">Custom Header Name</label>
            <input
              id="wh-header"
              type="text"
              bind:value={whCustomHeader}
              placeholder="e.g. X-Webhook-Secret"
              class="w-full px-3 py-2 text-xs font-mono rounded-[3px] border login-field-effect focus:outline-hidden"
              style="background: var(--color-surface); color: var(--color-text);"
            />
          </div>
        {/if}
      </div>

      <div class="flex justify-end pt-2">
        <button
          type="button"
          onclick={saveWebhook}
          disabled={whSaving}
          class="btn-3d btn-3d-primary px-5 py-2 text-xs font-bold rounded-[3px] text-white disabled:opacity-50 cursor-pointer shadow-md"
        >
          {whSaving ? "Saving..." : "Add Webhook"}
        </button>
      </div>
    </div>

    <!-- Webhooks List -->
    {#if webhooks.length === 0}
      <div class="p-6 text-center rounded-[3px] border" style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-muted);">
        <p class="text-xs">No outbound webhooks configured yet. Add your first webhook endpoint above.</p>
      </div>
    {:else}
      <div class="space-y-3">
        {#each webhooks as wh}
          <div class="p-3.5 rounded-[3px] border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3" style="background: var(--color-surface); border-color: var(--color-border);">
            <div class="space-y-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-bold text-xs" style="color: var(--color-text);">{wh.name}</span>
                <span class="text-[10px] px-1.5 py-0.5 rounded-[4px] border font-mono uppercase {wh.auth_type !== 'none' ? 'bg-status-info-soft text-status-info border-status-info-soft' : 'theme-bg-muted theme-text-secondary theme-border'}">
                  {wh.auth_type}
                </span>
                {#if wh.last_status}
                  <span class={`text-[10px] px-1.5 py-0.5 rounded-[4px] border font-mono ${wh.last_status >= 200 && wh.last_status < 300 ? 'bg-status-success-soft text-status-success border-status-success-soft' : 'bg-status-danger-soft text-status-danger border-status-danger-soft'}`}>
                    HTTP {wh.last_status}
                  </span>
                {/if}
              </div>
              <p class="text-xs font-mono truncate" style="color: var(--color-text-muted);" title={wh.url}>
                {wh.url}
              </p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onclick={() => testWebhook(wh.id)}
                disabled={whTesting === wh.id}
                class="btn-3d btn-3d-secondary px-3 py-1.5 text-xs font-bold rounded-[3px] border cursor-pointer"
              >
                {whTesting === wh.id ? "Testing..." : "Test Ping"}
              </button>
              <button
                type="button"
                onclick={() => deleteWebhook(wh.id, wh.name)}
                class="btn-3d px-3 py-1.5 text-xs font-bold rounded-[3px] border border-status-danger-soft bg-status-danger-soft text-status-danger cursor-pointer hover:bg-status-danger hover:text-white transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        {/each}
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
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--theme-overlay)] 35 backdrop-blur-sm animate-in fade-in duration-150"
    onclick={(e) => { if (e.target === e.currentTarget) showGuideModal = false; }}
  >
    <div
      class="modal-card modal-3d w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 sm:p-8 rounded-[3px] border shadow-2xl space-y-6 animate-in zoom-in-95 duration-150 glass-frost-strong"
      style="border-color: var(--theme-modal-border, color-mix(in srgb, var(--theme-grad-1) 38%, var(--color-border))); color: var(--color-text); box-shadow: var(--theme-modal-shadow, var(--shadow-3d));"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between pb-3 border-b" style="border-color: var(--color-border);">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-[3px] flex items-center justify-center font-bold text-xs text-white shadow-sm" style="background: var(--theme-4gradient);">
            <svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h3 class="text-base font-bold" style="color: var(--color-text);">Remote Access Setup Guide</h3>
            <p class="text-xs" style="color: var(--color-text-muted);">Step-by-step setup for Telegram Bot integration</p>
          </div>
        </div>
        <button
          type="button"
          onclick={() => { showGuideModal = false; }}
          class="w-7 h-7 rounded-[3px] flex items-center justify-center text-xs font-bold border transition-colors hover:scale-105 cursor-pointer"
          style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-muted);"
          aria-label="Close guide modal"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="space-y-5 text-xs leading-relaxed" style="color: var(--color-text);">
        <!-- Telegram Bot Guide -->
        <div class="p-4 rounded-[3px] border space-y-2.5" style="background: var(--color-surface); border-color: var(--color-border);">
          <div class="font-bold flex items-center gap-2" style="color: var(--color-primary);">
            <span>Telegram Bot Integration</span>
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
          class="btn-3d btn-3d-primary px-5 py-2 text-xs font-bold rounded-[3px] text-white cursor-pointer shadow-md"
        >
          Got it
        </button>
      </div>
    </div>
  </div>
{/if}
