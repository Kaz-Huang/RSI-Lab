import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const endpoint = process.env.RELEASES_ENDPOINT || 'https://rsi-lab.kaz-1a8.workers.dev/api/releases';
const response = await fetch(endpoint, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
if (!response.ok) throw new Error(`Release endpoint returned HTTP ${response.status}`);
const payload = await response.json();
if (!Array.isArray(payload.releases)) throw new Error('Release endpoint returned an invalid response');

const seen = new Set();
const releases = payload.releases.slice().sort((a, b) => String(a?.id).localeCompare(String(b?.id), 'en'));
const run = args => execFileSync('git', args, { stdio: 'inherit' });
const changed = [];

await mkdir('evolution/releases', { recursive: true });
for (const release of releases) {
  if (!release || typeof release.id !== 'string' || !/^v\d{3,}$/.test(release.id) || seen.has(release.id)) {
    throw new Error('Release endpoint returned an invalid or duplicate version ID');
  }
  if (!release.config || typeof release.config !== 'object' || Array.isArray(release.config)) {
    throw new Error(`Release ${release.id} has no valid design configuration`);
  }
  if (typeof release.createdAt !== 'string' || !Number.isFinite(Date.parse(release.createdAt)) || typeof release.reason !== 'string') {
    throw new Error(`Release ${release.id} has invalid metadata`);
  }
  seen.add(release.id);

  const file = path.join('evolution/releases', `${release.id}.json`);
  const contents = `${JSON.stringify({ version: release.id, createdAt: release.createdAt, reason: release.reason, config: release.config }, null, 2)}\n`;
  let previous = null;
  try { previous = await readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous === contents) continue;
  if (previous !== null) throw new Error(`Published snapshot ${release.id} changed; refusing to rewrite release history`);

  await writeFile(file, contents, { flag: 'wx' });
  run(['add', '--', file]);
  run(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit', '-m', `Record live evolution ${release.id}`]);
  changed.push(release.id);
}

if (changed.length === 0) {
  console.log('No new published site releases.');
} else {
  const branch = process.env.GITHUB_REF_NAME;
  if (!branch || !/^[\w./-]+$/.test(branch)) throw new Error('Cannot determine a safe target branch');
  run(['push', 'origin', `HEAD:${branch}`]);
  console.log(`Committed and pushed ${changed.length} release(s): ${changed.join(', ')}`);
}
