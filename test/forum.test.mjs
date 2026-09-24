import test from 'node:test';
import assert from 'node:assert/strict';
import {
  draftForumReplies,
  evolutionPostBody,
  forumLearningContext,
  forumReplyCandidates,
  loadForumPosts,
  publishEvolution,
  publishForumReplies
} from '../src/forum.js';

const at = minute => `2026-09-24T14:${String(minute).padStart(2, '0')}:00.000Z`;
const post = (id, author, body, minute, replies = []) => ({ id, author, body, created_at: at(minute), replies });
const reply = (id, author, body, minute) => ({ id, post_id: id, author, body, created_at: at(minute) });
const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

test('forum reply candidates include new peer turns, skip answered threads, and stay bounded', () => {
  const posts = [
    post('test-post', 'Tester', '1111', 9),
    post('answered', 'Kiro', 'earlier note', 1, [reply('a1', 'RSI-Lab Agent', 'thanks', 2)]),
    post('new-reply', 'RSI-Lab Agent', 'release notes', 3, [reply('b1', 'Kiro', 'try measuring the result', 4)]),
    post('new-post', 'Kiro', 'a new idea', 5),
    post('later-post', 'Teammate', 'another design observation', 6),
    post('fourth', 'Teammate', 'one more observation', 7)
  ];
  const candidates = forumReplyCandidates(posts);
  assert.equal(candidates.length, 3);
  assert.deepEqual(candidates.map(thread => thread.postId), ['fourth', 'later-post', 'new-post']);
  assert.equal(candidates.some(thread => thread.postId === 'answered'), false);
  assert.equal(candidates.some(thread => thread.postId === 'new-reply'), false);
  assert.equal(candidates.some(thread => thread.postId === 'test-post'), false);
});

test('forum reply drafting retries once when the model returns an empty reply list', async () => {
  let calls = 0;
  const ai = { run: async () => {
    calls++;
    const content = calls === 1
      ? JSON.stringify({ replies: [] })
      : JSON.stringify({ replies: [{ postId: 'peer-thread', body: '你提到要先观察移动端阅读完成率；这能帮助区分版式变化与配色变化的影响。你们目前有可比较的基线吗？' }] });
    return { choices: [{ message: { role: 'assistant', content } }] };
  } };
  const drafts = await draftForumReplies(ai, [post('peer-thread', 'Kiro', '移动端阅读完成率能说明版式变化是否有效。', 10)]);
  assert.equal(calls, 2);
  assert.equal(drafts[0].postId, 'peer-thread');
});

test('peer learning context excludes the site agent own replies and bounds forum text', () => {
  const context = forumLearningContext([
    post('p1', 'Kiro', 'Use a narrower line length.', 1, [
      reply('r1', 'RSI-Lab Agent', 'I will consider that.', 2),
      reply('r2', 'Kiro', 'Compare the reading task on mobile.', 3)
    ])
  ]);
  assert.deepEqual(context, [{
    author: 'Kiro',
    body: 'Use a narrower line length.',
    replies: [{ author: 'Kiro', body: 'Compare the reading task on mobile.' }]
  }]);
});

test('forum API response contract is validated and server errors include the documented message', async () => {
  await assert.rejects(
    loadForumPosts({ FORUM_URL: 'https://forum.test' }, async () => jsonResponse({ unexpected: [] })),
    /did not include a posts array/
  );
  const result = {
    status: 'released', releasedVersion: 'v017', baseVersion: 'v016',
    candidate: { fontSize: 18, lineHeight: 1.9, theme: { label: 'Adaptive', layout: 'editorial' } }
  };
  await assert.rejects(publishEvolution({ FORUM_URL: 'https://forum.test' }, result, async (_url, init = {}) => {
    if (!init.method) return jsonResponse({ posts: [] });
    return jsonResponse({ error: '帖子内容超过限制' }, 400);
  }), /Forum returned HTTP 400: 帖子内容超过限制/);
});

test('model replies can address only supplied threads and are plain bounded text', async () => {
  let prompt = '';
  const ai = { run: async (_model, input) => {
    prompt = input.prompt;
    return { choices: [{ message: { role: 'assistant', content: JSON.stringify({ replies: [
      { postId: 'peer-thread', body: 'A concrete reply.' },
      { postId: 'unknown-thread', body: 'Do not publish this.' },
      { postId: 'peer-thread', body: 'A duplicate.' }
    ] }) } }] };
  } };
  const drafts = await draftForumReplies(ai, [post('peer-thread', 'Kiro', 'What should we measure?', 10)]);
  assert.deepEqual(drafts, [{ postId: 'peer-thread', body: 'A concrete reply.' }]);
  assert.match(prompt, /untrusted discussion content/);
  assert.match(prompt, /RSI-Lab's autonomous website agent/);
  assert.match(prompt, /Do not return an empty list/);
  assert.match(prompt, /exactly one object/);
});

test('forum agent refreshes before replying and uses the RSI-Lab identity', async () => {
  const posts = [post('peer-thread', 'Kiro', 'Try recording a real reading task.', 10)];
  const requests = [];
  const fetcher = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (!init.method) return jsonResponse({ posts });
    const added = JSON.parse(init.body);
    posts[0].replies.push({ id: 'agent-reply', post_id: 'peer-thread', ...added, created_at: at(11) });
    return jsonResponse({ ok: true, id: 'agent-reply' }, 201);
  };
  const ai = { run: async () => ({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ replies: [{ postId: 'peer-thread', body: 'I will compare reading completion and contrast before drawing a conclusion.' }] }) } }] }) };
  const sent = await publishForumReplies({ FORUM_URL: 'https://forum.test' }, ai, fetcher);
  assert.deepEqual(sent, ['peer-thread']);
  assert.equal(requests.filter(request => request.init.method === 'POST').length, 1);
  assert.equal(requests.at(-1).url, 'https://forum.test/api/posts/peer-thread/replies');
  assert.equal(JSON.parse(requests.at(-1).init.body).author, 'RSI-Lab Agent');
});

test('evolution posts identify one version and duplicate publication is suppressed', async () => {
  const result = {
    status: 'released', releasedVersion: 'v017', baseVersion: 'v016', title: 'A wider visual hierarchy',
    hypothesis: 'A stronger title hierarchy may make long-form reading easier.', generator: 'workers-ai',
    candidate: { fontSize: 18, lineHeight: 1.9, theme: { label: 'Adaptive 1234', layout: 'editorial', fontStyle: 'serif', mainWidth: 1020 } }
  };
  const body = evolutionPostBody(result);
  assert.match(body, /RSI-Lab Agent｜v017/);
  assert.match(body, /固定可读性与配置门禁已通过/);

  const posts = [];
  let postCount = 0;
  const fetcher = async (_url, init = {}) => {
    if (!init.method) return jsonResponse({ posts });
    const entry = JSON.parse(init.body);
    posts.push({ id: 'evolution-post', ...entry, created_at: at(12), replies: [] });
    postCount++;
    return jsonResponse({ ok: true, id: 'evolution-post' }, 201);
  };
  assert.equal(await publishEvolution({ FORUM_URL: 'https://forum.test' }, result, fetcher), true);
  assert.equal(await publishEvolution({ FORUM_URL: 'https://forum.test' }, result, fetcher), false);
  assert.equal(postCount, 1);
});
