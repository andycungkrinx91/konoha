/* eslint-disable no-undef */
// Svelte 5 Runes State for Konoha 10-Theme System

export const THEMES = [
  { id: 'chidori', name: 'Chidori Midnight Violet', description: 'Deep obsidian violet aura with neon fuchsia spark', color: '#8B5CF6', accent: '#FF4FA3', gradient: ['#10132B', '#35206B', '#8B5CF6', '#FF4FA3'], glow: 'rgba(139,92,246,0.18)', bg: '#fbfaff', surface: '#ffffff', border: '#e9d5ff', light: true },
  { id: 'byakugan', name: 'Byakugan Deep Cyan', description: 'Abyssal navy depth with electric sky-cyan radiance', color: '#0788C9', accent: '#36DFFF', gradient: ['#0B1729', '#124A72', '#0788C9', '#36DFFF'], glow: 'rgba(7,136,201,0.18)', bg: '#f0f9ff', surface: '#ffffff', border: '#bae6fd', light: true },
  { id: 'konoha-leaf', name: 'Konoha Forest Aurora', description: 'Shadow evergreen canopy with radioactive lime dawn', color: '#68A82E', accent: '#B8FF49', gradient: ['#101D13', '#285225', '#68A82E', '#B8FF49'], glow: 'rgba(104,168,46,0.18)', bg: '#f7fee7', surface: '#ffffff', border: '#d9f99d', light: true },
  { id: 'rasengan', name: 'Rasengan Cosmic Magenta', description: 'Deep cosmos violet core with radiant amber swirl', color: '#D946EF', accent: '#FF8748', gradient: ['#21102B', '#66245E', '#D946EF', '#FF8748'], glow: 'rgba(217,70,239,0.18)', bg: '#fdf4ff', surface: '#ffffff', border: '#f5d0fe', light: true },
  { id: 'sharingan', name: 'Sharingan Royal Indigo', description: 'Midnight cobalt matrix with luminous lavender pulse', color: '#4F83FF', accent: '#B18CFF', gradient: ['#101A35', '#263F8F', '#4F83FF', '#B18CFF'], glow: 'rgba(79,131,255,0.18)', bg: '#eff6ff', surface: '#ffffff', border: '#bfdbfe', light: true },
  { id: 'hokage-gold', name: 'Hokage Crimson Flame', description: 'Charcoal wine darkness with vivid coral ember', color: '#F04452', accent: '#FF8A38', gradient: ['#251016', '#70202B', '#F04452', '#FF8A38'], glow: 'rgba(240,68,82,0.18)', bg: '#fff1f2', surface: '#ffffff', border: '#fecdd3', light: true },
  { id: 'anbu-shadow', name: 'Anbu Abyssal Emerald', description: 'Deep ocean pine with phosphorescent mint glow', color: '#19B5A5', accent: '#65F5D5', gradient: ['#0C2525', '#11665E', '#19B5A5', '#65F5D5'], glow: 'rgba(25,181,165,0.18)', bg: '#f0fdfa', surface: '#ffffff', border: '#99f6e4', light: true },
  { id: 'sage-mode', name: 'Sage Mode Nebula Orchid', description: 'Deep astral purple storm with cyan lightning', color: '#FF42C8', accent: '#35E8FF', gradient: ['#1C1030', '#633078', '#FF42C8', '#35E8FF'], glow: 'rgba(255,66,200,0.18)', bg: '#faf5ff', surface: '#ffffff', border: '#f3e8ff', light: true },
  { id: 'sound-village', name: 'Sound Imperial Bronze', description: 'Deep bronze shadows with liquid gold lightning', color: '#D9A52E', accent: '#FFE477', gradient: ['#21190D', '#6B4517', '#D9A52E', '#FFE477'], glow: 'rgba(217,165,46,0.18)', bg: '#fefce8', surface: '#ffffff', border: '#fef08a', light: true },
  { id: 'akatsuki', name: 'Akatsuki Jade Matrix', description: 'Subterranean jade depth with bioluminescent cyan aura', color: '#21C98B', accent: '#58FFE0', gradient: ['#0B211D', '#126447', '#21C98B', '#58FFE0'], glow: 'rgba(33,201,139,0.18)', bg: '#f0fdf4', surface: '#ffffff', border: '#bbf7d0', light: true }
];

