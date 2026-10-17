/* eslint-disable no-undef */
// Svelte 5 Runes State for Konoha 10-Theme System with Explicit Light / Dark Mode

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
    // Light mode tokens
    light: {
      bg: '#fbfaff',
      surface: '#ffffff',
      surfaceHover: '#f5f3ff',
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
    light: {
      bg: '#f0f9ff',
      surface: '#ffffff',
      surfaceHover: '#e0f2fe',
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
    light: {
      bg: '#f7fee7',
      surface: '#ffffff',
      surfaceHover: '#ecfccb',
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
    light: {
      bg: '#fdf4ff',
      surface: '#ffffff',
      surfaceHover: '#fae8ff',
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
    light: {
      bg: '#eff6ff',
      surface: '#ffffff',
      surfaceHover: '#dbeafe',
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
    light: {
      bg: '#fff1f2',
      surface: '#ffffff',
      surfaceHover: '#ffe4e6',
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
    light: {
      bg: '#f0fdfa',
      surface: '#ffffff',
      surfaceHover: '#ccfbf1',
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
    light: {
      bg: '#faf5ff',
      surface: '#ffffff',
      surfaceHover: '#f3e8ff',
      border: '#f3e8ff',
      text: '#0f172a',
      textMuted: '#334155',
      cardBg: '#ffffff',
      cardBorder: '#f3e8ff'
    },
    dark: {
      bg: '#140822',
      surface: '#220e3a',
      surfaceHover: '#331557',
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
    light: {
      bg: '#fefce8',
      surface: '#ffffff',
      surfaceHover: '#fef9c3',
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
    light: {
      bg: '#f0fdf4',
      surface: '#ffffff',
      surfaceHover: '#dcfce7',
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
      border: '#1d5a4b',
      text: '#f8fafc',
      textMuted: '#94a3b8',
      cardBg: '#0d2922',
      cardBorder: '#1d5a4b'
    }
  }
];

export function createThemeState() {
  let currentTheme = $state('byakugan');
  let currentMode = $state('light'); // 'light' | 'dark' — default is Light Mode
  let isModalOpen = $state(false);

  function applyTheme(themeId = currentTheme, mode = currentMode) {
    const found = THEMES.find(t => t.id === themeId) || THEMES[1]; // fallback to byakugan
    currentTheme = found.id;
    currentMode = mode === 'dark' ? 'dark' : 'light';

    if (typeof document !== 'undefined') {
      const isDark = currentMode === 'dark';
      const tokens = isDark ? found.dark : found.light;

      document.documentElement.setAttribute('data-theme', found.id);
      document.documentElement.setAttribute('data-mode', currentMode);

      if (isDark) {
        document.documentElement.classList.add('theme-dark');
        document.documentElement.classList.remove('theme-light');
      } else {
        document.documentElement.classList.add('theme-light');
        document.documentElement.classList.remove('theme-dark');
      }

      // Base Palette Colors
      document.documentElement.style.setProperty('--color-primary', found.color);
      document.documentElement.style.setProperty('--color-accent', found.accent);
      document.documentElement.style.setProperty('--color-primary-glow', found.glow);

      // Mode-specific Surface & Text Tokens
      document.documentElement.style.setProperty('--color-bg', tokens.bg);
      document.documentElement.style.setProperty('--color-surface', tokens.surface);
      document.documentElement.style.setProperty('--color-surface-hover', tokens.surfaceHover);
      document.documentElement.style.setProperty('--color-border', tokens.border);
      document.documentElement.style.setProperty('--color-text', tokens.text);
      document.documentElement.style.setProperty('--color-text-muted', tokens.textMuted);
      document.documentElement.style.setProperty('--color-card-bg', tokens.cardBg);
      document.documentElement.style.setProperty('--color-card-border', tokens.cardBorder);

      // Canonical 4-Gradient Stops
      if (found.gradient && found.gradient.length >= 4) {
        const [g1, g2, g3, g4] = found.gradient;
        document.documentElement.style.setProperty('--gradient-1', g1);
        document.documentElement.style.setProperty('--gradient-2', g2);
        document.documentElement.style.setProperty('--gradient-3', g3);
        document.documentElement.style.setProperty('--gradient-4', g4);

        // Backward compatibility properties
        document.documentElement.style.setProperty('--theme-grad-1', g1);
        document.documentElement.style.setProperty('--theme-grad-2', g2);
        document.documentElement.style.setProperty('--theme-grad-3', g3);
        document.documentElement.style.setProperty('--theme-grad-4', g4);

        // Reusable gradient compositions
        document.documentElement.style.setProperty('--theme-4gradient', `linear-gradient(135deg, ${g1} 0%, ${g2} 33%, ${g3} 66%, ${g4} 100%)`);
        document.documentElement.style.setProperty('--theme-4gradient-bar', `linear-gradient(90deg, ${g1}, ${g2}, ${g3}, ${g4})`);
        document.documentElement.style.setProperty('--theme-4gradient-subtle', `linear-gradient(135deg, ${g1}22 0%, ${g2}22 33%, ${g3}22 66%, ${g4}22 100%)`);

        // Glassmorphism Tint
        const glassTint = isDark
          ? `linear-gradient(135deg, color-mix(in srgb, ${g1} 14%, transparent) 0%, transparent 45%, color-mix(in srgb, ${found.accent} 14%, transparent) 100%)`
          : `linear-gradient(135deg, color-mix(in srgb, ${g1} 7%, transparent) 0%, transparent 45%, color-mix(in srgb, ${found.accent} 7%, transparent) 100%)`;
        document.documentElement.style.setProperty('--glass-tint', glassTint);

        // Sidebar & Header Dynamic Surfaces
        document.documentElement.style.setProperty(
          '--theme-sidebar-bg',
          `linear-gradient(180deg, color-mix(in srgb, ${g1} ${isDark ? '18%' : '10%'}, ${tokens.surface}) 0%, color-mix(in srgb, ${g2} ${isDark ? '12%' : '6%'}, ${tokens.surface}) 35%, color-mix(in srgb, ${g3} ${isDark ? '12%' : '6%'}, ${tokens.surface}) 70%, color-mix(in srgb, ${g4} ${isDark ? '20%' : '12%'}, ${tokens.surface}) 100%)`
        );
        document.documentElement.style.setProperty(
          '--theme-sidebar-header-bg',
          `linear-gradient(135deg, color-mix(in srgb, ${g1} ${isDark ? '25%' : '16%'}, ${tokens.surface}) 0%, color-mix(in srgb, ${g3} ${isDark ? '15%' : '8%'}, ${tokens.surface}) 100%)`
        );
        document.documentElement.style.setProperty(
          '--theme-sidebar-footer-bg',
          `linear-gradient(0deg, color-mix(in srgb, ${g4} ${isDark ? '22%' : '14%'}, ${tokens.surface}) 0%, color-mix(in srgb, ${g1} ${isDark ? '12%' : '6%'}, ${tokens.surface}) 100%)`
        );
        document.documentElement.style.setProperty(
          '--theme-header-bg',
          `linear-gradient(90deg, color-mix(in srgb, ${g1} ${isDark ? '18%' : '10%'}, ${tokens.surface}) 0%, color-mix(in srgb, ${g2} ${isDark ? '12%' : '7%'}, ${tokens.surface}) 30%, color-mix(in srgb, ${g3} ${isDark ? '12%' : '7%'}, ${tokens.surface}) 70%, color-mix(in srgb, ${g4} ${isDark ? '18%' : '12%'}, ${tokens.surface}) 100%)`
        );

        // Interactive 3D Elements
        document.documentElement.style.setProperty('--theme-btn-3d-bg', `linear-gradient(135deg, ${g1} 0%, ${g2} 33%, ${g3} 66%, ${g4} 100%)`);
        document.documentElement.style.setProperty(
          '--theme-btn-3d-shadow',
          `0 6px 18px -2px color-mix(in srgb, ${g1} ${isDark ? '60%' : '42%'}, transparent), 0 2px 6px -1px color-mix(in srgb, ${g2} 25%, transparent), inset 0 1px 0 rgba(255, 255, 255, ${isDark ? '0.2' : '0.45'})`
        );
        document.documentElement.style.setProperty(
          '--theme-btn-3d-hover-shadow',
          `0 10px 24px -3px color-mix(in srgb, ${g1} ${isDark ? '75%' : '55%'}, transparent), 0 4px 10px -2px color-mix(in srgb, ${g2} 35%, transparent), inset 0 1px 0 rgba(255, 255, 255, ${isDark ? '0.35' : '0.65'})`
        );

        // Modal Styling
        document.documentElement.style.setProperty('--theme-modal-border', `color-mix(in srgb, ${g1} ${isDark ? '50%' : '38%'}, ${tokens.border})`);
        document.documentElement.style.setProperty(
          '--theme-modal-shadow',
          isDark
            ? `0 25px 60px -12px rgba(0, 0, 0, 0.75), 0 12px 24px -6px rgba(0, 0, 0, 0.5), inset 0 1.5px 0 rgba(255, 255, 255, 0.1)`
            : `0 25px 60px -12px color-mix(in srgb, ${g1} 22%, rgba(15, 23, 42, 0.28)), 0 12px 24px -6px color-mix(in srgb, ${g2} 12%, rgba(15, 23, 42, 0.15)), inset 0 1.5px 0 rgba(255, 255, 255, 1)`
        );

        // Badge styling
        document.documentElement.style.setProperty('--theme-badge-subtle-bg', `linear-gradient(135deg, color-mix(in srgb, ${g1} ${isDark ? '24%' : '14%'}, ${tokens.surface}) 0%, color-mix(in srgb, ${g3} ${isDark ? '16%' : '8%'}, ${tokens.surface}) 100%)`);
        document.documentElement.style.setProperty('--theme-badge-subtle-border', `color-mix(in srgb, ${g1} ${isDark ? '45%' : '30%'}, ${tokens.border})`);
        document.documentElement.style.setProperty('--theme-badge-subtle-text', isDark ? found.accent : g1);
      }

      // Persist independently
      try {
        localStorage.setItem('konoha-theme', found.id);
        localStorage.setItem('konoha-appearance-mode', currentMode);
      } catch (_) {
        // Ignore localStorage errors
      }
    }
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
    if (typeof window !== 'undefined') {
      let savedTheme = 'byakugan';
      let savedMode = 'light'; // Default is strictly Light Mode

      try {
        const themeVal = localStorage.getItem('konoha-theme');
        if (themeVal && THEMES.some(t => t.id === themeVal)) {
          savedTheme = themeVal;
        }
        const modeVal = localStorage.getItem('konoha-appearance-mode');
        if (modeVal === 'dark' || modeVal === 'light') {
          savedMode = modeVal;
        }
      } catch (_) {
        // Fallback to default
      }

      applyTheme(savedTheme, savedMode);
    }
  }

  return {
    get currentTheme() { return currentTheme; },
    get currentMode() { return currentMode; },
    get isModalOpen() { return isModalOpen; },
    set isModalOpen(val) { isModalOpen = val; },
    applyTheme,
    toggleMode,
    setMode,
    init,
    themes: THEMES
  };
}

export const themeState = createThemeState();
