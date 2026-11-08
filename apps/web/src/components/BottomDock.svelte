<script>
  import { page } from '$app/state';
  import { onMount } from 'svelte';

  const DOCK_ITEMS = [
    {
      id: 'dashboard',
      path: '/dashboard',
      label: 'Dashboard',
      iconSvg: 'M3 3v7h7M21 21v-7h-7M3 10a9 9 0 0115-5.7L21 8M21 14a9 9 0 01-15 5.7L3 16'
    },
    {
      id: 'activity',
      path: '/activity',
      label: 'Agent Activity',
      badge: 'Live',
      iconSvg: 'M13 10V3L4 14h7v7l9-11h-7z'
    },
    {
      id: 'agents',
      path: '/agents',
      label: 'Ninja Agents',
      iconSvg: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z'
    },
    {
      id: 'skills',
      path: '/skills',
      label: 'Skills & Vectors',
      iconSvg: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253'
    },
    {
      id: 'tasks',
      path: '/tasks',
      label: 'SDLC Tasks',
      iconSvg: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4'
    },
    {
      id: 'savings',
      path: '/savings',
      label: 'Token Savings',
      iconSvg: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z'
    },
    {
      id: 'clients',
      path: '/clients',
      label: 'Client IDEs',
      iconSvg: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z'
    }
  ];

  let pointerX = $state(null);
  let hoveredId = $state(null);
  let reducedMotion = $state(false);
  let itemRefs = $state({});

  function handlePointerMove(e) {
    if (reducedMotion) return;
    pointerX = e.clientX;
  }

  function handlePointerLeave() {
    pointerX = null;
    hoveredId = null;
  }

  function computeItemScale(id) {
    if (reducedMotion || pointerX === null) return 1;
    const el = itemRefs[id];
    if (!el) return 1;
    const rect = el.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const dist = Math.abs(pointerX - center);
    const maxDist = 135;
    if (dist >= maxDist) return 1;
    const influence = Math.cos((dist / maxDist) * (Math.PI / 2));
    return Number((1 + influence * 0.28).toFixed(3));
  }

  function computeItemLift(id) {
    const scale = computeItemScale(id);
    return Number(((scale - 1) * -22).toFixed(1));
  }

  onMount(() => {
    const mq = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    reducedMotion = Boolean(mq?.matches);
    const onChange = (ev) => { reducedMotion = ev.matches; };
    mq?.addEventListener?.('change', onChange);
    return () => mq?.removeEventListener?.('change', onChange);
  });
</script>

<nav
  aria-label="Quick Command Dock"
  data-testid="konoha-bottom-dock"
  class="fixed bottom-4 left-1/2 -translate-x-1/2 z-[90] pointer-events-auto"
  onpointermove={handlePointerMove}
  onpointerleave={handlePointerLeave}
>
  <div
    class="glass-frost flex items-center gap-1.5 sm:gap-2 px-3 py-2 rounded-2xl border shadow-2xl transition-all duration-200"
    style="background: var(--theme-dock-bg); border-color: color-mix(in srgb, var(--theme-grad-2) 34%, var(--color-border)); box-shadow: var(--shadow-3d);"
  >
    {#each DOCK_ITEMS as item (item.id)}
      {@const isActive = page.url.pathname === item.path || (item.path === '/dashboard' && page.url.pathname === '/')}
      {@const scale = computeItemScale(item.id)}
      {@const liftY = computeItemLift(item.id)}
      <div class="relative flex flex-col items-center">
        {#if hoveredId === item.id}
          <div
            class="
              absolute -top-9 px-2.5 py-1 rounded-[5px] text-[10px] font-extrabold whitespace-nowrap
              border shadow-lg pointer-events-none animate-in fade-in duration-150
            "
            style="background: var(--color-surface); border-color: var(--color-primary); color: var(--color-text);"
          >
            {item.label}
          </div>
        {/if}

        <a
          bind:this={itemRefs[item.id]}
          href={item.path}
          aria-label={item.label}
          aria-current={isActive ? 'page' : undefined}
          data-testid="dock-item-{item.id}"
          onpointerenter={() => { hoveredId = item.id; }}
          onfocus={() => { hoveredId = item.id; }}
          onblur={() => { if (hoveredId === item.id) hoveredId = null; }}
          class="
            relative w-10 h-10 sm:w-11 sm:h-11 rounded-xl border flex items-center justify-center
            transition-transform duration-150 ease-out cursor-pointer
          "
          style="
            transform: translate3d(0, {liftY}px, 0) scale({scale});
            background: {isActive ? 'var(--theme-4gradient)' : 'var(--color-surface)'};
            border-color: {isActive ? 'transparent' : 'var(--color-border)'};
            color: {isActive ? '#ffffff' : 'var(--color-text)'};
            box-shadow: {isActive ? '0 6px 18px var(--color-primary-glow)' : 'none'};
          "
        >
          <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d={item.iconSvg} />
          </svg>

          {#if item.badge}
            <span
              class="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border"
              style="background: var(--theme-success); border-color: var(--color-surface);"
              title={item.badge}
            ></span>
          {/if}
        </a>

        <!-- Active indicator pill -->
        <span
          class="mt-1 h-1 rounded-full transition-all duration-200 {isActive ? 'w-4 opacity-100' : 'w-1 opacity-0'}"
          style="background: var(--theme-4gradient-bar);"
        ></span>
      </div>
    {/each}
  </div>
</nav>
