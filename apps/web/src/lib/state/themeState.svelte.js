// Svelte 5 Runes State for Konoha 10-Theme System with Explicit Light / Dark Mode
import { applyDomTheme } from './themeTokens.js';

export const THEMES = [
  // Cyberpunk — 4 presets
  {
    id: 'chidori',
    name: 'Children of Midnight Violet',
    category: 'Cyberpunk',
    description: 'Deep obsidian violet aura with neon magenta and hot pink spark',
    color: '#8B5CF6',
    accent: '#FF4FA3',
    gradient: ['#10132B', '#35206B', '#8B5CF6', '#FF4FA3'],
    glow: 'rgba(139,92,246,0.22)',
    rasengan: {
      dark: ['#8B5CF6', '#FF4FA3', '#A78BFA', '#F43F5E'],
      light: ['#7C3AED', '#DB2777', '#6D28D9', '#BE185D']
    },
    // Light mode tokens
    light: {
      bg: '#fbfaff',
      surface: '#ffffff',
      surfaceHover: '#f5f3ff',
      surfaceActive: '#ede9fe',
      border: '#e9d5ff',
      text: '#0f172a',
      textMuted: '#475569',
      cardBg: '#ffffff',
      cardBorder: '#e9d5ff'
    },
    // Dark mode tokens
    dark: {
      bg: '#0c0714',
      surface: '#150d24',
      surfaceHover: '#1f1335',
      surfaceActive: '#2a1a47',
      border: '#3b1d6e',
      text: '#f8fafc',
      textMuted: '#94a3b8',
      cardBg: '#150d24',
      cardBorder: '#3b1d6e'
    }
  },
  {
    id: 'byakugan',
    name: 'Byakugan Deep Ocean',
    category: 'Cyberpunk',
    description: 'Abyssal navy depth, electric cyan, and luminous ice blue radiance',
    color: '#0788C9',
    accent: '#36DFFF',
    gradient: ['#0B1729', '#124A72', '#0788C9', '#36DFFF'],
    glow: 'rgba(7,136,201,0.22)',
    rasengan: {
      dark: ['#0788C9', '#36DFFF', '#38BDF8', '#0284C7'],
      light: ['#0369A1', '#0284C7', '#075985', '#0E7490']
    },
    light: {
      bg: '#f0f9ff',
      surface: '#ffffff',
      surfaceHover: '#e0f2fe',
      surfaceActive: '#bae6fd',
      border: '#bae6fd',
      text: '#0f172a',
      textMuted: '#334155',
      cardBg: '#ffffff',
      cardBorder: '#bae6fd'
    },
    dark: {
      bg: '#060f1e',
      surface: '#0b1b36',
      surfaceHover: '#10274e',
      surfaceActive: '#16345f',
      border: '#174075',
      text: '#f8fafc',
      textMuted: '#94a3b8',
      cardBg: '#0b1b36',
      cardBorder: '#174075'
    }
  },
  {
    id: 'konoha-leaf',
    name: 'Konoha Forest Aurora',
    category: 'Cyberpunk',
    description: 'Shadow evergreen canopy, forest emerald, and vivid lime energy',
    color: '#68A82E',
    accent: '#B8FF49',
    gradient: ['#101D13', '#285225', '#68A82E', '#B8FF49'],
    glow: 'rgba(104,168,46,0.22)',
    rasengan: {
      dark: ['#68A82E', '#B8FF49', '#84CC16', '#4D7C0F'],
      light: ['#4D7C0F', '#15803D', '#166534', '#3F6212']
    },
    light: {
      bg: '#f7fee7',
      surface: '#ffffff',
      surfaceHover: '#ecfccb',
      surfaceActive: '#d9f99d',
      border: '#d9f99d',
      text: '#0f172a',
      textMuted: '#334155',
      cardBg: '#ffffff',
      cardBorder: '#d9f99d'
    },
    dark: {
      bg: '#07140b',
      surface: '#0e2415',
      surfaceHover: '#153620',
      surfaceActive: '#1c4429',
      border: '#1f532f',
      text: '#f8fafc',
      textMuted: '#94a3b8',
      cardBg: '#0e2415',
      cardBorder: '#1f532f'
    }
  },
  {
    id: 'rasengan',
    name: 'Rasengan Cosmic Magenta',
    category: 'Cyberpunk',
    description: 'Deep cosmic violet, ultraviolet, vibrant magenta, and energetic orange',
    color: '#D946EF',
    accent: '#FF8748',
    gradient: ['#21102B', '#66245E', '#D946EF', '#FF8748'],
    glow: 'rgba(217,70,239,0.22)',
    rasengan: {
      dark: ['#D946EF', '#FF8748', '#C026D3', '#EA580C'],
      light: ['#A21CAF', '#C2410C', '#86198F', '#9A3412']
    },
    light: {
      bg: '#fdf4ff',
      surface: '#ffffff',
      surfaceHover: '#fae8ff',
      surfaceActive: '#f5d0fe',
      border: '#f5d0fe',
      text: '#0f172a',
      textMuted: '#334155',
      cardBg: '#ffffff',
      cardBorder: '#f5d0fe'
    },
    dark: {
      bg: '#17081c',
      surface: '#260e2e',
      surfaceHover: '#381444',
      surfaceActive: '#4a1959',
      border: '#5b1c70',
      text: '#f8fafc',
      textMuted: '#94a3b8',
      cardBg: '#260e2e',
      cardBorder: '#5b1c70'
    }
  },

  // Hacker — 4 presets
  {
    id: 'sharingan',
    name: 'Sharingan Royal Indigo',
    category: 'Hacker',
    description: 'Midnight cobalt matrix, royal indigo, vivid blue, and electric lavender',
    color: '#4F83FF',
    accent: '#B18CFF',
    gradient: ['#101A35', '#263F8F', '#4F83FF', '#B18CFF'],
    glow: 'rgba(79,131,255,0.22)',
    rasengan: {
      dark: ['#4F83FF', '#B18CFF', '#6366F1', '#818CF8'],
      light: ['#1D4ED8', '#4338CA', '#6D28D9', '#2563EB']
    },
    light: {
      bg: '#eff6ff',
      surface: '#ffffff',
      surfaceHover: '#dbeafe',
      surfaceActive: '#bfdbfe',
      border: '#bfdbfe',
      text: '#0f172a',
      textMuted: '#334155',
      cardBg: '#ffffff',
      cardBorder: '#bfdbfe'
    },
    dark: {
      bg: '#081026',
      surface: '#0f1e45',
      surfaceHover: '#162a61',
      surfaceActive: '#1c3579',
      border: '#23449b',
      text: '#f8fafc',
      textMuted: '#94a3b8',
      cardBg: '#0f1e45',
      cardBorder: '#23449b'
    }
  },
  {
    id: 'hokage-gold',
    name: 'Hokage Crimson Flame',
    category: 'Hacker',
    description: 'Charcoal wine, crimson, scarlet, and flame orange embers',
    color: '#F04452',
    accent: '#FF8A38',
    gradient: ['#251016', '#70202B', '#F04452', '#FF8A38'],
    glow: 'rgba(240,68,82,0.22)',
    rasengan: {
      dark: ['#F04452', '#FF8A38', '#DC2626', '#EA580C'],
      light: ['#B91C1C', '#C2410C', '#991B1B', '#9A3412']
    },
    light: {
      bg: '#fff1f2',
      surface: '#ffffff',
      surfaceHover: '#ffe4e6',
      surfaceActive: '#fecdd3',
      border: '#fecdd3',
      text: '#0f172a',
      textMuted: '#334155',
      cardBg: '#ffffff',
      cardBorder: '#fecdd3'
    },
    dark: {
      bg: '#1a090e',
      surface: '#2b1018',
      surfaceHover: '#3d1723',
      surfaceActive: '#541d2d',
      border: '#691f35',
      text: '#f8fafc',
      textMuted: '#94a3b8',
      cardBg: '#2b1018',
      cardBorder: '#691f35'
    }
  },
  {
    id: 'anbu-shadow',
    name: 'Anbu Abyssal Emerald',
    category: 'Hacker',
    description: 'Deep abyssal green, dark teal, emerald, and phosphorescent mint glow',
    color: '#19B5A5',
    accent: '#65F5D5',
    gradient: ['#0C2525', '#11665E', '#19B5A5', '#65F5D5'],
    glow: 'rgba(25,181,165,0.22)',
    rasengan: {
      dark: ['#19B5A5', '#65F5D5', '#0D9488', '#14B8A6'],
      light: ['#0F766E', '#047857', '#115E59', '#065F46']
    },
    light: {
      bg: '#f0fdfa',
      surface: '#ffffff',
      surfaceHover: '#ccfbf1',
      surfaceActive: '#99f6e4',
      border: '#99f6e4',
      text: '#0f172a',
      textMuted: '#334155',
      cardBg: '#ffffff',
      cardBorder: '#99f6e4'
    },
    dark: {
      bg: '#061717',
      surface: '#0c2626',
      surfaceHover: '#133939',
      surfaceActive: '#184848',
      border: '#1a5453',
      text: '#f8fafc',
      textMuted: '#94a3b8',
      cardBg: '#0c2626',
      cardBorder: '#1a5453'
    }
  },
  {
    id: 'sage-mode',
    name: 'Sage Mode Nebula Orchid',
    category: 'Hacker',
    description: 'Dark plum, orchid, ultraviolet storm, and bright electric cyan',
    color: '#FF42C8',
    accent: '#35E8FF',
    gradient: ['#1C1030', '#633078', '#FF42C8', '#35E8FF'],
    glow: 'rgba(255,66,200,0.22)',
    rasengan: {
      dark: ['#FF42C8', '#35E8FF', '#C026D3', '#06B6D4'],
      light: ['#A21CAF', '#0E7490', '#701A75', '#155E75']
    },
    light: {
      bg: '#faf5ff',
      surface: '#ffffff',
      surfaceHover: '#f3e8ff',
      surfaceActive: '#e9d5ff',
      border: '#d8b4fe',
      text: '#0f172a',
      textMuted: '#334155',
      cardBg: '#ffffff',
      cardBorder: '#f3e8ff'
    },
    dark: {
      bg: '#140822',
      surface: '#220e3a',
      surfaceHover: '#331557',
      surfaceActive: '#431c70',
      border: '#53218f',
      text: '#f8fafc',
      textMuted: '#94a3b8',
      cardBg: '#220e3a',
      cardBorder: '#53218f'
    }
  },

  // General UI modes — 2 presets
  {
    id: 'sound-village',
    name: 'Sound Imperial Bronze',
    category: 'General UI',
    description: 'Deep bronze, antique gold, amber, and luminous pale gold',
    color: '#D9A52E',
    accent: '#FFE477',
    gradient: ['#21190D', '#6B4517', '#D9A52E', '#FFE477'],
    glow: 'rgba(217,165,46,0.22)',
    rasengan: {
      dark: ['#D9A52E', '#FFE477', '#B45309', '#F59E0B'],
      light: ['#92400E', '#B45309', '#78350F', '#A16207']
    },
    light: {
      bg: '#fefce8',
      surface: '#ffffff',
      surfaceHover: '#fef9c3',
      surfaceActive: '#fef08a',
      border: '#fef08a',
      text: '#0f172a',
      textMuted: '#334155',
      cardBg: '#ffffff',
      cardBorder: '#fef08a'
    },
    dark: {
      bg: '#181206',
      surface: '#2a1f0a',
      surfaceHover: '#3c2c0f',
      surfaceActive: '#4d3912',
      border: '#614818',
      text: '#f8fafc',
      textMuted: '#94a3b8',
      cardBg: '#2a1f0a',
      cardBorder: '#614818'
    }
  },
  {
    id: 'akatsuki',
    name: 'Akatsuki Jade Matrix',
    category: 'General UI',
    description: 'Deep jade, dark emerald, vivid jade, and bioluminescent mint',
    color: '#21C98B',
    accent: '#58FFE0',
    gradient: ['#0B211D', '#126447', '#21C98B', '#58FFE0'],
    glow: 'rgba(33,201,139,0.22)',
    rasengan: {
      dark: ['#21C98B', '#58FFE0', '#059669', '#10B981'],
      light: ['#047857', '#0F766E', '#065F46', '#115E59']
    },
    light: {
      bg: '#f0fdf4',
      surface: '#ffffff',
      surfaceHover: '#dcfce7',
      surfaceActive: '#bbf7d0',
      border: '#bbf7d0',
      text: '#0f172a',
      textMuted: '#334155',
      cardBg: '#ffffff',
      cardBorder: '#bbf7d0'
    },
    dark: {
      bg: '#061713',
      surface: '#0d2922',
      surfaceHover: '#143c32',
      surfaceActive: '#194b3f',
      border: '#1d5a4b',
      text: '#f8fafc',
      textMuted: '#94a3b8',
      cardBg: '#0d2922',
      cardBorder: '#1d5a4b'
    }
  }
];

