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

export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function readableAccent(found, tokens, isDark) {
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

export function computeGaugeTokens(found, tokens, isDark) {
  if (isDark) {
    const gaugeTrack = `color-mix(in srgb, ${tokens.border} 20%, rgba(255, 255, 255, 0.58))`;
    const arcCandidates = [found.accent, found.gradient?.[3], found.color, found.gradient?.[2], '#38bdf8'].filter(Boolean);
    const gaugeArcStart = arcCandidates.find(c => contrastRatio(c, tokens.surface) >= 3.5) || found.accent || '#38bdf8';
    const gaugeArcEnd = found.accent || found.gradient?.[3] || '#36dfff';
    return { gaugeTrack, gaugeArcStart, gaugeArcEnd };
  }
  const gaugeTrack = `color-mix(in srgb, ${tokens.border} 20%, #475569)`;
  const arcCandidates = [found.color, found.gradient?.[1], found.gradient?.[0], '#0f172a'].filter(Boolean);
  const gaugeArcStart = arcCandidates.find(c => contrastRatio(c, '#ffffff') >= 3.5) || found.color || '#0284c7';
  const gaugeArcEnd = found.gradient?.[0] || found.color || '#0369a1';
  return { gaugeTrack, gaugeArcStart, gaugeArcEnd };
}

function applyDomClasses(found, currentMode, isDark) {
  const root = document.documentElement;
  root.setAttribute('data-theme', found.id);
  root.setAttribute('data-mode', currentMode);

  if (isDark) {
    root.classList.add('theme-dark');
    root.classList.remove('theme-light');
  } else {
    root.classList.add('theme-light');
    root.classList.remove('theme-dark');
  }
}

function applyBaseSurfaceTokens(found, tokens, isDark) {
  const root = document.documentElement;
  root.style.setProperty('--color-primary', found.color);
  root.style.setProperty('--color-accent', found.accent);
  root.style.setProperty('--color-primary-glow', found.glow);
  root.style.setProperty('--color-bg', tokens.bg);
  root.style.setProperty('--color-surface', tokens.surface);
  root.style.setProperty('--color-surface-hover', tokens.surfaceHover);
  root.style.setProperty('--color-border', tokens.border);
  root.style.setProperty('--color-text', tokens.text);
  root.style.setProperty('--color-text-muted', tokens.textMuted);
  root.style.setProperty('--color-card-bg', tokens.cardBg);
  root.style.setProperty('--color-card-border', tokens.cardBorder);

  root.style.setProperty('--theme-bg', tokens.bg);
  root.style.setProperty('--theme-surface', tokens.surface);
  root.style.setProperty('--theme-surface-glass', `color-mix(in srgb, ${tokens.surface} ${isDark ? '94%' : '96%'}, transparent)`);
  root.style.setProperty('--theme-surface-raised', tokens.cardBg);
  root.style.setProperty('--theme-surface-hover', tokens.surfaceHover);
  root.style.setProperty('--theme-surface-active', tokens.surfaceActive || tokens.surfaceHover);
  root.style.setProperty('--theme-overlay', isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(15, 23, 42, 0.4)');
  root.style.setProperty('--theme-text', tokens.text);
  root.style.setProperty('--theme-text-secondary', tokens.textMuted);
  root.style.setProperty('--theme-text-muted', tokens.textMuted);
  root.style.setProperty('--theme-muted', tokens.textMuted);
  root.style.setProperty('--theme-text-disabled', isDark ? '#94a3b8' : '#64748b');
  root.style.setProperty('--theme-text-inverse', isDark ? '#0f172a' : '#ffffff');
  root.style.setProperty('--theme-border', tokens.border);
  root.style.setProperty('--theme-border-strong', isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.25)');
  root.style.setProperty('--theme-border-subtle', `color-mix(in srgb, ${tokens.border} 55%, ${tokens.surface})`);
  root.style.setProperty('--theme-border-hover', `color-mix(in srgb, ${tokens.border} 70%, ${tokens.textMuted})`);
  root.style.setProperty('--theme-focus', readableAccent(found, tokens, isDark));
  root.style.setProperty('--theme-link', isDark ? found.accent : found.color);
  root.style.setProperty('--theme-selection', isDark ? 'rgba(56, 189, 248, 0.3)' : 'rgba(2, 132, 199, 0.2)');
  root.style.setProperty('--theme-success', '#10b981');
  root.style.setProperty('--theme-warning', '#f59e0b');
  root.style.setProperty('--theme-danger', '#ef4444');
  root.style.setProperty('--theme-info', '#0ea5e9');
}

function applyGradientPalette(found, tokens, isDark) {
  if (!found.gradient || found.gradient.length < 4) return;
  const root = document.documentElement;
  const [g1, g2, g3, g4] = found.gradient;
  root.style.setProperty('--gradient-1', g1);
  root.style.setProperty('--gradient-2', g2);
  root.style.setProperty('--gradient-3', g3);
  root.style.setProperty('--gradient-4', g4);
  root.style.setProperty('--theme-gradient-1', g1);
  root.style.setProperty('--theme-gradient-2', g2);
  root.style.setProperty('--theme-gradient-3', g3);
  root.style.setProperty('--theme-gradient-4', g4);

  const rasenganStops = found.rasengan
    ? (isDark ? found.rasengan.dark : found.rasengan.light)
    : [g1, g2, g3, g4];
  root.style.setProperty('--rasengan-1', rasenganStops[0]);
  root.style.setProperty('--rasengan-2', rasenganStops[1]);
  root.style.setProperty('--rasengan-3', rasenganStops[2]);
  root.style.setProperty('--rasengan-4', rasenganStops[3]);
  root.style.setProperty('--bg-login', isDark ? tokens.bg : '#ffffff');

  root.style.setProperty('--theme-grad-1', g1);
  root.style.setProperty('--theme-grad-2', g2);
  root.style.setProperty('--theme-grad-3', g3);
  root.style.setProperty('--theme-grad-4', g4);
  root.style.setProperty('--gradient', `linear-gradient(135deg, ${g1} 0%, ${g2} 33%, ${g3} 66%, ${g4} 100%)`);
  root.style.setProperty('--theme-gradient', `linear-gradient(135deg, ${g1} 0%, ${g2} 33%, ${g3} 66%, ${g4} 100%)`);
  root.style.setProperty('--theme-glow', found.glow);
  root.style.setProperty('--theme-4gradient', `linear-gradient(135deg, ${g1} 0%, ${g2} 33%, ${g3} 66%, ${g4} 100%)`);
  root.style.setProperty('--theme-4gradient-bar', `linear-gradient(90deg, ${g1}, ${g2}, ${g3}, ${g4})`);
  root.style.setProperty('--theme-4gradient-subtle', `linear-gradient(135deg, ${g1}22 0%, ${g2}22 33%, ${g3}22 66%, ${g4}22 100%)`);

  const glassTint = isDark
    ? `linear-gradient(135deg, color-mix(in srgb, ${g1} 14%, transparent) 0%, transparent 45%, color-mix(in srgb, ${found.accent} 14%, transparent) 100%)`
    : `linear-gradient(135deg, color-mix(in srgb, ${g1} 7%, transparent) 0%, transparent 45%, color-mix(in srgb, ${found.accent} 7%, transparent) 100%)`;
  root.style.setProperty('--glass-tint', glassTint);

  root.style.setProperty(
    '--theme-sidebar-bg',
    `linear-gradient(180deg, color-mix(in srgb, ${g1} ${isDark ? '18%' : '10%'}, ${tokens.surface}) 0%, color-mix(in srgb, ${g2} ${isDark ? '12%' : '6%'}, ${tokens.surface}) 35%, color-mix(in srgb, ${g3} ${isDark ? '12%' : '6%'}, ${tokens.surface}) 70%, color-mix(in srgb, ${g4} ${isDark ? '20%' : '12%'}, ${tokens.surface}) 100%)`
  );
  root.style.setProperty(
    '--theme-sidebar-header-bg',
    `linear-gradient(135deg, color-mix(in srgb, ${g1} ${isDark ? '25%' : '16%'}, ${tokens.surface}) 0%, color-mix(in srgb, ${g3} ${isDark ? '15%' : '8%'}, ${tokens.surface}) 100%)`
  );
  root.style.setProperty(
    '--theme-sidebar-footer-bg',
    `linear-gradient(0deg, color-mix(in srgb, ${g4} ${isDark ? '22%' : '14%'}, ${tokens.surface}) 0%, color-mix(in srgb, ${g1} ${isDark ? '12%' : '6%'}, ${tokens.surface}) 100%)`
  );
  root.style.setProperty(
    '--theme-header-bg',
    `linear-gradient(90deg, color-mix(in srgb, ${g1} ${isDark ? '18%' : '10%'}, ${tokens.surface}) 0%, color-mix(in srgb, ${g2} ${isDark ? '12%' : '7%'}, ${tokens.surface}) 30%, color-mix(in srgb, ${g3} ${isDark ? '12%' : '7%'}, ${tokens.surface}) 70%, color-mix(in srgb, ${g4} ${isDark ? '18%' : '12%'}, ${tokens.surface}) 100%)`
  );

  root.style.setProperty('--theme-btn-3d-bg', `linear-gradient(135deg, ${g1} 0%, ${g2} 33%, ${g3} 66%, ${g4} 100%)`);
  root.style.setProperty(
    '--theme-btn-3d-shadow',
    `0 6px 18px -2px color-mix(in srgb, ${g1} ${isDark ? '60%' : '42%'}, transparent), 0 2px 6px -1px color-mix(in srgb, ${g2} 25%, transparent), inset 0 1px 0 rgba(255, 255, 255, ${isDark ? '0.2' : '0.45'})`
  );
  root.style.setProperty(
    '--theme-btn-3d-hover-shadow',
    `0 10px 24px -3px color-mix(in srgb, ${g1} ${isDark ? '75%' : '55%'}, transparent), 0 4px 10px -2px color-mix(in srgb, ${g2} 35%, transparent), inset 0 1px 0 rgba(255, 255, 255, ${isDark ? '0.35' : '0.65'})`
  );

  root.style.setProperty('--theme-modal-border', `color-mix(in srgb, ${g1} ${isDark ? '50%' : '38%'}, ${tokens.border})`);
  root.style.setProperty(
    '--theme-modal-shadow',
    isDark
      ? `0 25px 60px -12px rgba(0, 0, 0, 0.75), 0 12px 24px -6px rgba(0, 0, 0, 0.5), inset 0 1.5px 0 rgba(255, 255, 255, 0.1)`
      : `0 25px 60px -12px color-mix(in srgb, ${g1} 22%, rgba(15, 23, 42, 0.28)), 0 12px 24px -6px color-mix(in srgb, ${g2} 12%, rgba(15, 23, 42, 0.15)), inset 0 1.5px 0 rgba(255, 255, 255, 1)`
  );

  root.style.setProperty('--theme-badge-subtle-bg', `linear-gradient(135deg, color-mix(in srgb, ${g1} ${isDark ? '24%' : '14%'}, ${tokens.surface}) 0%, color-mix(in srgb, ${g3} ${isDark ? '16%' : '8%'}, ${tokens.surface}) 100%)`);
  root.style.setProperty('--theme-badge-subtle-border', `color-mix(in srgb, ${g1} ${isDark ? '45%' : '30%'}, ${tokens.border})`);
  root.style.setProperty('--theme-badge-subtle-text', isDark ? found.accent : g1);
}

function applyCardAndShadowTokens(found, tokens, isDark) {
  const root = document.documentElement;
  const crumbActive = isDark
    ? (contrastRatio(found.accent, tokens.surface) >= 4.5 ? found.accent : tokens.text)
    : (contrastRatio(found.color, tokens.surface) >= 4.5 ? found.color : tokens.text);
  root.style.setProperty('--theme-crumb-active', crumbActive);
  root.style.setProperty('--theme-crumb-parent', isDark ? '#cbd5e1' : '#334155');
  root.style.setProperty('--theme-crumb-separator', isDark ? '#cbd5e1' : '#64748b');

  const { gaugeTrack, gaugeArcStart, gaugeArcEnd } = computeGaugeTokens(found, tokens, isDark);
  root.style.setProperty('--theme-gauge-track', gaugeTrack);
  root.style.setProperty('--theme-gauge-arc-start', gaugeArcStart);
  root.style.setProperty('--theme-gauge-arc-end', gaugeArcEnd);

  const shadowColor = isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(15, 23, 42, 0.12)';
  const shadowColorSoft = isDark ? 'rgba(0, 0, 0, 0.35)' : 'rgba(15, 23, 42, 0.08)';
  root.style.setProperty(
    '--shadow-3d',
    `0 12px 36px -4px ${shadowColor}, 0 8px 18px -4px ${shadowColorSoft}, inset 0 1.5px 0 rgba(255, 255, 255, ${isDark ? '0.12' : '0.95'}), inset 0 -1px 0 rgba(0, 0, 0, ${isDark ? '0.5' : '0.06'})`
  );
  root.style.setProperty(
    '--shadow-3d-hover',
    `0 28px 56px -10px ${shadowColor}, 0 14px 28px -6px ${shadowColorSoft}, inset 0 1.5px 0 rgba(255, 255, 255, ${isDark ? '0.18' : '0.95'})`
  );
  root.style.setProperty(
    '--glass-edge',
    isDark
      ? 'inset 0 1.5px 0 rgba(255, 255, 255, 0.12), inset 0 -1px 0 rgba(0, 0, 0, 0.5)'
      : 'inset 0 1.5px 0 rgba(255, 255, 255, 0.95), inset 0 -1px 0 rgba(255, 255, 255, 0.4)'
  );
  root.style.setProperty(
    '--glass-highlight',
    isDark ? 'inset 0 1px 2px rgba(255, 255, 255, 0.15)' : 'inset 0 1px 2px rgba(255, 255, 255, 0.9)'
  );
  root.style.setProperty('--color-primary-glow', isDark ? `color-mix(in srgb, ${found.color} 26%, transparent)` : found.glow);

  const semanticSeeds = { success: '#10b981', warning: '#f59e0b', danger: '#ef4444', info: '#0ea5e9' };
  for (const [name, seed] of Object.entries(semanticSeeds)) {
    const readable = contrastRatio(seed, tokens.surface) >= 3;
    root.style.setProperty(`--theme-${name}`, readable ? seed : (isDark ? found.accent : tokens.text));
  }
}

export function applyDomTheme(found, currentMode) {
  if (typeof document === 'undefined') return;
  const isDark = currentMode === 'dark';
  const tokens = isDark ? found.dark : found.light;

  applyDomClasses(found, currentMode, isDark);
  applyBaseSurfaceTokens(found, tokens, isDark);
  applyGradientPalette(found, tokens, isDark);
  applyCardAndShadowTokens(found, tokens, isDark);

  try {
    localStorage.setItem('konoha-theme', found.id);
    localStorage.setItem('konoha-appearance-mode', currentMode);
  } catch (_) {
    // Non-fatal
  }
}
