// Publishes release/Qwosid.exe to a GitHub Release for the current version.
// Run via `npm run release` (which builds first). Re-runnable: if the release
// for this version already exists, its Qwosid.exe asset is replaced.
//
// Auth: reuses the GitHub token cached by git (Git Credential Manager). If that
// fails, set a GITHUB_TOKEN env var with a token that has `repo` scope.
import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const EXE = 'release/Qwosid.exe';
const ASSET = 'Qwosid.exe';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = pkg.version;
const tag = `v${version}`;

// ── resolve repo owner/name from the git remote ──────────────────────────────
const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
const m = remote.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
if (!m) { console.error('Could not parse a GitHub remote from:', remote); process.exit(1); }
const [, owner, repo] = m;

// ── exe present? ─────────────────────────────────────────────────────────────
let size;
try { size = statSync(EXE).size; }
catch { console.error(`${EXE} not found — run "npm run dist" first (npm run release does this for you).`); process.exit(1); }

// ── token: env var, else git credential cache ────────────────────────────────
let token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!token) {
  try {
    const out = execSync('git credential fill', { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
    token = (out.match(/^password=(.+)$/m) || [])[1];
  } catch { /* fall through */ }
}
if (!token) { console.error('No GitHub token. Do a `git push` once to cache credentials, or set GITHUB_TOKEN.'); process.exit(1); }

const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'qwosid-release' };

async function api(path, opts = {}) {
  const res = await fetch(`https://api.github.com${path}`, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
}

console.log(`Publishing ${tag} to ${owner}/${repo} ...`);

// ── find or create the release ───────────────────────────────────────────────
let releaseId;
const existing = await api(`/repos/${owner}/${repo}/releases/tags/${tag}`);
if (existing.ok) {
  releaseId = existing.json.id;
  console.log(`Release ${tag} exists (id ${releaseId}); replacing its ${ASSET}.`);
} else {
  const created = await api(`/repos/${owner}/${repo}/releases`, {
    method: 'POST',
    body: JSON.stringify({
      tag_name: tag,
      name: `Qwosid ${version}`,
      draft: false,
      prerelease: false,
      body: `Download **${ASSET}** below and run it — portable, no installer.\n\nWindows SmartScreen may warn on first run (unsigned app): choose *More info → Run anyway*. Backups are saved to **Documents\\Qwosid Backups**.`,
    }),
  });
  if (!created.ok) { console.error('Failed to create release:', created.status, created.json); process.exit(1); }
  releaseId = created.json.id;
  console.log(`Created release ${tag} (id ${releaseId}).`);
}

// ── remove any prior asset with the same name (so re-runs replace it) ─────────
const assets = await api(`/repos/${owner}/${repo}/releases/${releaseId}/assets`);
if (assets.ok && Array.isArray(assets.json)) {
  for (const a of assets.json) {
    if (a.name === ASSET) {
      console.log(`Removing previous ${ASSET} asset ...`);
      await api(`/repos/${owner}/${repo}/releases/assets/${a.id}`, { method: 'DELETE' });
    }
  }
}

// ── upload ───────────────────────────────────────────────────────────────────
console.log(`Uploading ${EXE} (${(size / 1048576).toFixed(0)} MB) ...`);
const res = await fetch(
  `https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets?name=${ASSET}`,
  { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) }, body: readFileSync(EXE) },
);
const upJson = await res.json().catch(() => ({}));
if (!res.ok) { console.error('Upload failed:', res.status, upJson); process.exit(1); }

console.log('\n✅ Published successfully.');
console.log('   Asset:  ' + upJson.browser_download_url);
console.log('   Latest: ' + `https://github.com/${owner}/${repo}/releases/latest/download/${ASSET}`);
