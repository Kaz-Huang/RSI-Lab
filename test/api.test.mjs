import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('Worker + real local D1: auth, CSRF, autonomous releases, preview and rollback', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'rsi-test', modules: true, scriptPath: 'dist/worker.js', compatibilityDate: '2026-09-17', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], bindings: { ADMIN_KEY: 'local-test-only-key-at-least-32-characters' } }] }));
  try {
    const db = await mf.getD1Database('DB');
    await db.exec((await readFile('migrations/0001_init.sql', 'utf8')).replace(/\n/g, ' '));
    const origin = 'https://lab.test';
    let cookie = '';
    const req = (path, data, extra = {}) => mf.dispatchFetch(origin + path, { ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }), headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie, ...extra } });
    assert.equal((await req('/api/runs', { requestId: 'request-0001' })).status, 401);
    assert.deepEqual(await (await req('/api/state')).json(), { admin: false });
    const login = await req('/api/login', { key: 'local-test-only-key-at-least-32-characters' });
    assert.equal(login.status, 200); cookie = login.headers.get('set-cookie').split(';')[0];
    assert.match(login.headers.get('set-cookie'), /HttpOnly/);
    assert.equal((await req('/api/pause', { paused: true }, { Origin: 'https://evil.test' })).status, 403);
    assert.equal((await req('/api/pause', { paused: 'true' })).status, 400);
    const simultaneous = await Promise.all([req('/api/runs', { requestId: 'request-0001' }), req('/api/runs', { requestId: 'request-0002' })]);
    assert.deepEqual(simultaneous.map(x => x.status).sort(), [200, 200]);
    let state = await (await req('/api/state')).json();
    assert.equal(state.autonomy.enabled, true);
    assert.equal(state.autonomy.requiresHumanApproval, false);
    assert.equal(state.runs.length, 2);
    assert.equal(state.runs.every(r => r.status === 'released' && r.releaseMode === 'autonomous'), true);
    const run = state.runs[0];
    assert.equal((await req('/api/runs', { requestId: run.requestId })).status, 200);
    assert.equal((await req(`/site?run=${run.id}`)).status, 200);
    const before = await (await req('/site?version=v001')).text(); assert.match(before, /background:#f5f7f0/); assert.match(before, /font-size:12px/);
    const after = await (await req('/site')).text(); assert.match(after, /background:#[0-9a-f]{6}/); assert.match(after, /font-size:(16|17|18|19)px/); assert.match(after, /Adaptive/); assert.match(after, /自动进化已生效/); assert.match(after, /v002/); assert.match(after, /整体视觉方案/);
    const approvals = await Promise.all([req('/api/decision', { id: run.id, action: 'approve' }), req('/api/decision', { id: run.id, action: 'approve' })]);
    assert.deepEqual(approvals.map(x => x.status).sort(), [409, 409]);
    assert.equal((await req('/api/rollback', {})).status, 200);
    const archivedReleases = await (await req('/api/releases')).json();
    assert.deepEqual(archivedReleases.releases.map(release => release.id), ['v002', 'v003', 'v004']);
    const restored = await (await req('/site')).text(); assert.match(restored, /线上版本 · v004/); assert.match(restored, /font-size:(16|17|18|19)px/); assert.match(restored, /Adaptive/);
    state = await (await req('/api/state')).json(); assert.equal(state.paused, true); assert.equal(state.versions.length, 4);
    const pausedRun = await req('/api/runs', { requestId: 'request-0003' });
    assert.equal(pausedRun.status, 200); assert.equal((await pausedRun.json()).status, 'paused');
    assert.equal((await req('/api/export')).status, 200);
    await req('/api/logout', {}); cookie = ''; assert.equal((await req(`/site?run=${run.id}`)).status, 401);
  } finally { await mf.dispose(); }
});