export function createThemeState() {
  let currentTheme = $state('chidori');
  let isModalOpen = $state(false);

  function applyTheme(themeId) {
    currentTheme = themeId;
    const found = THEMES.find(t => t.id === themeId) || THEMES[0];
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', themeId);
      document.documentElement.style.setProperty('--color-primary', found.color);
      document.documentElement.style.setProperty('--color-accent', found.accent);
      document.documentElement.style.setProperty('--color-primary-glow', found.glow);
      document.documentElement.style.setProperty('--color-bg', found.bg);
      document.documentElement.style.setProperty('--color-surface', found.surface);
      document.documentElement.style.setProperty('--color-border', found.border);
      document.documentElement.classList.add('theme-light');
      document.documentElement.classList.remove('theme-dark');
      document.documentElement.style.setProperty('--color-text', '#0f172a');
      document.documentElement.style.setProperty('--color-text-muted', '#334155');
      document.documentElement.style.setProperty('--color-card-bg', '#ffffff');
      document.documentElement.style.setProperty('--color-card-border', found.border);
      document.documentElement.style.setProperty('--glass-card-border', `${found.border}99`);
      document.documentElement.style.setProperty('--glass-tint', `${found.bg}aa`);
      if (found.gradient && found.gradient.length >= 4) {
        document.documentElement.style.setProperty('--theme-grad-1', found.gradient[0]);
        document.documentElement.style.setProperty('--theme-grad-2', found.gradient[1]);
        document.documentElement.style.setProperty('--theme-grad-3', found.gradient[2]);
        document.documentElement.style.setProperty('--theme-grad-4', found.gradient[3]);
        document.documentElement.style.setProperty('--theme-4gradient', `linear-gradient(135deg, ${found.gradient[0]} 0%, ${found.gradient[1]} 33%, ${found.gradient[2]} 66%, ${found.gradient[3]} 100%)`);
        document.documentElement.style.setProperty('--theme-4gradient-bar', `linear-gradient(90deg, ${found.gradient[0]}, ${found.gradient[1]}, ${found.gradient[2]}, ${found.gradient[3]})`);
        document.documentElement.style.setProperty('--theme-4gradient-subtle', `linear-gradient(135deg, ${found.gradient[0]}22 0%, ${found.gradient[1]}22 33%, ${found.gradient[2]}22 66%, ${found.gradient[3]}22 100%)`);
        document.documentElement.style.setProperty('--theme-sidebar-bg', `linear-gradient(180deg, color-mix(in srgb, ${found.gradient[0]} 10%, ${found.surface}) 0%, color-mix(in srgb, ${found.gradient[1]} 6%, ${found.surface}) 35%, color-mix(in srgb, ${found.gradient[2]} 6%, ${found.surface}) 70%, color-mix(in srgb, ${found.gradient[3]} 12%, ${found.surface}) 100%)`);
        document.documentElement.style.setProperty('--theme-sidebar-header-bg', `linear-gradient(135deg, color-mix(in srgb, ${found.gradient[0]} 16%, ${found.surface}) 0%, color-mix(in srgb, ${found.gradient[2]} 8%, ${found.surface}) 100%)`);
        document.documentElement.style.setProperty('--theme-sidebar-footer-bg', `linear-gradient(0deg, color-mix(in srgb, ${found.gradient[3]} 14%, ${found.surface}) 0%, color-mix(in srgb, ${found.gradient[1]} 6%, ${found.surface}) 100%)`);
        document.documentElement.style.setProperty('--theme-header-bg', `linear-gradient(90deg, color-mix(in srgb, ${found.gradient[0]} 10%, ${found.surface}) 0%, color-mix(in srgb, ${found.gradient[1]} 7%, ${found.surface}) 30%, color-mix(in srgb, ${found.gradient[2]} 7%, ${found.surface}) 70%, color-mix(in srgb, ${found.gradient[3]} 12%, ${found.surface}) 100%)`);
        document.documentElement.style.setProperty('--theme-dock-bg', `linear-gradient(90deg, color-mix(in srgb, ${found.gradient[0]} 12%, ${found.surface}) 0%, color-mix(in srgb, ${found.gradient[1]} 7%, ${found.surface}) 50%, color-mix(in srgb, ${found.gradient[3]} 12%, ${found.surface}) 100%)`);
      }
      try {
        localStorage.setItem('konoha-theme', themeId);
      } catch (_) {
        // Ignore localStorage errors in SSR or restricted environments
      }
    }
  }

  function init() {
    if (typeof window !== 'undefined') {
      let saved = 'chidori';
      try {
        saved = localStorage.getItem('konoha-theme') || 'chidori';
      } catch (_) {
        // Fallback to default theme if storage is unavailable
      }
      applyTheme(saved);
    }
  }

  return {
    get currentTheme() { return currentTheme; },
    get isModalOpen() { return isModalOpen; },
    set isModalOpen(val) { isModalOpen = val; },
    applyTheme,
    init,
    themes: THEMES
  };
}

export const themeState = createThemeState();
