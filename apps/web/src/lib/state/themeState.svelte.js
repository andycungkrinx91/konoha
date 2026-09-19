/* eslint-disable no-undef */
// Svelte 5 Runes State for Konoha 10-Theme System

export const THEMES = [
  { id: 'chidori', name: 'Chidori Azure Light', description: 'Crackling sky-blue precision with lightning focus', color: '#0284c7', accent: '#06b6d4', gradient: ['#0284c7', '#06b6d4', '#38bdf8', '#818cf8'], glow: 'rgba(2,132,199,0.12)', bg: '#f0f9ff', surface: '#ffffff', border: '#bae6fd', light: true },
  { id: 'byakugan', name: 'Byakugan Pure Light', description: 'Violet focus with 360° clarity', color: '#7c3aed', accent: '#6366f1', gradient: ['#7c3aed', '#6366f1', '#8b5cf6', '#a855f7'], glow: 'rgba(124,58,237,0.12)', bg: '#f8fafc', surface: '#ffffff', border: '#e2e8f0', light: true },
  { id: 'konoha-leaf', name: 'Konoha Emerald Light', description: 'Hidden leaf green serenity', color: '#059669', accent: '#14b8a6', gradient: ['#059669', '#10b981', '#14b8a6', '#34d399'], glow: 'rgba(5,150,105,0.12)', bg: '#f0fdf4', surface: '#ffffff', border: '#bbf7d0', light: true },
  { id: 'rasengan', name: 'Rasengan Breeze Light', description: 'Spiralling royal-blue energy', color: '#2563eb', accent: '#3b82f6', gradient: ['#1d4ed8', '#2563eb', '#3b82f6', '#60a5fa'], glow: 'rgba(37,99,235,0.12)', bg: '#eff6ff', surface: '#ffffff', border: '#bfdbfe', light: true },
  { id: 'sharingan', name: 'Sharingan Rose Light', description: 'Crimson perception, softly lit', color: '#dc2626', accent: '#f43f5e', gradient: ['#be123c', '#dc2626', '#e11d48', '#f43f5e'], glow: 'rgba(220,38,38,0.12)', bg: '#fff1f2', surface: '#ffffff', border: '#fecdd3', light: true },
  { id: 'hokage-gold', name: 'Hokage Amber Light', description: 'Warm gold of the village leader', color: '#d97706', accent: '#f59e0b', gradient: ['#b45309', '#d97706', '#f59e0b', '#fbbf24'], glow: 'rgba(217,119,6,0.12)', bg: '#fffbeb', surface: '#ffffff', border: '#fde68a', light: true },
  { id: 'anbu-shadow', name: 'Anbu Platinum Light', description: 'Cool steel-grey operative tone', color: '#475569', accent: '#64748b', gradient: ['#334155', '#475569', '#64748b', '#94a3b8'], glow: 'rgba(71,85,105,0.12)', bg: '#f8fafc', surface: '#ffffff', border: '#cbd5e1', light: true },
  { id: 'sage-mode', name: 'Sage Coral Light', description: 'Natural orange toad-sage warmth', color: '#ea580c', accent: '#f97316', gradient: ['#c2410c', '#ea580c', '#f97316', '#fb923c'], glow: 'rgba(234,88,12,0.12)', bg: '#fff7ed', surface: '#ffffff', border: '#fed7aa', light: true },
  { id: 'sound-village', name: 'Sound Orchid Light', description: 'Orchid purple with sonic depth', color: '#9333ea', accent: '#a855f7', gradient: ['#7e22ce', '#9333ea', '#a855f7', '#c084fc'], glow: 'rgba(147,51,234,0.12)', bg: '#faf5ff', surface: '#ffffff', border: '#e9d5ff', light: true },
  { id: 'akatsuki', name: 'Akatsuki Dusk Plum Light', description: 'Mysterious plum dusk with rogue ninja cloak aura', color: '#86198f', accent: '#c026d3', gradient: ['#581c87', '#701a75', '#86198f', '#c026d3'], glow: 'rgba(134,25,143,0.12)', bg: '#fdf4ff', surface: '#ffffff', border: '#f5d0fe', light: true }
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
      if (found.gradient && found.gradient.length >= 4) {
        document.documentElement.style.setProperty('--theme-grad-1', found.gradient[0]);
        document.documentElement.style.setProperty('--theme-grad-2', found.gradient[1]);
        document.documentElement.style.setProperty('--theme-grad-3', found.gradient[2]);
        document.documentElement.style.setProperty('--theme-grad-4', found.gradient[3]);
        document.documentElement.style.setProperty('--theme-4gradient', `linear-gradient(135deg, ${found.gradient[0]} 0%, ${found.gradient[1]} 33%, ${found.gradient[2]} 66%, ${found.gradient[3]} 100%)`);
        document.documentElement.style.setProperty('--theme-4gradient-bar', `linear-gradient(90deg, ${found.gradient[0]}, ${found.gradient[1]}, ${found.gradient[2]}, ${found.gradient[3]})`);
        document.documentElement.style.setProperty('--theme-4gradient-subtle', `linear-gradient(135deg, ${found.gradient[0]}22 0%, ${found.gradient[1]}22 33%, ${found.gradient[2]}22 66%, ${found.gradient[3]}22 100%)`);
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
