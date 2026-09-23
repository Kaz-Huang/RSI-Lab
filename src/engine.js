import { ADAPTIVE_DESIGN, BASELINE, POLICY, evaluate, measure, normalizeConfig, validConfig } from './evaluator.js';

export const AUTONOMY_POLICY = 'autonomous-design-v3';
export const AUTONOMY_DEFAULTS = Object.freeze({
  enabled: true,
  policy: AUTONOMY_POLICY,
  release: 'automatic',
  requiresHumanApproval: false,
  maxRuns: 200,
  maxChangesPerWake: 1,
  generator: 'workers-ai-with-procedural-fallback',
  failSafe: 'preserve-version-and-pause'
});
export const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export const initialState = () => ({
  paused: false, mode: 'autonomous', autonomy: { ...AUTONOMY_DEFAULTS }, currentVersion: 'v001', policy: POLICY,
  versions: [{ id: 'v001', config: { ...BASELINE }, createdAt: new Date().toISOString(), reason: '原始提案阅读样式基线', runId: null }],
  runs: [], memory: [], audit: []
});

export function current(s) { return s.versions.find(v => v.id === s.currentVersion); }

export function normalizeState(s) {
  if (!s.mode) s.mode = 'autonomous';
  s.autonomy = { ...AUTONOMY_DEFAULTS, ...(s.autonomy || {}), policy: AUTONOMY_POLICY, release: 'automatic', requiresHumanApproval: false, generator: AUTONOMY_DEFAULTS.generator };
  s.policy = POLICY;
  s.versions = (s.versions || []).map(v => ({ ...v, config: normalizeConfig(v.config) }));
  return s;
}

function requireThat(ok, message, status = 409) { if (!ok) throw Object.assign(new Error(message), { status }); }
function audit(s, action, detail) { s.audit.unshift({ id: crypto.randomUUID(), action, detail, at: new Date().toISOString() }); }
function memoryKey(run) { return run.change?.key === 'design' ? `design:${run.change.value}` : (run.change?.key || null); }
function remember(s, run, outcome, note) {
  s.memory.unshift({ id: crypto.randomUUID(), runId: run.id, key: memoryKey(run), outcome, note, at: new Date().toISOString(), policy: POLICY });
}

