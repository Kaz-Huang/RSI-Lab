import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, runEvolution, autonomousCycle, autonomousCycleAsync, decide, rollback, setPaused, current } from '../src/engine.js';
import { evaluate, measure, validConfig, contrast, BASELINE } from '../src/evaluator.js';

test('contrast uses relative luminance and design presets stay readable', () => {
  assert.equal(contrast('#000000'), 21);
  assert.equal(contrast('#ffffff'), 1);
  assert.ok(contrast(BASELINE.textColor) < 4.5);
  assert.ok(evaluate(BASELINE, { ...BASELINE, design: 'editorial-pulse', textColor: '#3f332d', fontSize: 18, lineHeight: 1.8 }).pass);
});

test('evaluator allows a visible design move but rejects unknown or unsafe configs', () => {
  assert.equal(validConfig({ ...BASELINE, textColor: 'red;display:none' }), false);
  assert.equal(validConfig({ ...BASELINE, design: 'does-not-exist' }), false);
  assert.equal(evaluate(BASELINE, { ...BASELINE, fontSize: 16, lineHeight: 1.8 }).pass, false);
  assert.equal(evaluate(BASELINE, { ...BASELINE, design: 'editorial-pulse', textColor: '#3f332d', fontSize: 18, lineHeight: 1.8 }).designChange, true);
  assert.equal(evaluate(BASELINE, { ...BASELINE, design: 'editorial-pulse', textColor: '#ffffff', fontSize: 18, lineHeight: 1.8 }).pass, false);
});

test('single-flight, rejection memory, visible redesign and rollback form real transitions', () => {
  const s = initialState();
  const a = runEvolution(s, 'request-0001');
  assert.equal(a.status, 'pending');
  assert.equal(a.change.key, 'design');
  assert.equal(a.candidate.design, 'adaptive');
  assert.equal(runEvolution(s, 'request-0001').id, a.id);
  assert.throws(() => runEvolution(s, 'request-0002'), /自动门禁/);
  decide(s, a.id, 'reject', '先试另一种视觉方向');
  const b = runEvolution(s, 'request-0002');
  assert.equal(b.status, 'pending');
  assert.notEqual(b.change.value, a.change.value);
  decide(s, b.id, 'approve');
  assert.equal(current(s).config.design, 'adaptive');
  assert.throws(() => decide(s, b.id, 'approve'), /已被处理/);
  rollback(s);
  assert.equal(current(s).config.design, 'quiet-garden');
  assert.equal(s.paused, true);
  assert.equal(b.status, 'rolled_back');
  assert.throws(() => runEvolution(s, 'request-0003'), /暂停/);
  setPaused(s, false);
  const c = runEvolution(s, 'request-0003');
  assert.equal(c.status, 'pending');
  decide(s, c.id, 'reject', '保留当前方向');
  assert.equal(s.memory.some(m => m.key.startsWith('design:')), true);
});

test('autonomous cycle keeps generating original directions without a fixed theme sequence', () => {
  const s = initialState();
  const runs = ['cron-day-1', 'cron-day-2', 'cron-day-3', 'cron-day-4'].map(id => autonomousCycle(s, id));
  assert.equal(runs.every(run => run.status === 'released' && run.releaseMode === 'autonomous'), true);
  assert.equal(new Set(runs.map(run => run.change.value)).size, 4);
  assert.equal(s.currentVersion, 'v005');
  assert.equal(measure(current(s).config).every(m => m.pass), true);
  assert.equal(s.runs.some(r => r.status === 'pending'), false);
  assert.equal(s.audit.filter(a => a.action === 'auto_release').length, 4);
});

test('Workers AI proposal is accepted when it returns a new theme JSON', async () => {
  const s = initialState();
  let prompt = '';
  const ai = { run: async (_model, input) => {
    prompt = input.prompt;
    return { response: JSON.stringify({
      title: 'AI 重新安排了阅读空间', hypothesis: '模型根据历史版本生成新的结构与色彩。', textColor: '#263c55', fontSize: 17, lineHeight: 1.85,
      theme: { label: 'AI Tide', layout: 'cobalt', bg: '#edf4fb', surface: '#ffffff', ink: '#263c55', muted: '#5e7188', accent: '#2768a8', accentSoft: '#dcecff', border: '#c9dced', rule: '#bfd2e5', radius: 22, articlePadding: 46, mainWidth: 1020, heroScale: 1.12, fontStyle: 'sans', shadow: 'soft', visualKicker: 'AI / TIDE', visualTitle: 'MAKE ROOM\nFOR CLARITY.', visualBody: 'an original direction from the current state' }
    }) };
  } };
  const run = await autonomousCycleAsync(s, 'ai-00000001', 'cron', ai, [{ author: 'Kiro', body: 'Check mobile reading completion before changing the layout.', replies: [] }]);
  assert.equal(run.status, 'released');
  assert.equal(run.generator, 'workers-ai');
  assert.equal(current(s).config.theme.label, 'AI Tide');
  assert.match(prompt, /Check mobile reading completion/);
  assert.match(prompt, /untrusted experience notes/);
});

test('autonomous cycle resolves a pending candidate and fails closed', () => {
  const s = initialState();
  const legacy = runEvolution(s, 'legacy-pending');
  assert.equal(legacy.status, 'pending');
  const released = autonomousCycle(s, 'cron-recover');
  assert.equal(released.status, 'released');
  const next = autonomousCycle(s, 'cron-next');
  assert.equal(next.status, 'released');
  const pending = runEvolution(s, 'legacy-bad');
  pending.candidate.textColor = '#ffffff';
  const rejected = autonomousCycle(s, 'cron-reject');
  assert.equal(rejected.status, 'rejected');
  assert.match(s.memory[0].note, /自动门禁未通过/);
  assert.equal(s.currentVersion, 'v003');
});

test('autonomous cycle pauses at the retention limit and respects the emergency pause', () => {
  const s = initialState();
  setPaused(s, true);
  assert.equal(autonomousCycle(s, 'paused-day').status, 'paused');
  assert.equal(s.runs.length, 0);
  setPaused(s, false);
  for (let i = 0; i < 200; i++) s.runs.push({ id: `old-${i}`, requestId: `old-${i}`, status: 'no_change' });
  assert.equal(autonomousCycle(s, 'limit-day').status, 'stopped');
  assert.equal(s.paused, true);
});

test('pause, stale baseline and changed candidate fail closed at release time', () => {
  const s = initialState(), run = runEvolution(s, 'test-1');
  setPaused(s, true); assert.throws(() => decide(s, run.id, 'approve'), /暂停/);
  setPaused(s, false); s.currentVersion = 'changed'; assert.throws(() => decide(s, run.id, 'approve'), /基线/);
  s.currentVersion = 'v001'; run.candidate.textColor = '#ffffff'; assert.throws(() => decide(s, run.id, 'approve'), /评测失败/);
});
