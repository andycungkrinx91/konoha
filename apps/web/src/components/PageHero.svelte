<script>
  /**
   * PageHero.svelte — Unified console page hero component.
   * Derived from the canonical RemoteAccess hero specification:
   * - glass-card-3d relative overflow-hidden rounded-[5px] p-8 border
   * - linear-gradient(135deg, var(--theme-surface) 0%, color-mix(in srgb, var(--theme-surface) 82%, transparent) 100%), var(--color-primary-glow)
   * - border-color: var(--color-border); box-shadow: var(--shadow-3d);
   * - responsive flex-col md:flex-row layout with high-contrast typography
   */
  let {
    title = '',
    badgeText = '',
    badgeIcon = null,
    badge = null,
    description = '',
    desc = null,
    actions = null,
    stats = null,
    children = null
  } = $props();
</script>

<div
  class="glass-card-3d relative overflow-hidden rounded-[5px] p-8 border transition-all duration-300"
  style="background: linear-gradient(135deg, var(--theme-surface) 0%, color-mix(in srgb, var(--theme-surface) 82%, transparent) 100%), var(--color-primary-glow); border-color: var(--color-border); box-shadow: var(--shadow-3d);"
>
  <div class="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
    <div class="space-y-2">
      {#if badge}
        {@render badge()}
      {:else if badgeText}
        <div
          class="inline-flex items-center gap-2 px-3 py-1 rounded-[5px] text-xs font-bold border"
          style="background-color: var(--color-primary-glow); color: var(--color-primary); border-color: var(--color-primary);"
        >
          {#if badgeIcon}
            {@render badgeIcon()}
          {:else}
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          {/if}
          <span>{badgeText}</span>
        </div>
      {/if}

      <h2 class="text-2xl lg:text-3xl font-black tracking-tight" style="color: var(--color-text);">
        {title}
      </h2>

      {#if desc}
        <div class="text-sm font-semibold max-w-2xl leading-relaxed" style="color: var(--color-text-muted);">
          {@render desc()}
        </div>
      {:else if description}
        <p class="text-sm font-semibold max-w-2xl leading-relaxed" style="color: var(--color-text-muted);">
          {description}
        </p>
      {/if}

      {#if children}
        {@render children()}
      {/if}
    </div>

    {#if actions || stats}
      <div class="flex flex-wrap items-center gap-3 shrink-0">
        {#if stats}
          {@render stats()}
        {/if}
        {#if actions}
          {@render actions()}
        {/if}
      </div>
    {/if}
  </div>
</div>
