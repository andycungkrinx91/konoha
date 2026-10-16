/* eslint-disable no-undef */
// Svelte 5 Runes State for Konoha 10-Theme System

export const THEMES = [
  { id: 'chidori', name: 'Chidori Azure Light', description: 'Crackling sky-blue precision with lightning focus', color: '#3B82F6', accent: '#14B8A6', gradient: ['#3B82F6', '#14B8A6', '#8B5CF6', '#F97316'], glow: 'rgba(59,130,246,0.15)', bg: '#f0f9ff', surface: '#ffffff', border: '#bfdbfe', light: true },
  { id: 'byakugan', name: 'Byakugan Sunburst Light', description: 'Golden sunburst clarity with magenta accents', color: '#EAB308', accent: '#EC4899', gradient: ['#EAB308', '#EC4899', '#84CC16', '#06B6D4'], glow: 'rgba(234,179,8,0.15)', bg: '#fefce8', surface: '#ffffff', border: '#fef08a', light: true },
  { id: 'konoha-leaf', name: 'Konoha Indigo Rose Light', description: 'Indigo dusk with vibrant rose vitality', color: '#6366F1', accent: '#F43F5E', gradient: ['#6366F1', '#F43F5E', '#3B82F6', '#EAB308'], glow: 'rgba(99,102,241,0.15)', bg: '#eef2ff', surface: '#ffffff', border: '#c7d2fe', light: true },
  { id: 'rasengan', name: 'Rasengan Violet Light', description: 'Deep violet swirl with cyan electricity', color: '#8B5CF6', accent: '#06B6D4', gradient: ['#8B5CF6', '#06B6D4', '#F97316', '#EC4899'], glow: 'rgba(139,92,246,0.15)', bg: '#f5f3ff', surface: '#ffffff', border: '#ddd6fe', light: true },
  { id: 'sharingan', name: 'Sharingan Teal Lime Light', description: 'Teal focus with lime kinetic energy', color: '#14B8A6', accent: '#84CC16', gradient: ['#14B8A6', '#84CC16', '#6366F1', '#F43F5E'], glow: 'rgba(20,184,166,0.15)', bg: '#f0fdfa', surface: '#ffffff', border: '#99f6e4', light: true },
  { id: 'hokage-gold', name: 'Hokage Amber Light', description: 'Warm amber command with azure brilliance', color: '#F97316', accent: '#EAB308', gradient: ['#F97316', '#EAB308', '#3B82F6', '#EC4899'], glow: 'rgba(249,115,22,0.15)', bg: '#fff7ed', surface: '#ffffff', border: '#fed7aa', light: true },
  { id: 'anbu-shadow', name: 'Anbu Cyan Purple Light', description: 'Cyan tactical operative with purple glow', color: '#06B6D4', accent: '#8B5CF6', gradient: ['#06B6D4', '#8B5CF6', '#14B8A6', '#6366F1'], glow: 'rgba(6,182,212,0.15)', bg: '#ecfeff', surface: '#ffffff', border: '#a5f3fc', light: true },
  { id: 'sage-mode', name: 'Sage Pink Ruby Light', description: 'Pink toad-sage aura with crimson depth', color: '#EC4899', accent: '#F43F5E', gradient: ['#EC4899', '#F43F5E', '#EAB308', '#84CC16'], glow: 'rgba(236,72,153,0.15)', bg: '#fdf2f8', surface: '#ffffff', border: '#fbcfe8', light: true },
  { id: 'sound-village', name: 'Sound Cobalt Light', description: 'Cobalt resonance with sonic indigo aura', color: '#3B82F6', accent: '#6366F1', gradient: ['#3B82F6', '#6366F1', '#06B6D4', '#F43F5E'], glow: 'rgba(59,130,246,0.15)', bg: '#eff6ff', surface: '#ffffff', border: '#bfdbfe', light: true },
  { id: 'akatsuki', name: 'Akatsuki Lime Emerald Light', description: 'Lime rogue power with deep emerald undertone', color: '#84CC16', accent: '#14B8A6', gradient: ['#84CC16', '#14B8A6', '#EAB308', '#8B5CF6'], glow: 'rgba(132,204,22,0.15)', bg: '#f7fee7', surface: '#ffffff', border: '#d9f99d', light: true }
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
