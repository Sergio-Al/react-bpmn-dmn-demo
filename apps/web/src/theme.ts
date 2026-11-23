import { theme as antdTheme, type ThemeConfig } from 'antd';
import { createContext, useContext, type CSSProperties } from 'react';

export type Mode = 'light' | 'dark';

// Matches the portfolio: Geist for text, Instrument Serif for display, a warm bronze accent.
const fontSans = "'Geist', ui-sans-serif, system-ui, -apple-system, sans-serif";
export const fontMono = "'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace";

/**
 * Role colors. Each role keeps one color everywhere it appears (panels, trace,
 * comparison cards, diagram): rules and policy are neutral, Jev is violet, and
 * the executed path uses the bronze brand color.
 */
const palette = {
  light: {
    brand: '#96612c', bg: '#fafaf9', surface: '#ffffff', border: '#e7e5e4', text: '#0c0a09', textMuted: '#57534e',
    rules: '#57534e', rulesSoft: '#f5f5f4', ai: '#7c3aed', aiSoft: '#f4efff', aiInk: '#5b21b6',
    path: '#96612c', pathSoft: '#f7efe5', grid: '#e7e5e4',
    diagramStroke: '#1c1917', diagramFill: '#ffffff',
  },
  dark: {
    brand: '#dcab6a', bg: '#08090a', surface: '#111214', border: '#26272b', text: '#fafaf9', textMuted: '#a8a29e',
    rules: '#a8a29e', rulesSoft: 'rgba(255,255,255,.06)', ai: '#a78bfa', aiSoft: 'rgba(167,139,250,.13)', aiInk: '#c4b5fd',
    path: '#dcab6a', pathSoft: 'rgba(220,171,106,.14)', grid: '#1f2023',
    diagramStroke: '#d6d3d1', diagramFill: '#141518',
  },
} as const;

export function colors(mode: Mode) { return palette[mode]; }

export function antdThemeFor(mode: Mode): ThemeConfig {
  const c = palette[mode];
  return {
    algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: c.brand,
      // Text on solid primary buttons; the light bronze in dark mode needs dark text for contrast.
      colorTextLightSolid: mode === 'dark' ? '#1c1206' : '#ffffff',
      colorInfo: c.brand,
      colorLink: c.brand,
      colorBgLayout: c.bg,
      colorBgContainer: c.surface,
      colorBorder: c.border,
      colorBorderSecondary: c.border,
      colorText: c.text,
      colorTextSecondary: c.textMuted,
      fontFamily: fontSans,
      fontFamilyCode: fontMono,
      borderRadius: 8,
      borderRadiusLG: 12,
      wireframe: false,
    },
    components: {
      Card: { headerFontSize: 15 },
      Segmented: { itemSelectedBg: c.surface },
      Table: { headerBg: 'transparent' },
      Layout: { headerBg: c.surface, bodyBg: c.bg, headerPadding: '0 24px', headerHeight: 60 },
    },
  };
}

/** Exposes the palette as CSS variables for the custom pieces (diagram, cards, notes). */
export function cssVars(mode: Mode): CSSProperties {
  const c = palette[mode];
  return {
    '--brand': c.brand, '--bg': c.bg, '--surface': c.surface, '--border': c.border, '--text': c.text, '--text-muted': c.textMuted,
    '--rules': c.rules, '--rules-soft': c.rulesSoft, '--ai': c.ai, '--ai-soft': c.aiSoft, '--ai-ink': c.aiInk,
    '--path': c.path, '--path-soft': c.pathSoft, '--grid': c.grid,
    '--font-mono': fontMono, '--font-display': "'Instrument Serif', 'Times New Roman', serif",
  } as CSSProperties;
}

/** bpmn-js draws with inline colors, so they are set when the canvas is created. */
export function bpmnRenderer(mode: Mode) {
  const c = palette[mode];
  return { defaultStrokeColor: c.diagramStroke, defaultFillColor: c.diagramFill, defaultLabelColor: c.diagramStroke };
}

export const ThemeModeContext = createContext<Mode>('light');
export const useThemeMode = () => useContext(ThemeModeContext);
