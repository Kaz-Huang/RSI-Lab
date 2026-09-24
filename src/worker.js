import dashboard from './dashboard.html';
import dashboardCss from './dashboard.css';
import { initialState, current, normalizeState, autonomousCycleAsync, decide, rollback, setPaused } from './engine.js';
import { measure } from './evaluator.js';
import { sitePage } from './site.js';

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'" };
const json = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra } });
const html = value => new Response(value, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
const fail = (message, status) => { throw Object.assign(new Error(message), { status }); };
async function readState(db) {
  let row = await db.prepare('SELECT data, revision FROM lab_state WHERE id = 1').first();
  if (!row) {
    await db.prepare('INSERT OR IGNORE INTO lab_state (id, revision, data) VALUES (1, 0, ?)').bind(JSON.stringify(initialState())).run();
    row = await db.prepare('SELECT data, revision FROM lab_state WHERE id = 1').first();
  }
  return { state: normalizeState(JSON.parse(row.data)), revision: row.revision };
}
// A compare-and-swap makes the entire state transition atomic, including its audit
// and memory. Re-evaluate on conflict; never overwrite another approval or pause.
async function mutate(db, fn) {
  for (let i = 0; i < 6; i++) {
    const { state, revision } = await readState(db);
    const result = await fn(normalizeState(state));
    const update = await db.prepare('UPDATE lab_state SET data = ?, revision = revision + 1 WHERE id = 1 AND revision = ?').bind(JSON.stringify(state), revision).run();
    if (update.meta.changes === 1) return result;
  }
  fail('操作冲突，请稍后重试。', 409);
}
async function digest(value) { return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); }
async function equalSecret(a, b) { const x = await digest(a), y = await digest(b); let difference = 0; for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i]; return difference === 0; }
async function signature(data, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))), x => x.toString(16).padStart(2, '0')).join('');
}
async function isAdmin(req, env) {
  if (!env.ADMIN_KEY) return false;
  const token = (req.headers.get('Cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith('rsi_session='))?.slice(12);
  if (!token) return false;
  const [expiry, sig] = token.split('.');
  if (!expiry || !sig || +expiry < Date.now() || +expiry > Date.now() + 86400000) return false;
  return equalSecret(sig, await signature(expiry, env.ADMIN_KEY));
}
async function body(req) {
  if (!req.headers.get('Content-Type')?.startsWith('application/json')) fail('请求需要 JSON。', 415);
  const reader = req.body?.getReader(); let length = 0; const chunks = [];
  if (!reader) fail('请求内容为空。', 400);
  while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > 4096) { await reader.cancel(); fail('请求内容过大。', 413); } chunks.push(value); }
  const buffer = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(buffer)); } catch { fail('JSON 格式错误。', 400); }
}
async function handle(req, env, ctx) {
  const url = new URL(req.url), path = url.pathname;
  if (path === '/health') return json({ ok: true, app: 'rsi-lab', version: '0.1.0' });
  if (req.method === 'GET' && path === '/') return html(dashboard);
  if (req.method === 'GET' && path === '/dashboard.css') return new Response(dashboardCss, { headers: { ...headers, 'Content-Type': 'text/css' } });
  if (req.method === 'GET' && path === '/site') {
    const { state } = await readState(env.DB);
    let version = current(state), preview = false;
    if (url.searchParams.has('run')) {
      if (!await isAdmin(req, env)) fail('请先登录实验室，再查看候选。', 401);
      const run = state.runs.find(r => r.id === url.searchParams.get('run'));
      if (!run?.candidate) fail('候选不存在。', 404);
      version = { id: `第 ${run.number} 轮候选`, config: run.candidate }; preview = true;
    } else if (url.searchParams.has('version')) {
      if (!await isAdmin(req, env)) fail('请先登录。', 401);
      version = state.versions.find(v => v.id === url.searchParams.get('version'));
      if (!version) fail('版本不存在。', 404);
      preview = true;
    }
    // Aggregate server requests only: no IP address, visitor ID or cookie stored.
    if (!preview && req.headers.get('Sec-Fetch-Dest') !== 'iframe') ctx.waitUntil(env.DB.prepare('INSERT INTO daily_views(day,version,count) VALUES(?,?,1) ON CONFLICT(day,version) DO UPDATE SET count = count + 1').bind(new Date().toISOString().slice(0, 10), version.id).run().catch(e => console.error('view_count_failed', e.message)));
    return html(sitePage(version, preview, state));
  }
  if (path.startsWith('/api/') && req.method === 'POST') {
    if (req.headers.get('Origin') !== url.origin) fail('请求来源校验失败。', 403);
    const input = await body(req);
    if (path === '/api/login') {
      if (!env.ADMIN_KEY || typeof input.key !== 'string' || !await equalSecret(input.key, env.ADMIN_KEY)) fail('管理密钥不正确。', 401);
      const expiry = String(Date.now() + 12 * 3600000), sig = await signature(expiry, env.ADMIN_KEY);
      return json({ ok: true }, 200, { 'Set-Cookie': `rsi_session=${expiry}.${sig}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${url.protocol === 'https:' ? '; Secure' : ''}` });
    }
    if (path === '/api/logout') return json({ ok: true }, 200, { 'Set-Cookie': 'rsi_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    if (!await isAdmin(req, env)) fail('请先输入管理密钥。', 401);
    if (path === '/api/runs') {
      if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(input.requestId)) fail('无效请求标识。', 400);
      return json(await mutate(env.DB, s => autonomousCycleAsync(s, input.requestId, 'manual', env.AI)));
    }
    if (path === '/api/decision') {
      if (!['approve', 'reject'].includes(input.action) || typeof input.id !== 'string' || (input.note !== undefined && typeof input.note !== 'string')) fail('无效审批请求。', 400);
      return json(await mutate(env.DB, s => decide(s, input.id, input.action, input.note || '')));
    }
    if (path === '/api/pause') return json(await mutate(env.DB, s => { setPaused(s, input.paused); return { paused: s.paused }; }));
    if (path === '/api/rollback') return json(await mutate(env.DB, s => rollback(s)));
  }
  if (path === '/api/state' && req.method === 'GET') {
    const admin = await isAdmin(req, env);
    if (!admin) return json({ admin: false });
    const { state, revision } = await readState(env.DB);
    const views = await env.DB.prepare('SELECT SUM(count) AS total FROM daily_views').first();
    return json({ admin, ...state, revision, metrics: measure(current(state).config), views: views?.total || 0 });
  }
  if (path === '/api/releases' && req.method === 'GET') {
    const { state } = await readState(env.DB);
    // Expose only immutable public design snapshots so the GitHub sync job can
    // archive each published release without exposing runs, memory, or audit data.
    return json({ releases: state.versions.filter(v => v.previousVersion).map(({ id, config, createdAt, reason }) => ({ id, config, createdAt, reason })) });
  }
  if (path === '/api/export' && req.method === 'GET') {
    if (!await isAdmin(req, env)) fail('请先登录。', 401);
    return json({ exportedAt: new Date().toISOString(), ...(await readState(env.DB)) }, 200, { 'Content-Disposition': 'attachment; filename="rsi-lab-evidence.json"' });
  }
  return json({ error: '页面不存在。' }, 404);
}
export default {
  async fetch(req, env, ctx) {
    try { return await handle(req, env, ctx); }
    catch (e) { if (!e.status) console.error('request_failed', e.message); return json({ error: e.status ? e.message : '服务暂时不可用，请稍后重试。' }, e.status || 500); }
  },
  async scheduled(event, env, ctx) {
    const date = new Date(event.scheduledTime).toISOString().slice(0, 10);
    ctx.waitUntil(mutate(env.DB, s => {
      return autonomousCycleAsync(s, `cron-${date}`, 'cron', env.AI);
    }).catch(e => { console.error('scheduled_failed', e.message); throw e; }));
  }
};
