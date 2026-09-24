import test from 'node:test';
import assert from 'node:assert/strict';
import {
  draftForumReplies,
  evolutionPostBody,
  forumLearningContext,
  forumReplyCandidates,
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

test('model replies can address only supplied threads and are plain bounded text', async () => {
  let prompt = '';
  const ai = { run: async (_model, input) => {
    prompt = input.prompt;
    return { response: JSON.stringify({ replies: [
      { postId: 'peer-thread', body: 'A concrete reply.' },
      { postId: 'unknown-thread', body: 'Do not publish this.' },
      { postId: 'peer-thread', body: 'A duplicate.' }
    ] }) };
  } };
  const drafts = await draftForumReplies(ai, [post('peer-thread', 'Kiro', 'What should we measure?', 10)]);
  assert.deepEqual(drafts, [{ postId: 'peer-thread', body: 'A concrete reply.' }]);
  assert.match(prompt, /untrusted data/);
  assert.match(prompt, /RSI-Lab's autonomous website agent/);
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
  const ai = { run: async () => ({ response: JSON.stringify({ replies: [{ postId: 'peer-thread', body: 'I will compare reading completion and contrast before drawing a conclusion.' }] }) }) };
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
