/**
 * Shared Vertex AI login for the asset scripts, using the same service-account flow as
 * storybook-kit's gemini-storygen skill: service-account key -> RS256 JWT -> OAuth access token.
 *
 * Credentials: VERTEX_SA_KEY (+ optional VERTEX_PROJECT / VERTEX_LOCATION) from --env,
 *   ./.env, or ../storybook-kit/.env. Exported shell variables win.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createSign } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const NAMES = ['VERTEX_SA_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'VERTEX_PROJECT', 'VERTEX_LOCATION'];

async function loadConfig(envFile) {
  const cfg = {};
  const files = [envFile, path.join(ROOT, '.env'), path.join(ROOT, '../storybook-kit/.env')].filter(Boolean);
  const re = new RegExp(`^\\s*(${NAMES.join('|')})\\s*=\\s*(.*)\\s*$`);
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const line of (await readFile(file, 'utf8')).split('\n')) {
      const m = line.match(re);
      if (m && cfg[m[1]] === undefined) cfg[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
  for (const n of NAMES) if (process.env[n]) cfg[n] = process.env[n].trim();
  return cfg;
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function mintToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: tokenUri, iat: now, exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const assertion = `${header}.${claim}.${b64url(signer.sign(sa.private_key))}`;
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`OAuth token mint failed (HTTP ${res.status})`);
  return j.access_token;
}

/** Returns { project, location (or null to auto-probe), token }. */
export async function vertexAuth(envFile) {
  const cfg = await loadConfig(envFile);
  const saRef = cfg.VERTEX_SA_KEY || cfg.GOOGLE_APPLICATION_CREDENTIALS;
  if (!saRef) throw new Error('Set VERTEX_SA_KEY (see ../storybook-kit/.env.example)');
  const sa = JSON.parse(await readFile(saRef, 'utf8'));
  return {
    project: cfg.VERTEX_PROJECT || sa.project_id,
    location: cfg.VERTEX_LOCATION || null,
    token: await mintToken(sa),
  };
}

export function vertexModelUrl(auth, location, model, method) {
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${auth.project}/locations/${location}/publishers/google/models/${model}:${method}`;
}