export const THEME_CATEGORIES = ['Cyberpunk', 'Hacker', 'General UI'];

/**
 * Palettes grouped in their canonical category order, preserving declaration order.
 */
export function groupThemes(themes = THEMES) {
  return THEME_CATEGORIES
    .map(category => ({ category, themes: themes.filter(t => t.category === category) }))
    .filter(group => group.themes.length > 0);
}

function loadPersistedTheme() {
  if (typeof window === 'undefined') return { theme: 'sharingan', mode: 'dark' };
  let theme = 'sharingan';
  let mode = 'dark';
  try {
    const themeVal = localStorage.getItem('konoha-theme');
    if (themeVal && THEMES.some(t => t.id === themeVal)) theme = themeVal;
    const modeVal = localStorage.getItem('konoha-appearance-mode');
    if (modeVal === 'dark' || modeVal === 'light') mode = modeVal;
  } catch (_) {
    // Non-fatal
  }
  return { theme, mode };
}

export function createThemeState() {
  let currentTheme = $state('sharingan');
  let currentMode = $state('dark'); // Default is Dark Mode with Sharingan Royal Indigo
  let isModalOpen = $state(false);

  function applyTheme(themeId = currentTheme, mode = currentMode) {
    const found = THEMES.find(t => t.id === themeId) || THEMES.find(t => t.id === 'sharingan') || THEMES[0];
    currentTheme = found.id;
    currentMode = mode === 'dark' ? 'dark' : 'light';
    applyDomTheme(found, currentMode);
  }

  function toggleMode() {
    const nextMode = currentMode === 'light' ? 'dark' : 'light';
    applyTheme(currentTheme, nextMode);
  }

  function setMode(mode) {
    if (mode === 'dark' || mode === 'light') {
      applyTheme(currentTheme, mode);
    }
  }

  function init() {
    const { theme, mode } = loadPersistedTheme();
    applyTheme(theme, mode);
  }

  return {
    get currentTheme() { return currentTheme; },
    get currentMode() { return currentMode; },
    get currentRasengan() {
      const found = THEMES.find(t => t.id === currentTheme) || THEMES[0];
      const isDark = currentMode === 'dark';
      return found.rasengan ? (isDark ? found.rasengan.dark : found.rasengan.light) : [found.color, found.accent, found.color, found.accent];
    },
    get isModalOpen() { return isModalOpen; },
    set isModalOpen(val) { isModalOpen = val; },
    applyTheme,
    toggleMode,
    setMode,
    init,
    themes: THEMES,
    groupedThemes: groupThemes(THEMES)
  };
}

export function getRasenganTokens(themeId, mode = 'light') {
  const found = THEMES.find(t => t.id === themeId) || THEMES[0];
  const isDark = mode === 'dark';
  return found.rasengan ? (isDark ? found.rasengan.dark : found.rasengan.light) : [found.color, found.accent, found.color, found.accent];
}

export const themeState = createThemeState();

if (typeof window !== 'undefined') {
  window.__themeState = themeState;
}
