#!/usr/bin/env node
/**
 * Generates the game art with Google Vertex AI (Gemini "Nano Banana" image models),
 * using the same service-account flow as storybook-kit's gemini-storygen skill:
 *   service-account key -> RS256 JWT -> OAuth access token -> aiplatform generateContent.
 *
 * Usage:  node tools/generate-assets.mjs [--only name1,name2] [--force] [--env path/to/.env]
 * Credentials: VERTEX_SA_KEY (+ optional VERTEX_PROJECT / VERTEX_LOCATION) from --env,
 *   ./.env, or ../storybook-kit/.env. Exported shell variables win.
 * Post-processing (background removal, trimming, resizing) uses ImageMagick (`magick`).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'assets/raw');
const OUT = path.join(ROOT, 'assets');
const MODEL = process.env.IMAGE_MODEL || 'gemini-3.1-flash-image'; // Nano Banana 2
const LOCATIONS = ['global', 'us-central1'];

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const only = flag('--only')?.split(',');
const force = args.includes('--force');

// ── Asset list ───────────────────────────────────────────────────────────────
const DEMON_STYLE =
  'Cute chibi cartoon demon head (asura) for a kids mobile game, Diwali festival theme. ' +
  'Only the head, perfectly front facing, round chubby face shaped like a ball, two small stubby horns, ' +
  'big shiny friendly eyes, tiny fangs in a cheeky grin, small golden crown or tilak ornament. ' +
  'Bold thick dark-navy outline around the whole silhouette, soft cel shading, glossy highlight like a bubble. ' +
  'The head is centered and fills about 85% of the frame. ' +
  'Background: perfectly flat solid pure white (#FFFFFF), no shadow, no ground, no text, no border.';

const DEMONS = [
  ['demon_red', 'crimson red skin, golden horns'],
  ['demon_orange', 'bright saffron orange skin, golden horns'],
  ['demon_yellow', 'sunny golden yellow skin, deep orange horns'],
  ['demon_green', 'emerald green skin, golden horns'],
  ['demon_blue', 'royal sky blue skin, golden horns'],
  ['demon_purple', 'violet purple skin, golden horns'],
];

const ASSETS = [
  ...DEMONS.map(([name, color], i) => ({
    name, aspect: '1:1', kind: 'sprite',
    ref: i === 0 ? null : 'demon_red',
    prompt: i === 0
      ? `${DEMON_STYLE} This demon has ${color}.`
      : `Draw the same cute demon head character as the reference image, in exactly the same art style, ` +
        `outline weight, framing and size, but with ${color}. Give it a slightly different cute expression ` +
        `and horn shape so each color feels like its own character. ${DEMON_STYLE}`,
  })),
  {
    name: 'bg_portrait', aspect: '9:16', kind: 'bg',
    prompt:
      'Mobile game background illustration, portrait, Diwali night. Deep indigo-to-midnight-blue night sky filling the top ' +
      'two thirds, mostly empty and dark with faint stars and a soft crescent moon in the corner (that area will hold game ' +
      'pieces so keep it uncluttered and low contrast). At the bottom: silhouettes of Indian rooftops and a temple dome, ' +
      'strings of warm marigold lights, glowing clay diyas on a ledge, a colorful rangoli at the very bottom center. ' +
      'Warm golden glow from the lamps contrasting the cool sky. Painterly, cozy, cute cartoon game style. No text, no characters.',
  },
  {
    name: 'bg_wide', aspect: '16:9', kind: 'bg',
    prompt:
      'Wide panoramic Diwali night scene, cute cartoon game art. Dark indigo starry sky with distant colorful fireworks, ' +
      'floating sky lanterns, silhouettes of an Indian town skyline with temple domes, rows of glowing diyas and fairy lights, ' +
      'marigold garlands. Cozy and magical, low contrast in the center. No text, no characters.',
  },
];

// ── Credentials (same rules as storybook-kit) ────────────────────────────────
const NAMES = ['VERTEX_SA_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'VERTEX_PROJECT', 'VERTEX_LOCATION'];
async function loadConfig() {
  const cfg = {};
  const files = [flag('--env'), path.join(ROOT, '.env'), path.join(ROOT, '../storybook-kit/.env')].filter(Boolean);
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

async function generate(auth, prompt, aspectRatio, refFile) {
  const parts = [];
  if (refFile) parts.push({ inlineData: { mimeType: 'image/png', data: (await readFile(refFile)).toString('base64') } });
  parts.push({ text: prompt });
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio } },
  };
  const locations = auth.location ? [auth.location] : LOCATIONS;
  for (const loc of locations) {
    const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
    const url = `https://${host}/v1/projects/${auth.project}/locations/${loc}/publishers/google/models/${MODEL}:generateContent`;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 404 && !auth.location) break; // model not served here, try next region
      if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 4) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      if (!res.ok) throw new Error(`generateContent failed (HTTP ${res.status}): ${(await res.text()).slice(0, 400)}`);
      auth.location = loc;
      const json = await res.json();
      const img = json?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
      if (!img) throw new Error(`no image in response: ${JSON.stringify(json).slice(0, 300)}`);
      return Buffer.from(img.data, 'base64');
    }
  }
  throw new Error(`model ${MODEL} not available in ${locations.join(', ')}`);
}

// ── Post-processing ──────────────────────────────────────────────────────────
const magick = (...a) => execFileSync('magick', a, { stdio: 'inherit' });

function processSprite(raw, out) {
  // Flood-fill the white backdrop from every corner (keeps white eyes/teeth inside
  // the outline), trim, then center on a transparent 256px square.
  const w = Number(execFileSync('magick', ['identify', '-format', '%w', raw]).toString());
  const h = Number(execFileSync('magick', ['identify', '-format', '%h', raw]).toString());
  const fills = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]
    .flatMap(([x, y]) => ['-draw', `color ${x},${y} floodfill`]);
  magick(raw, '-alpha', 'set', '-fuzz', '12%', '-fill', 'none', ...fills,
    '-channel', 'A', '-morphology', 'Erode', 'Disk:1', '+channel',
    '-trim', '+repage', '-resize', '240x240', '-background', 'none', '-gravity', 'center',
    '-extent', '256x256', out);
}

function processBg(raw, out, size) {
  magick(raw, '-resize', size, '-quality', '84', out);
}

// ── Main ─────────────────────────────────────────────────────────────────────
const cfg = await loadConfig();
const saRef = cfg.VERTEX_SA_KEY || cfg.GOOGLE_APPLICATION_CREDENTIALS;
if (!saRef) throw new Error('Set VERTEX_SA_KEY (see ../storybook-kit/.env.example)');
const sa = JSON.parse(await readFile(saRef, 'utf8'));
const auth = {
  project: cfg.VERTEX_PROJECT || sa.project_id,
  location: cfg.VERTEX_LOCATION || null,
  token: await mintToken(sa),
};

await mkdir(RAW, { recursive: true });
const todo = ASSETS.filter((a) => !only || only.includes(a.name));

// The red demon is the style reference for the others, so make it first; the rest run in parallel.
async function build(a) {
  const raw = path.join(RAW, `${a.name}.png`);
  if (force || !existsSync(raw)) {
    console.log(`generating ${a.name}…`);
    const ref = a.ref ? path.join(RAW, `${a.ref}.png`) : null;
    await writeFile(raw, await generate(auth, a.prompt, a.aspect, ref));
  }
  if (a.kind === 'sprite') processSprite(raw, path.join(OUT, `${a.name}.png`));
  else processBg(raw, path.join(OUT, `${a.name}.jpg`), a.aspect === '9:16' ? '900x1600' : '1920x1080');
  console.log(`✓ ${a.name}`);
}

const first = todo.filter((a) => a.name === 'demon_red');
for (const a of first) await build(a);
const results = await Promise.allSettled(todo.filter((a) => a.name !== 'demon_red').map(build));
results.forEach((r) => r.status === 'rejected' && console.error('✗', r.reason.message));
