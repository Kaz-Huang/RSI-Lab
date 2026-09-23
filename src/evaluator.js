// The evaluator accepts a coherent design move instead of forcing every release
// to be a one-property readability nudge. A design move can change the visual
// language, layout, spacing and type together, while the runtime still renders
// only values from this finite, code-owned design vocabulary.
export const DEFAULT_DESIGN = 'quiet-garden';
export const DESIGN_PRESETS = Object.freeze({
  'quiet-garden': Object.freeze({
    label: 'Quiet Garden', layout: 'classic', bg: '#f5f7f0', surface: '#ffffff', ink: '#20362a', muted: '#5d6d57', accent: '#4d7040', accentSoft: '#e4ebd8', border: '#e0e6d9', rule: '#dbe3d1', radius: 16, articlePadding: 34, mainWidth: 900, heroSize: 'clamp(38px,7vw,66px)', heroTracking: '-3px', displayFont: '-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif', shadow: 'none'
  }),
  'editorial-pulse': Object.freeze({
    label: 'Editorial Pulse', layout: 'editorial', bg: '#f3ede5', surface: '#fffdf8', ink: '#2d241f', muted: '#7c6b5e', accent: '#b14d31', accentSoft: '#f5d9cf', border: '#e2d2c7', rule: '#d8c4b8', radius: 6, articlePadding: 50, mainWidth: 1080, heroSize: 'clamp(48px,8vw,86px)', heroTracking: '-5px', displayFont: 'Georgia,"Songti SC",serif', shadow: '0 18px 40px rgba(100,55,35,.10)'
  }),
  'cobalt-brief': Object.freeze({
    label: 'Cobalt Brief', layout: 'cobalt', bg: '#edf2fb', surface: '#ffffff', ink: '#17243b', muted: '#647493', accent: '#315faa', accentSoft: '#dae6ff', border: '#cbd8ef', rule: '#c8d4e8', radius: 28, articlePadding: 44, mainWidth: 1040, heroSize: 'clamp(42px,7vw,76px)', heroTracking: '-4px', displayFont: '-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif', shadow: '0 18px 46px rgba(43,68,122,.12)'
  }),
  'signal-mint': Object.freeze({
    label: 'Signal Mint', layout: 'signal', bg: '#eaf5f1', surface: '#fbfffd', ink: '#12382f', muted: '#5d8178', accent: '#0f766a', accentSoft: '#cbeee4', border: '#c4e0d7', rule: '#c0ddd4', radius: 12, articlePadding: 42, mainWidth: 980, heroSize: 'clamp(42px,7vw,72px)', heroTracking: '-3px', displayFont: '-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif', shadow: '0 16px 34px rgba(15,118,106,.12)'
  }),
  'sunset-notes': Object.freeze({
    label: 'Sunset Notes', layout: 'sunset', bg: '#fff0e5', surface: '#fffaf4', ink: '#45231b', muted: '#8f675b', accent: '#cf5b34', accentSoft: '#ffd9c6', border: '#efc6b2', rule: '#ecc0aa', radius: 18, articlePadding: 40, mainWidth: 960, heroSize: 'clamp(42px,7vw,72px)', heroTracking: '-3px', displayFont: 'Georgia,"Songti SC",serif', shadow: '0 16px 36px rgba(160,74,40,.12)'
  })
});

export const BASELINE = Object.freeze({ textColor: '#86927a', fontSize: 12, lineHeight: 1.5, design: DEFAULT_DESIGN });
export const POLICY = 'design-evolution-v2';
export const ADAPTIVE_DESIGN = 'adaptive';
const CONFIG_KEYS = new Set(['textColor', 'fontSize', 'lineHeight', 'design', 'theme']);
const FONT_STYLES = Object.freeze({ sans: '-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif', serif: 'Georgia,"Songti SC",serif', mono: 'ui-monospace,SFMono-Regular,Menlo,monospace' });
const LAYOUTS = new Set(['classic', 'editorial', 'cobalt', 'signal', 'sunset']);
const SHADOWS = new Set(['none', 'soft', 'deep']);

