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

// Relative luminance helpers for palette-driven accent text decisions.
function hexToRgb(hex) {
  const clean = String(hex || '').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value)) return null;
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function luminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Pick a readable accent for decorative header text (>= 3:1 for large text,
 * targeting 4.5:1 where the palette allows it) against the mode surface.
 * The chosen palette accent is preferred; falls back to the secondary gradient
 * stop or muted text so headings never blend into their background.
 */
function readableAccent(found, tokens, isDark) {
  const candidates = isDark
    ? [found.accent, found.color, found.gradient?.[3], found.gradient?.[2]]
    : [found.color, found.gradient?.[2], found.gradient?.[1], tokens.text];
  for (const candidate of candidates) {
    if (candidate && contrastRatio(candidate, tokens.surface) >= 4.5) return candidate;
  }
  for (const candidate of candidates) {
    if (candidate && contrastRatio(candidate, tokens.surface) >= 3) return candidate;
  }
  return tokens.text;
}

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

      // PLAN.md Standardized Semantic Design Tokens
      document.documentElement.style.setProperty('--theme-bg', tokens.bg);
      document.documentElement.style.setProperty('--theme-surface', tokens.surface);
      document.documentElement.style.setProperty('--theme-surface-raised', tokens.cardBg);
      document.documentElement.style.setProperty('--theme-surface-hover', tokens.surfaceHover);
      document.documentElement.style.setProperty('--theme-surface-active', tokens.surfaceActive || tokens.surfaceHover);
      document.documentElement.style.setProperty('--theme-overlay', isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(15, 23, 42, 0.4)');
      document.documentElement.style.setProperty('--theme-text', tokens.text);
      document.documentElement.style.setProperty('--theme-text-secondary', tokens.textMuted);
      // Text-tier token; matches --theme-text-secondary and clears 4.5:1 on surfaces.
      document.documentElement.style.setProperty('--theme-text-muted', tokens.textMuted);
      document.documentElement.style.setProperty('--theme-muted', tokens.textMuted);
      // Secondary text == muted (both >= 4.5:1 on their surfaces); disabled text is
      // explicitly translucent-free and >= 3:1 so form affordances stay perceivable.
      document.documentElement.style.setProperty('--theme-text-disabled', isDark ? '#94a3b8' : '#64748b');
      document.documentElement.style.setProperty('--theme-text-inverse', isDark ? '#0f172a' : '#ffffff');
      document.documentElement.style.setProperty('--theme-border', tokens.border);
      document.documentElement.style.setProperty('--theme-border-strong', isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.25)');
      document.documentElement.style.setProperty('--theme-border-subtle', `color-mix(in srgb, ${tokens.border} 55%, ${tokens.surface})`);
      document.documentElement.style.setProperty('--theme-border-hover', `color-mix(in srgb, ${tokens.border} 70%, ${tokens.textMuted})`);
      // Focus ring (3:1 non-text contrast) and links both derive from the palette
      // but are lifted to a readable accent when the raw palette color is too pale.
      document.documentElement.style.setProperty('--theme-focus', readableAccent(found, tokens, isDark));
      document.documentElement.style.setProperty('--theme-link', isDark ? found.accent : found.color);
      document.documentElement.style.setProperty('--theme-selection', isDark ? 'rgba(56, 189, 248, 0.3)' : 'rgba(2, 132, 199, 0.2)');
      document.documentElement.style.setProperty('--theme-success', '#10b981');
      document.documentElement.style.setProperty('--theme-warning', '#f59e0b');
      document.documentElement.style.setProperty('--theme-danger', '#ef4444');
      document.documentElement.style.setProperty('--theme-info', '#0ea5e9');

      // Canonical 4-Gradient Stops
      if (found.gradient && found.gradient.length >= 4) {
        const [g1, g2, g3, g4] = found.gradient;
        document.documentElement.style.setProperty('--gradient-1', g1);
        document.documentElement.style.setProperty('--gradient-2', g2);
        document.documentElement.style.setProperty('--gradient-3', g3);
        document.documentElement.style.setProperty('--gradient-4', g4);

        // Canonical 4-gradient properties
        document.documentElement.style.setProperty('--theme-gradient-1', g1);
        document.documentElement.style.setProperty('--theme-gradient-2', g2);
        document.documentElement.style.setProperty('--theme-gradient-3', g3);
        document.documentElement.style.setProperty('--theme-gradient-4', g4);

        // Rasengan palette tokens (derived per mode and theme for high-contrast visibility)
        const rasenganStops = found.rasengan
          ? (isDark ? found.rasengan.dark : found.rasengan.light)
          : [g1, g2, g3, g4];
        document.documentElement.style.setProperty('--rasengan-1', rasenganStops[0]);
        document.documentElement.style.setProperty('--rasengan-2', rasenganStops[1]);
        document.documentElement.style.setProperty('--rasengan-3', rasenganStops[2]);
        document.documentElement.style.setProperty('--rasengan-4', rasenganStops[3]);
        document.documentElement.style.setProperty('--bg-login', isDark ? tokens.bg : '#ffffff');

        // Backward compatibility properties
        document.documentElement.style.setProperty('--theme-grad-1', g1);
        document.documentElement.style.setProperty('--theme-grad-2', g2);
        document.documentElement.style.setProperty('--theme-grad-3', g3);
        document.documentElement.style.setProperty('--theme-grad-4', g4);

        // Reusable gradient compositions (all four stops ordered and distinct)
        document.documentElement.style.setProperty('--gradient', `linear-gradient(135deg, ${g1} 0%, ${g2} 33%, ${g3} 66%, ${g4} 100%)`);
        document.documentElement.style.setProperty('--theme-gradient', `linear-gradient(135deg, ${g1} 0%, ${g2} 33%, ${g3} 66%, ${g4} 100%)`);
        document.documentElement.style.setProperty('--theme-glow', found.glow);
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

      // Mode-aware depth tokens (replaces static light-only shadows in dark mode)
      const shadowColor = isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(15, 23, 42, 0.12)';
      const shadowColorSoft = isDark ? 'rgba(0, 0, 0, 0.35)' : 'rgba(15, 23, 42, 0.08)';
      document.documentElement.style.setProperty(
        '--shadow-3d',
        `0 12px 36px -4px ${shadowColor}, 0 8px 18px -4px ${shadowColorSoft}, inset 0 1.5px 0 rgba(255, 255, 255, ${isDark ? '0.12' : '0.95'}), inset 0 -1px 0 rgba(0, 0, 0, ${isDark ? '0.5' : '0.06'})`
      );
      document.documentElement.style.setProperty(
        '--shadow-3d-hover',
        `0 28px 56px -10px ${shadowColor}, 0 14px 28px -6px ${shadowColorSoft}, inset 0 1.5px 0 rgba(255, 255, 255, ${isDark ? '0.18' : '0.95'})`
      );
      document.documentElement.style.setProperty(
        '--glass-edge',
        isDark
          ? 'inset 0 1.5px 0 rgba(255, 255, 255, 0.12), inset 0 -1px 0 rgba(0, 0, 0, 0.5)'
          : 'inset 0 1.5px 0 rgba(255, 255, 255, 0.95), inset 0 -1px 0 rgba(255, 255, 255, 0.4)'
      );
      document.documentElement.style.setProperty(
        '--glass-highlight',
        isDark ? 'inset 0 1px 2px rgba(255, 255, 255, 0.15)' : 'inset 0 1px 2px rgba(255, 255, 255, 0.9)'
      );
      document.documentElement.style.setProperty('--color-primary-glow', isDark ? `color-mix(in srgb, ${found.color} 26%, transparent)` : found.glow);

      // Semantic accents are lifted per palette and mode so status badges stay
      // legible on every surface instead of using one fixed mid-tone for all.
      const semanticSeeds = { success: '#10b981', warning: '#f59e0b', danger: '#ef4444', info: '#0ea5e9' };
      for (const [name, seed] of Object.entries(semanticSeeds)) {
        const readable = contrastRatio(seed, tokens.surface) >= 3;
        document.documentElement.style.setProperty(`--theme-${name}`, readable ? seed : (isDark ? found.accent : tokens.text));
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
