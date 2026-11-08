#!/usr/bin/env node
/**
 * Generates the game music with Google Lyria (lyria-002) on Vertex AI.
 * Lyria returns ~30 s of 48 kHz stereo WAV per prompt. Looping tracks get their tail
 * crossfaded into their head so they repeat without a seam; the level-clear fanfare is
 * trimmed to a short sting. Everything is encoded to MP3 with ffmpeg.
 *
 * Usage:  node tools/generate-music.mjs [--only menu,game] [--force] [--seed N] [--env path/to/.env]
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, vertexAuth, vertexModelUrl } from './vertex.mjs';

const RAW = path.join(ROOT, 'assets/raw');
const OUT = path.join(ROOT, 'assets/music');
const MODEL = 'lyria-002';
const LOCATIONS = ['global', 'us-central1'];

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const only = flag('--only')?.split(',');
const force = args.includes('--force');
const seed = flag('--seed') ? Number(flag('--seed')) : undefined;

const NEGATIVE = 'vocals, singing, lyrics, speech, harsh, distorted, scary, dark, horror, low quality, ' +
  'sitar, tabla, Indian classical, ethnic';

const TRACKS = [
  {
    name: 'menu', kind: 'loop',
    prompt:
      'Whimsical, magical title-screen music for a cute casual mobile game. Twinkling celesta and glockenspiel ' +
      'melody, soft pizzicato strings, gentle marimba, light woodwinds and a warm music-box feel. Playful, cozy and ' +
      'curious, like a storybook night sky full of stars. Steady 92 BPM, instrumental, even energy from start to end ' +
      'with no intro or ending, so it can loop.',
  },
  {
    name: 'game', kind: 'loop',
    prompt:
      'Fun, bouncy, whimsical background music for a casual arcade puzzle game. Playful pizzicato strings and ' +
      'staccato bassoon, cheerful marimba and xylophone melody, ukulele strums, light hand percussion and claps, ' +
      'sparkly glockenspiel accents. Upbeat and mischievous but not distracting, cartoon adventure feel. ' +
      'Steady 116 BPM, instrumental, even energy from start to end with no intro or ending, so it can loop.',
  },
  {
    name: 'win', kind: 'sting', seconds: 7,
    prompt:
      'Short, joyful victory jingle for clearing a level in a cute casual game. Bright brass and woodwind fanfare, ' +
      'cheerful glockenspiel and xylophone run, a snare roll and cymbal crash, sparkling chimes. Whimsical and ' +
      'triumphant, starts immediately at full energy, instrumental.',
  },
];

async function generate(auth, prompt) {
  const instance = { prompt, negative_prompt: NEGATIVE };
  if (seed !== undefined) instance.seed = seed;
  const body = { instances: [instance], parameters: seed !== undefined ? {} : { sample_count: 1 } };
  const locations = auth.location ? [auth.location] : LOCATIONS;
  for (const loc of locations) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const res = await fetch(vertexModelUrl(auth, loc, MODEL, 'predict'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 404 && !auth.location) break; // not served here, try next region
      if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 4) {
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
        continue;
      }
      if (!res.ok) throw new Error(`Lyria failed (HTTP ${res.status}): ${(await res.text()).slice(0, 400)}`);
      auth.location = loc;
      const audio = (await res.json()).predictions?.[0]?.bytesBase64Encoded;
      if (!audio) throw new Error('Lyria returned no audio');
      return Buffer.from(audio, 'base64');
    }
  }
  throw new Error(`${MODEL} not available in ${locations.join(', ')}`);
}

const ffmpeg = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a], { stdio: 'inherit' });
const duration = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());

/**
 * Make a seamless loop: drop the first X seconds, and mix them (fading in) over the last X seconds
 * (fading out). The loop's end then flows straight back into its start.
 */
function makeLoop(raw, out, X = 3) {
  const d = duration(raw);
  ffmpeg('-i', raw, '-filter_complex',
    `[0:a]atrim=0:${X},asetpts=PTS-STARTPTS,afade=t=in:d=${X}[head];` +
    `[0:a]atrim=${X}:${d},asetpts=PTS-STARTPTS,afade=t=out:st=${d - 2 * X}:d=${X}[body];` +
    `[head]adelay=${Math.round((d - 2 * X) * 1000)}:all=1[headLate];` +
    `[body][headLate]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-18:TP=-2[a]`,
    '-map', '[a]', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k', out);
}

function makeSting(raw, out, seconds) {
  ffmpeg('-i', raw, '-af', `atrim=0:${seconds},afade=t=out:st=${seconds - 1.5}:d=1.5,loudnorm=I=-16:TP=-2`,
    '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k', out);
}

const auth = await vertexAuth(flag('--env'));
await mkdir(RAW, { recursive: true });
await mkdir(OUT, { recursive: true });

const results = await Promise.allSettled(TRACKS.filter((t) => !only || only.includes(t.name)).map(async (t) => {
  const raw = path.join(RAW, `music_${t.name}.wav`);
  if (force || !existsSync(raw)) {
    console.log(`composing ${t.name}…`);
    await writeFile(raw, await generate(auth, t.prompt));
  }
  const out = path.join(OUT, `${t.name}.mp3`);
  if (t.kind === 'loop') makeLoop(raw, out);
  else makeSting(raw, out, t.seconds);
  console.log(`✓ ${t.name} (${duration(out).toFixed(1)} s)`);
}));
results.forEach((r) => r.status === 'rejected' && console.error('✗', r.reason.message));