function hash(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function hslToHex(h, s, l) {
  const saturation = s / 100, lightness = l / 100;
  const a = saturation * Math.min(lightness, 1 - lightness);
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = lightness - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
function short(value, fallback, max) {
  return typeof value === 'string' && value.trim() && value.length <= max && !/[<>`\\]/.test(value) ? value.trim() : fallback;
}
function boundedInteger(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}
function boundedNumber(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function safeHex(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^#?[0-9a-f]{6}$/i.test(text) ? `#${text.replace(/^#/, '')}` : fallback;
}

function proceduralProposal(s, base, requestId) {
  const seed = hash(`${requestId}|${s.currentVersion}|${s.runs.length}|${s.memory.length}`);
  const hue = seed % 360;
  const accent = hslToHex(hue, 58, 36);
  const body = hslToHex((hue + 8) % 360, 42, 24);
  const bg = hslToHex(hue, 24, 96);
  const surface = hslToHex((hue + 8) % 360, 18, 99);
  const accentSoft = hslToHex(hue, 35, 90);
  const border = hslToHex(hue, 22, 84);
  const rule = hslToHex(hue, 20, 80);
  const layouts = ['classic', 'editorial', 'cobalt', 'signal', 'sunset'];
  const fonts = ['sans', 'serif', 'mono'];
  const layout = layouts[seed % layouts.length];
  const fontStyle = fonts[(seed >>> 4) % fonts.length];
  const label = `Adaptive ${String(seed).slice(-4)}`;
  const theme = {
    label, layout, bg, surface, ink: body, muted: hslToHex(hue, 24, 38), accent, accentSoft, border, rule,
    radius: 6 + (seed % 28), articlePadding: 28 + (seed % 36), mainWidth: 860 + (seed % 340), heroScale: 0.9 + ((seed >>> 8) % 46) / 100,
    fontStyle, shadow: ['none', 'soft', 'deep'][(seed >>> 12) % 3],
    visualKicker: `AUTONOMY / ${String(seed).slice(-4)}`,
    visualTitle: ['A NEW\nSHAPE FOR\nREADING.', 'MAKE ROOM\nFOR THE\nNEXT IDEA.', 'THE PAGE\nKEEPS\nMOVING.'][seed % 3],
    visualBody: 'generated from the current page, its memory and this cycle'
  };
  return {
    key: 'design', value: `adaptive-${seed}`, generator: 'procedural-fallback',
    title: '系统生成了一套新的视觉方向',
    hypothesis: `根据当前页面与历史记录，生成 ${label}：重新组合色彩、布局、字体和留白。`,
    reason: '模型不可用或输出不合规，系统使用当前状态生成了新的视觉候选。',
    patch: { design: ADAPTIVE_DESIGN, theme, textColor: body, fontSize: 16 + (seed % 4), lineHeight: 1.8 + ((seed >>> 16) % 4) / 20 },
    baseVersion: base.id
  };
}

function extractJson(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

function aiProposal(raw, base) {
  const p = raw && typeof raw === 'object' ? raw : extractJson(raw);
  if (!p || !p.theme) return null;
  const fallbackTheme = proceduralProposal({ ...base, runs: [], memory: [] }, base, `ai-fallback-${Date.now()}`).patch.theme;
  const theme = {
    label: short(p.theme.label, fallbackTheme.label, 30), layout: p.theme.layout, bg: safeHex(p.theme.bg, fallbackTheme.bg), surface: safeHex(p.theme.surface, fallbackTheme.surface),
    ink: safeHex(p.theme.ink, fallbackTheme.ink), muted: safeHex(p.theme.muted, fallbackTheme.muted), accent: safeHex(p.theme.accent, fallbackTheme.accent), accentSoft: safeHex(p.theme.accentSoft, fallbackTheme.accentSoft), border: safeHex(p.theme.border, fallbackTheme.border), rule: safeHex(p.theme.rule, fallbackTheme.rule),
    radius: boundedInteger(p.theme.radius, 0, 36, fallbackTheme.radius), articlePadding: boundedInteger(p.theme.articlePadding, 22, 72, fallbackTheme.articlePadding), mainWidth: boundedInteger(p.theme.mainWidth, 800, 1240, fallbackTheme.mainWidth), heroScale: boundedNumber(p.theme.heroScale, 0.8, 1.4, fallbackTheme.heroScale),
    fontStyle: p.theme.fontStyle, shadow: p.theme.shadow, visualKicker: short(p.theme.visualKicker, 'AUTONOMY / NEW DIRECTION', 34),
    visualTitle: short(p.theme.visualTitle, 'A NEW\nSHAPE FOR\nREADING.', 90), visualBody: short(p.theme.visualBody, 'generated by the autonomous art director', 80)
  };
  const patch = { design: ADAPTIVE_DESIGN, theme, textColor: safeHex(p.textColor, theme.ink), fontSize: boundedInteger(p.fontSize, 16, 22, 18), lineHeight: boundedNumber(p.lineHeight, 1.8, 2.2, 1.9) };
  const candidate = normalizeConfig({ ...base.config, ...patch });
  if (!validConfig(candidate)) return null;
  const value = `adaptive-${hash(JSON.stringify(theme))}`;
  return {
    key: 'design', value, generator: 'workers-ai', patch, title: short(p.title, '系统生成了一套新的视觉方向', 80),
    hypothesis: short(p.hypothesis, '根据当前页面与历史记录，生成下一套视觉方向。', 240),
    reason: 'Workers AI 根据当前版本、历史记录和页面目标提出候选。', baseVersion: base.id
  };
}

async function generateProposal(s, base, requestId, ai) {
  if (ai?.run) {
    const context = JSON.stringify({ currentVersion: base.id, currentConfig: base.config, recent: s.runs.slice(0, 5).map(r => ({ title: r.title, status: r.status, change: r.change?.value, design: r.candidate?.theme?.label })) });
    const prompt = `You are the autonomous art director of a single reading website. Generate one original visual redesign based on this state: ${context}. Return JSON only, with no markdown, URLs, HTML, scripts, or external actions. Keep the same Chinese article content. You may freely invent a new palette and composition. The theme object must contain: label, layout (classic/editorial/cobalt/signal/sunset), bg, surface, ink, muted, accent, accentSoft, border, rule (six digit hex colors), radius integer 0-36, articlePadding integer 22-72, mainWidth integer 800-1240, heroScale number 0.8-1.4, fontStyle (sans/serif/mono), shadow (none/soft/deep), visualKicker, visualTitle, visualBody. Also return textColor as a six digit hex, fontSize 16-22, lineHeight 1.8-2.2, title and hypothesis. Make the redesign visibly different from the current page and keep body text readable. This is a proposal; a deterministic gate will validate it before release.`;
    try {
      const result = await ai.run(AI_MODEL, { prompt, max_tokens: 900, temperature: 0.9, response_format: { type: 'json_object' } });
      const proposal = aiProposal(result?.response || result?.result?.response, base);
      if (proposal) return proposal;
    } catch { /* fall through to a local generator */ }
  }
  return proceduralProposal(s, base, requestId);
}

export function runEvolution(s, requestId, source = 'manual', proposal = null) {
  const old = s.runs.find(r => r.requestId === requestId);
  if (old) return old;
  requireThat(!s.paused, '进化已暂停，请先恢复。');
  requireThat(!s.runs.some(r => r.status === 'pending'), '已有候选等待自动门禁处理。');
  requireThat(s.runs.length < 200, 'MVP 已达到 200 轮保留上限，请导出记录后扩展存储。');
  const base = current(s);
  const candidate = proposal || proceduralProposal(s, base, requestId);
  const blocked = new Set(s.memory.filter(m => ['rejected', 'rolled_back'].includes(m.outcome)).map(m => m.key));
  const run = { id: crypto.randomUUID(), requestId, number: s.runs.length + 1, source, createdAt: new Date().toISOString(), baseVersion: base.id, baseline: { ...base.config }, policy: POLICY, generator: candidate.generator || 'procedural-fallback', status: 'no_change', title: '本轮保持不变', observation: measure(base.config), memoryUsed: blocked.size };
  if (candidate && !blocked.has(`design:${candidate.value}`)) {
    run.change = candidate;
    run.title = candidate.title;
    run.candidate = normalizeConfig({ ...base.config, ...(candidate.patch || { [candidate.key]: candidate.value }) });
    run.evidence = evaluate(base.config, run.candidate);
    run.status = run.evidence.pass ? 'pending' : 'rejected';
    if (!run.evidence.pass) remember(s, run, 'rejected', '固定设计门禁未通过，候选未上线。');
  } else {
    run.reason = '生成的方向与已有失败记忆重复，本轮保持不变。';
    remember(s, run, 'no_change', run.reason);
  }
  s.runs.unshift(run);
  audit(s, 'run', `第 ${run.number} 轮：${run.status}`);
  return run;
}

function releaseRun(s, run, actor = 'autonomous') {
  requireThat(run, '找不到这一轮运行。', 404);
  requireThat(run.status === 'pending', '候选已被处理，请刷新。');
  requireThat(!s.paused, '暂停期间不能发布。');
  requireThat(s.currentVersion === run.baseVersion, '线上基线已改变，请重新运行。');
  requireThat(evaluate(current(s).config, run.candidate).pass, '发布前重新评测失败。');
  const version = { id: `v${String(s.versions.length + 1).padStart(3, '0')}`, config: normalizeConfig(run.candidate), createdAt: new Date().toISOString(), reason: run.title, runId: run.id, previousVersion: s.currentVersion, releaseMode: actor };
  s.versions.push(version); s.currentVersion = version.id;
  run.status = 'released'; run.releasedVersion = version.id; run.releaseMode = actor; run.decidedAt = new Date().toISOString(); run.autoDecision = actor === 'autonomous' ? 'release' : undefined;
  remember(s, run, 'released', actor === 'autonomous' ? `固定设计门禁通过，自动驾驶发布了 ${run.generator === 'workers-ai' ? 'Workers AI' : '程序生成'} 的整套视觉方案。尚未验证真实用户收益。` : '固定设计门禁通过，管理员批准发布。尚未验证真实用户收益。');
  audit(s, actor === 'autonomous' ? 'auto_release' : 'approve', `第 ${run.number} 轮 · ${actor === 'autonomous' ? '自动发布' : '人工批准'}`);
  return run;
}

export function autoReject(s, run, note) {
  if (!run || run.status !== 'pending') return run;
  run.status = 'rejected'; run.releaseMode = 'autonomous'; run.autoDecision = 'reject'; run.decidedAt = new Date().toISOString();
  remember(s, run, 'rejected', `自动门禁未通过：${String(note).slice(0, 500)}`);
  audit(s, 'auto_reject', `第 ${run.number} 轮 · ${String(note).slice(0, 500)}`);
  return run;
}

function finishCycle(s, run) {
  if (run.status === 'pending') {
    try { return releaseRun(s, run, 'autonomous'); }
    catch (error) { return autoReject(s, run, error.message); }
  }
  return run;
}

export function autonomousCycle(s, requestId, source = 'cron') {
  normalizeState(s);
  if (s.autonomy.enabled === false) return { status: 'disabled', reason: '自动驾驶策略已关闭。' };
  if (s.paused) return { status: 'paused', reason: '管理员暂停了自动驾驶。' };
  const pending = s.runs.find(r => r.status === 'pending');
  if (pending) return finishCycle(s, pending);
  try { return finishCycle(s, runEvolution(s, requestId, source)); }
  catch (error) {
    if (String(error.message).includes('200')) { s.paused = true; audit(s, 'auto_stop', '达到 200 轮保留上限，自动驾驶已暂停。'); return { status: 'stopped', reason: error.message }; }
    throw error;
  }
}

export async function autonomousCycleAsync(s, requestId, source = 'cron', ai) {
  normalizeState(s);
  if (s.autonomy.enabled === false) return { status: 'disabled', reason: '自动驾驶策略已关闭。' };
  if (s.paused) return { status: 'paused', reason: '管理员暂停了自动驾驶。' };
  const pending = s.runs.find(r => r.status === 'pending');
  if (pending) return finishCycle(s, pending);
  try {
    const proposal = await generateProposal(s, current(s), requestId, ai);
    return finishCycle(s, runEvolution(s, requestId, source, proposal));
  } catch (error) {
    if (String(error.message).includes('200')) { s.paused = true; audit(s, 'auto_stop', '达到 200 轮保留上限，自动驾驶已暂停。'); return { status: 'stopped', reason: error.message }; }
    throw error;
  }
}

export function decide(s, id, action, note = '') {
  const run = s.runs.find(r => r.id === id);
  requireThat(run, '找不到这一轮运行。', 404);
  requireThat(run.status === 'pending', '候选已被处理，请刷新。');
  if (action === 'approve') return releaseRun(s, run, 'admin');
  requireThat(action === 'reject', '无效操作。', 400);
  requireThat(note.trim().length >= 2, '请写下拒绝原因，供下一轮参考。', 400);
  run.status = 'rejected'; run.releaseMode = 'admin'; run.decidedAt = new Date().toISOString();
  remember(s, run, 'rejected', note.trim().slice(0, 500));
  audit(s, 'reject', `第 ${run.number} 轮 · ${note.slice(0, 500)}`);
  return run;
}

export function rollback(s) {
  const old = current(s);
  requireThat(old.previousVersion && old.runId, '当前版本没有可回滚的发布。');
  const previous = s.versions.find(v => v.id === old.previousVersion);
  const run = s.runs.find(r => r.id === old.runId);
  const version = { id: `v${String(s.versions.length + 1).padStart(3, '0')}`, config: normalizeConfig(previous.config), createdAt: new Date().toISOString(), reason: `回滚 ${old.id}，恢复 ${previous.id} 的样式`, runId: null };
  s.versions.push(version); s.currentVersion = version.id; s.paused = true;
  run.status = 'rolled_back'; remember(s, run, 'rolled_back', `已恢复 ${previous.id} 的配置并暂停进化，后续不再重复该改动。`);
  for (const pending of s.runs.filter(r => r.status === 'pending')) { pending.status = 'rejected'; remember(s, pending, 'stale', '回滚导致基线失效，候选作废。'); }
  audit(s, 'rollback', version.reason); return version;
}

export function setPaused(s, value) { requireThat(typeof value === 'boolean', '无效开关。', 400); s.paused = value; audit(s, value ? 'pause' : 'resume', value ? '管理员暂停进化与发布' : '管理员恢复进化'); }