function safeCopy(value, fallback, max = 42) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[<>`\\]/.test(value) ? value : fallback;
}

export function validTheme(theme) {
  if (!theme || typeof theme !== 'object') return false;
  const colors = ['bg', 'surface', 'ink', 'muted', 'accent', 'accentSoft', 'border', 'rule'];
  return Boolean(colors.every(key => /^#[0-9a-f]{6}$/i.test(theme[key]))
    && LAYOUTS.has(theme.layout) && SHADOWS.has(theme.shadow) && ['sans', 'serif', 'mono'].includes(theme.fontStyle)
    && Number.isInteger(theme.radius) && theme.radius >= 0 && theme.radius <= 36
    && Number.isInteger(theme.articlePadding) && theme.articlePadding >= 22 && theme.articlePadding <= 72
    && Number.isInteger(theme.mainWidth) && theme.mainWidth >= 800 && theme.mainWidth <= 1240
    && Number.isFinite(theme.heroScale) && theme.heroScale >= 0.8 && theme.heroScale <= 1.4
    && safeCopy(theme.label, '', 30) && safeCopy(theme.visualKicker, '', 34)
    && safeCopy(theme.visualTitle, '', 90) && safeCopy(theme.visualBody, '', 80));
}

export function themeForConfig(config = {}) {
  const c = normalizeConfig(config);
  if (c.design === ADAPTIVE_DESIGN && validTheme(c.theme)) {
    const t = c.theme;
    const scale = t.heroScale;
    return {
      ...t,
      heroSize: `clamp(${Math.round(38 * scale)}px,${(7 * scale).toFixed(2)}vw,${Math.round(66 * scale)}px)`,
      heroTracking: `${Math.round(-3 * scale)}px`,
      displayFont: FONT_STYLES[t.fontStyle],
      shadow: t.shadow === 'none' ? 'none' : t.shadow === 'deep' ? '0 18px 46px rgba(20,35,30,.16)' : '0 14px 32px rgba(20,35,30,.10)'
    };
  }
  return DESIGN_PRESETS[c.design] || DESIGN_PRESETS[DEFAULT_DESIGN];
}

export function normalizeConfig(config = {}) {
  return { ...BASELINE, ...config, design: config.design || DEFAULT_DESIGN };
}

function luminance(hex) {
  const rgb = hex.slice(1).match(/.{2}/g).map(v => parseInt(v, 16) / 255);
  const linear = rgb.map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrast(hex, background = '#ffffff') {
  const a = luminance(hex), b = luminance(background);
  return +(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2));
}

export function validConfig(config) {
  if (!config || typeof config !== 'object') return false;
  const keys = Object.keys(config);
  if (keys.some(key => !CONFIG_KEYS.has(key)) || !['textColor', 'fontSize', 'lineHeight'].every(key => key in config)) return false;
  const c = normalizeConfig(config);
  return /^#[0-9a-f]{6}$/i.test(c.textColor)
    && Number.isFinite(c.fontSize) && c.fontSize >= 12 && c.fontSize <= 22
    && Number.isFinite(c.lineHeight) && c.lineHeight >= 1.4 && c.lineHeight <= 2.2
    && (Object.hasOwn(DESIGN_PRESETS, c.design) || (c.design === ADAPTIVE_DESIGN && validTheme(c.theme)));
}

export function measure(config) {
  const c = normalizeConfig(config);
  const theme = themeForConfig(c);
  return [
    { key: 'contrast', label: '正文文字对比度', value: contrast(c.textColor, theme.surface), target: 4.5, unit: ':1', source: '相对亮度公式 · 当前页面背景' },
    { key: 'fontSize', label: '正文基础字号', value: c.fontSize, target: 16, unit: 'px', source: '项目阅读规则 · 非强制字号' },
    { key: 'lineHeight', label: '正文行高', value: c.lineHeight, target: 1.8, unit: '×', source: '项目长文阅读规则' }
  ].map(m => ({ ...m, pass: m.value >= m.target }));
}

export function evaluate(base, candidate) {
  if (!validConfig(base) || !validConfig(candidate)) return { policy: POLICY, pass: false, gates: [{ label: '配置范围与设计词汇', pass: false }], metrics: [] };
  const beforeConfig = normalizeConfig(base), afterConfig = normalizeConfig(candidate);
  const before = measure(beforeConfig), after = measure(afterConfig);
  const changed = Object.keys({ ...beforeConfig, ...afterConfig }).filter(key => beforeConfig[key] !== afterConfig[key]);
  const designChange = changed.includes('design') || changed.includes('theme');
  const gates = [
    { label: designChange ? '整套设计方案来自允许的设计词汇' : '本轮只改一个阅读参数', pass: designChange ? changed.length <= 5 : changed.length === 1 },
    { label: designChange ? '改版后的可读性仍在底线之上' : '可读性指标不退化', pass: designChange ? after.every(m => m.pass) : after.every((m, i) => m.value >= before[i].value) },
    { label: designChange ? '确实产生可见的整体改版' : '至少解决一个未达标项', pass: designChange ? true : after.some((m, i) => m.pass && !before[i].pass) },
    { label: '页面仍使用受控配置', pass: validConfig(candidate) }
  ];
  return { policy: POLICY, pass: gates.every(g => g.pass), changed, designChange, gates, metrics: after.map((m, i) => ({ ...m, before: before[i].value })) };
}
