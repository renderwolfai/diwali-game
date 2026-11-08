// Diwali Demon Pop — a bow-and-arrow bubble shooter built with Phaser 3.

const W = 720;
// Tall phones get a taller playfield instead of letterboxing; everything below the grid is anchored to H.
const H = Math.round(Math.min(1560, Math.max(1280, W * (window.innerHeight / window.innerWidth))));
const R = 36;                        // bubble radius
const COLS = 10;                     // cells in a full row (offset rows hold COLS - 1)
const ROWH = R * Math.sqrt(3);       // vertical distance between hex rows
const MAX_ROWS = 18;
const TOP = 104;                     // ceiling (bottom of the HUD garland)
const DANGER_Y = H - 270;            // demons crossing this line end the game
const BOW_X = W / 2;
const BOW_Y = H - 104;
const SHOT_SPEED = 1700;             // px / second
const ARROW_LEN = 100;
const FONT = '"Baloo 2", "Trebuchet MS", sans-serif';

const DEMONS = [
  { key: 'demon_red', tint: 0xff4d5e },
  { key: 'demon_orange', tint: 0xff9a2e },
  { key: 'demon_yellow', tint: 0xffd84a },
  { key: 'demon_green', tint: 0x3fe07a },
  { key: 'demon_blue', tint: 0x4aa8ff },
  { key: 'demon_purple', tint: 0xc07bff },
];
const GOLD = 0xffd56b;

const DEPTH = { bg: 0, ambient: 1, decor: 2, grid: 5, shot: 6, bow: 7, fx: 8, hud: 10, overlay: 20 };

const text = (scene, x, y, str, size, opts = {}) =>
  scene.add.text(x, y, str, {
    fontFamily: FONT, fontSize: `${size}px`, fontStyle: '800',
    color: opts.color || '#ffe08a', stroke: opts.stroke || '#3a1300',
    strokeThickness: opts.strokeThickness ?? Math.max(4, size / 7), align: 'center',
    shadow: { offsetX: 0, offsetY: 3, color: '#000', blur: 8, fill: true },
  }).setOrigin(0.5);

const bestScore = () => Number(localStorage.getItem('diwali-best') || 0);

// Background music (composed with Lyria, see tools/generate-music.mjs): one track at a time,
// crossfaded, sharing the mute setting with the sound effects.
const Music = {
  current: null,
  want: null,
  waiting: false,

  play(scene, key, { loop = true, volume = 0.4 } = {}) {
    const sound = scene.sound;
    sound.mute = Sfx.muted;
    this.want = { scene, key, loop, volume };
    // Browsers block audio until the first tap; play whatever was last asked for once it unlocks.
    if (sound.locked) {
      if (!this.waiting) {
        this.waiting = true;
        sound.once(Phaser.Sound.Events.UNLOCKED, () => {
          this.waiting = false;
          const w = this.want;
          this.play(w.scene, w.key, w);
        });
      }
      return;
    }
    if (this.current?.key === key && this.current.isPlaying) return;
    this.fadeOut(scene);
    const track = sound.add(key, { loop, volume: 0 });
    track.play();
    this.current = track;
    scene.tweens.add({ targets: track, volume, duration: 900 });
  },

  fadeOut(scene, duration = 700) {
    const old = this.current;
    this.current = null;
    if (!old) return;
    let done = false;
    const kill = () => { if (!done) { done = true; old.destroy(); } };
    scene.tweens.add({ targets: old, volume: 0, duration, onComplete: kill });
    // If the scene restarts mid-fade its tweens die with it, so make sure the track still stops.
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, kill);
  },

  toggleMute(scene) {
    const muted = Sfx.toggleMute();
    scene.sound.mute = muted;
    return muted;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Boot: load art, build procedural textures
// ─────────────────────────────────────────────────────────────────────────────
class BootScene extends Phaser.Scene {
  constructor() { super('boot'); }

  preload() {
    const bar = this.add.rectangle(W / 2, H / 2, 10, 14, GOLD).setOrigin(0, 0.5);
    bar.x = W / 2 - 200;
    this.load.on('progress', (v) => { bar.width = 400 * v; });
    this.load.image('bg', 'assets/bg_portrait.jpg');
    ['menu', 'game', 'win'].forEach((m) => this.load.audio(`music_${m}`, `assets/music/${m}.mp3`));
    DEMONS.forEach((d) => this.load.image(d.key, `assets/${d.key}.png`));
  }

  create() {
    this.radialTexture('spark', 32, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)']]);
    this.radialTexture('shade', 128, [[0, 'rgba(5,2,20,0.8)'], [0.55, 'rgba(5,2,20,0.55)'], [1, 'rgba(5,2,20,0)']]);
    this.radialTexture('glow', 128, [[0, 'rgba(255,255,255,0.9)'], [0.3, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]);
    this.makeArrows();
    this.makeLantern();
    this.scene.start('menu');
  }

  radialTexture(key, size, stops) {
    const tex = this.textures.createCanvas(key, size, size);
    const ctx = tex.getContext();
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(([o, c]) => g.addColorStop(o, c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    tex.refresh();
  }

  makeArrows() {
    // One arrow per demon color (key `arrow_<color index>`); the arrowhead carries the color.
    // Points right; the tail (nock) is at x = 0, the tip at x = ARROW_LEN.
    DEMONS.forEach((d, i) => {
      const g = this.make.graphics({ add: false });
      const cy = 16;
      const head = ARROW_LEN - 30;
      // fletching, tinted to match the head
      g.fillStyle(d.tint).fillTriangle(0, cy, 24, cy, 4, cy - 12).fillTriangle(0, cy, 24, cy, 4, cy + 12);
      g.lineStyle(2, 0x3a1300).strokeTriangle(0, cy, 24, cy, 4, cy - 12).strokeTriangle(0, cy, 24, cy, 4, cy + 12);
      // shaft
      g.fillStyle(0x3a1300).fillRect(2, cy - 3, head, 6);
      g.fillStyle(0xb7792f).fillRect(3, cy - 2, head - 2, 4);
      g.fillStyle(GOLD).fillRect(30, cy - 3, 5, 6).fillRect(54, cy - 3, 5, 6);
      // colored head with a light edge so it reads against the night sky
      g.fillStyle(0x3a1300).fillTriangle(head - 2, cy - 15, ARROW_LEN, cy, head - 2, cy + 15);
      g.fillStyle(d.tint).fillTriangle(head + 1, cy - 11, ARROW_LEN - 4, cy, head + 1, cy + 11);
      g.fillStyle(0xffffff, 0.75).fillTriangle(head + 4, cy - 7, ARROW_LEN - 10, cy - 1, head + 4, cy - 1);
      g.generateTexture(`arrow_${i}`, ARROW_LEN, 32);
      g.destroy();
    });
  }

  makeLantern() {
    const g = this.make.graphics({ add: false });
    g.fillStyle(0xff7a1a).fillRoundedRect(4, 6, 24, 30, 8);
    g.fillStyle(0xffc65a).fillRoundedRect(9, 10, 14, 22, 6);
    g.fillStyle(0x8a2b0a).fillRect(8, 2, 16, 5).fillRect(10, 35, 12, 4);
    g.generateTexture('lantern', 32, 42);
    g.destroy();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared night-sky backdrop: background art, twinkling stars, lanterns, ambient fireworks
// ─────────────────────────────────────────────────────────────────────────────
function buildBackdrop(scene) {
  const bg = scene.add.image(W / 2, H, 'bg').setOrigin(0.5, 1).setDepth(DEPTH.bg);
  bg.setScale(Math.max(W / bg.width, H / bg.height));
  scene.add.rectangle(W / 2, 0, W, H * 1.2, 0x070418, 0.28).setOrigin(0.5, 0).setDepth(DEPTH.bg);

  for (let i = 0; i < 45; i++) {
    const s = scene.add.image(Phaser.Math.Between(0, W), Phaser.Math.Between(0, 700), 'spark')
      .setScale(Phaser.Math.FloatBetween(0.12, 0.3)).setAlpha(0.2).setBlendMode('ADD').setDepth(DEPTH.ambient);
    scene.tweens.add({
      targets: s, alpha: Phaser.Math.FloatBetween(0.6, 1), duration: Phaser.Math.Between(700, 2200),
      yoyo: true, repeat: -1, delay: Phaser.Math.Between(0, 2000), ease: 'Sine.easeInOut',
    });
  }

  const launchLantern = (initial) => {
    const x = Phaser.Math.Between(30, W - 30);
    const y = initial ? Phaser.Math.Between(300, H) : H + 40;
    const l = scene.add.image(x, y, 'lantern').setScale(Phaser.Math.FloatBetween(0.6, 1)).setAlpha(0.55).setDepth(DEPTH.ambient);
    const glow = scene.add.image(x, y, 'glow').setTint(0xff9a2e).setScale(0.6).setAlpha(0.35).setBlendMode('ADD').setDepth(DEPTH.ambient);
    const duration = (y + 60) * Phaser.Math.Between(28, 40);
    scene.tweens.add({
      targets: [l, glow], y: -60, duration,
      onUpdate: () => { glow.x = l.x = x + Math.sin(l.y / 60) * 14; },
      onComplete: () => { l.destroy(); glow.destroy(); launchLantern(false); },
    });
  };
  for (let i = 0; i < 4; i++) launchLantern(true);

  const fx = new Fireworks(scene, DEPTH.ambient, 0.6);
  const ambient = () => {
    fx.rocket(Phaser.Math.Between(80, W - 80), Phaser.Math.Between(140, 520), { scale: 0.75, quiet: true });
    scene.time.delayedCall(Phaser.Math.Between(1800, 4200), ambient);
  };
  scene.time.delayedCall(800, ambient);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fireworks: per-color particle emitters plus flashes and rockets
// ─────────────────────────────────────────────────────────────────────────────
class Fireworks {
  constructor(scene, depth, alpha = 1) {
    this.scene = scene;
    this.depth = depth;
    this.alpha = alpha;
    this.emitters = new Map();
    const tints = [...DEMONS.map((d) => d.tint), GOLD, 0xffffff, 0xff6ec7];
    tints.forEach((t) => this.emitter(t));
  }

  emitter(tint) {
    if (!this.emitters.has(tint)) {
      const make = (cfg) => this.scene.add.particles(0, 0, 'spark', {
        emitting: false, blendMode: 'ADD', tint, ...cfg,
      }).setDepth(this.depth);
      this.emitters.set(tint, {
        ring: make({ speed: { min: 230, max: 290 }, lifespan: { min: 700, max: 1000 }, gravityY: 260,
          scale: { start: 0.65, end: 0 }, alpha: { start: this.alpha, end: 0 } }),
        core: make({ speed: { min: 40, max: 220 }, lifespan: { min: 400, max: 800 }, gravityY: 200,
          scale: { start: 0.5, end: 0 }, alpha: { start: this.alpha, end: 0 } }),
        glitter: make({ speed: { min: 60, max: 180 }, lifespan: { min: 900, max: 1500 }, gravityY: 120,
          scale: { start: 0.25, end: 0.05 }, alpha: { start: this.alpha, end: 0, ease: 'Bounce.easeIn' } }),
      });
    }
    return this.emitters.get(tint);
  }

  burst(x, y, tint, { size = 1 } = {}) {
    const e = this.emitter(tint);
    const gold = this.emitter(GOLD);
    e.ring.explode(Math.round(26 * size), x, y);
    e.core.explode(Math.round(12 * size), x, y);
    gold.glitter.explode(Math.round(10 * size), x, y);
    const flash = this.scene.add.image(x, y, 'glow').setTint(tint).setBlendMode('ADD')
      .setScale(0.2).setAlpha(this.alpha).setDepth(this.depth);
    this.scene.tweens.add({ targets: flash, scale: 1.4 * size, alpha: 0, duration: 320, onComplete: () => flash.destroy() });
  }

  rocket(x, y, { tint, scale = 1, quiet = false } = {}) {
    const alpha = this.alpha;
    tint = tint ?? Phaser.Utils.Array.GetRandom([...DEMONS.map((d) => d.tint), GOLD, 0xff6ec7]);
    const head = this.scene.add.image(x + Phaser.Math.Between(-60, 60), H - 120, 'spark')
      .setTint(0xffe9a0).setBlendMode('ADD').setScale(0.6).setAlpha(alpha).setDepth(this.depth);
    const trail = this.scene.add.particles(0, 0, 'spark', {
      follow: head, frequency: 18, lifespan: 400, speed: { min: 5, max: 30 },
      scale: { start: 0.35, end: 0 }, alpha: { start: 0.8 * alpha, end: 0 }, tint: 0xffc65a, blendMode: 'ADD',
    }).setDepth(this.depth);
    if (!quiet) Sfx.whistle();
    this.scene.tweens.add({
      targets: head, x, y, duration: Phaser.Math.Between(650, 900), ease: 'Quad.easeOut',
      onComplete: () => {
        trail.stop();
        this.scene.time.delayedCall(500, () => trail.destroy());
        head.destroy();
        this.burst(x, y, tint, { size: 1.8 * scale });
        this.scene.time.delayedCall(260, () => this.emitter(0xffffff).glitter.explode(Math.round(18 * scale), x, y));
        if (!quiet) Sfx.boom();
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Menu
// ─────────────────────────────────────────────────────────────────────────────
class MenuScene extends Phaser.Scene {
  constructor() { super('menu'); }

  create() {
    buildBackdrop(this);
    const dy = (H - 1280) / 2;

    const title = text(this, W / 2, 250 + dy, 'Diwali\nDemon Pop', 104, { color: '#ffd56b', strokeThickness: 12 });
    title.setLineSpacing(-30).setDepth(DEPTH.hud);
    this.tweens.add({ targets: title, scale: 1.04, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    DEMONS.forEach((d, i) => {
      const angle = (i / DEMONS.length) * Math.PI * 2;
      const img = this.add.image(W / 2 + Math.cos(angle) * 200, 600 + dy + Math.sin(angle) * 120, d.key)
        .setScale(0.5).setDepth(DEPTH.grid);
      this.tweens.add({ targets: img, y: img.y - 18, duration: 900 + i * 90, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    });

    text(this, W / 2, 790 + dy, 'Shoot each demon with an arrow\nof its color to light up the night!', 34, { color: '#fff3d6', strokeThickness: 5 })
      .setDepth(DEPTH.hud);

    const btn = this.add.container(W / 2, 930 + dy).setDepth(DEPTH.hud);
    const bg = this.add.graphics();
    bg.fillStyle(0x3a1300).fillRoundedRect(-170, -52, 340, 104, 52);
    bg.fillStyle(0xff8a1f).fillRoundedRect(-164, -46, 328, 92, 46);
    bg.fillStyle(0xffc65a).fillRoundedRect(-150, -42, 300, 36, 18);
    btn.add([bg, text(this, 0, 2, 'PLAY', 56, { color: '#fff8e6' })]);
    btn.setSize(340, 104).setInteractive({ useHandCursor: true });
    this.tweens.add({ targets: btn, scale: 1.07, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    const best = bestScore();
    if (best) text(this, W / 2, 1035 + dy, `Best: ${best}`, 36, { color: '#ffe9a0' }).setDepth(DEPTH.hud);

    const mute = text(this, W - 44, 46, Sfx.muted ? '🔇' : '🔊', 40, { strokeThickness: 0 })
      .setDepth(DEPTH.hud).setInteractive({ useHandCursor: true });
    const toggleMute = () => { Sfx.unlock(); mute.setText(Music.toggleMute(this) ? '🔇' : '🔊'); };
    mute.on('pointerup', toggleMute);
    this.input.keyboard.on('keydown-M', toggleMute);

    Music.play(this, 'music_menu', { volume: 0.5 });

    const start = () => { Sfx.unlock(); this.scene.start('game'); };
    btn.on('pointerup', start);
    this.input.keyboard.once('keydown-SPACE', start);
    this.input.keyboard.once('keydown-ENTER', start);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Game
// ─────────────────────────────────────────────────────────────────────────────
class GameScene extends Phaser.Scene {
  constructor() { super('game'); }

  init() {
    this.level = 1;
    this.score = 0;
  }

  create() {
    buildBackdrop(this);
    this.fx = new Fireworks(this, DEPTH.fx);
    this.drawDecor();
    this.buildHud();
    this.buildBow();
    this.aimGfx = this.add.graphics().setDepth(DEPTH.shot);

    this.input.on('pointerdown', this.onDown, this);
    this.input.on('pointermove', this.onMove, this);
    this.input.on('pointerup', this.onUp, this);
    this.input.keyboard.on('keydown-SPACE', () => this.state === 'ready' && this.fire());
    this.input.keyboard.on('keydown-S', () => this.swap());
    this.input.keyboard.on('keydown-M', () => this.toggleMute());

    this.startLevel();
  }

  // ── Level setup ───────────────────────────────────────────────────────────
  levelConfig() {
    const L = this.level;
    return {
      rows: Math.min(4 + L, 10),
      colors: Math.min(3 + L, DEMONS.length),
      shotsPerDrop: Math.max(3, 8 - L),
    };
  }

  startLevel() {
    Music.play(this, 'music_game', { volume: 0.35 });
    if (this.grid) this.grid.flat().forEach((c) => c && c.sprite.destroy());
    this.parity = 0;
    this.grid = Array.from({ length: MAX_ROWS }, () => new Array(COLS).fill(null));
    const cfg = this.levelConfig();
    this.palette = Phaser.Utils.Array.Shuffle([...DEMONS.keys()]).slice(0, cfg.colors);
    this.shotsLeft = cfg.shotsPerDrop;

    for (let r = 0; r < cfg.rows; r++) {
      for (let c = 0; c < this.colsIn(r); c++) {
        // Bias towards neighbor colors so the board has satisfying clusters.
        const nb = this.neighbors(r, c).map(([a, b]) => this.grid[a][b]).filter(Boolean);
        const color = nb.length && Math.random() < 0.45
          ? Phaser.Utils.Array.GetRandom(nb).color
          : Phaser.Utils.Array.GetRandom(this.palette);
        this.place(r, c, color, true);
      }
    }

    this.current = this.randomColor();
    this.next = this.randomColor();
    this.refreshLoaded();
    this.updateHud();
    this.state = 'ready';

    const banner = text(this, W / 2, H / 2 - 60, `Level ${this.level}`, 96).setDepth(DEPTH.overlay).setScale(0.3);
    this.tweens.add({
      targets: banner, scale: 1, duration: 450, ease: 'Back.easeOut',
      onComplete: () => this.tweens.add({ targets: banner, alpha: 0, delay: 700, duration: 400, onComplete: () => banner.destroy() }),
    });
  }

  // ── Hex grid helpers ──────────────────────────────────────────────────────
  isOffset(r) { return ((r + this.parity) & 1) === 1; }
  colsIn(r) { return this.isOffset(r) ? COLS - 1 : COLS; }
  cellXY(r, c) {
    return { x: R + c * 2 * R + (this.isOffset(r) ? R : 0), y: TOP + R + r * ROWH };
  }
  inBounds(r, c) { return r >= 0 && r < MAX_ROWS && c >= 0 && c < this.colsIn(r); }
  neighbors(r, c) {
    const d = this.isOffset(r)
      ? [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]]
      : [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]];
    return d.map(([dr, dc]) => [r + dr, c + dc]).filter(([a, b]) => this.inBounds(a, b));
  }
  cells() {
    const out = [];
    this.grid.forEach((row, r) => row.forEach((cell, c) => cell && out.push({ r, c, ...cell })));
    return out;
  }
  colorsOnBoard() { return [...new Set(this.cells().map((c) => c.color))]; }
  randomColor() {
    const present = this.colorsOnBoard();
    return Phaser.Utils.Array.GetRandom(present.length ? present : this.palette);
  }

  demonSprite(x, y, color) {
    const s = this.add.image(x, y, DEMONS[color].key).setDepth(DEPTH.grid);
    s.setDisplaySize(R * 2.3, R * 2.3);
    return s;
  }

  place(r, c, color, instant = false) {
    const { x, y } = this.cellXY(r, c);
    const sprite = this.demonSprite(x, y, color);
    const base = sprite.scale;
    if (instant) {
      sprite.setScale(0);
      this.tweens.add({ targets: sprite, scale: base, duration: 350, delay: r * 40 + c * 15, ease: 'Back.easeOut' });
    } else {
      this.tweens.add({ targets: sprite, scale: { from: base * 1.25, to: base }, duration: 220, ease: 'Back.easeOut' });
    }
    this.grid[r][c] = { color, sprite, base };
  }

  // ── Decor & HUD ───────────────────────────────────────────────────────────
  drawDecor() {
    // Marigold toran hanging from the ceiling.
    const g = this.add.graphics().setDepth(DEPTH.decor);
    g.fillStyle(0x0b0726, 0.75).fillRect(0, 0, W, TOP - 8);
    g.lineStyle(4, 0x7a3b00).lineBetween(0, TOP - 8, W, TOP - 8);
    for (let x = 12; x < W; x += 24) {
      g.fillStyle(x % 48 === 12 ? 0xff9a2e : 0xffc928).fillCircle(x, TOP - 8, 11);
      g.fillStyle(0xffe9a0, 0.6).fillCircle(x - 3, TOP - 11, 4);
    }
    for (let x = 36; x < W; x += 72) {
      g.fillStyle(0x2f9e44).fillTriangle(x - 8, TOP - 2, x + 8, TOP - 2, x, TOP + 18);
    }

    this.dangerLine = this.add.graphics().setDepth(DEPTH.decor);
    for (let x = 6; x < W; x += 28) this.dangerLine.fillStyle(0xff7a3a, 0.75).fillRoundedRect(x, DANGER_Y - 2, 16, 4, 2);
    this.dangerLine.setAlpha(0.35);
  }

  buildHud() {
    const d = DEPTH.hud;
    this.scoreText = text(this, 24, 46, '', 40).setOrigin(0, 0.5).setDepth(d);
    this.levelText = text(this, W / 2, 46, '', 40, { color: '#fff3d6' }).setDepth(d);
    this.bestText = text(this, W - 96, 46, '', 30, { color: '#ffe9a0' }).setOrigin(1, 0.5).setDepth(d);
    this.muteBtn = text(this, W - 44, 46, Sfx.muted ? '🔇' : '🔊', 40, { strokeThickness: 0 }).setDepth(d);

    // "Next" demon, tap to swap.
    this.nextRing = this.add.circle(BOW_X - 190, BOW_Y + 6, 42, 0x0b0726, 0.6)
      .setStrokeStyle(3, GOLD, 0.8).setDepth(d);
    this.nextLabel = text(this, BOW_X - 190, BOW_Y + 66, 'NEXT ⇄', 24, { color: '#fff3d6' }).setDepth(d);

    // Shots until the sky drops another row, shown as little diya flames.
    this.dropLabel = text(this, BOW_X + 190, BOW_Y + 66, 'DROP', 24, { color: '#fff3d6' }).setDepth(d);
    this.dropDots = this.add.graphics().setDepth(d);
  }

  updateHud() {
    this.scoreText.setText(`${this.score}`);
    this.levelText.setText(`Level ${this.level}`);
    this.bestText.setText(`Best ${Math.max(bestScore(), this.score)}`);

    const total = this.levelConfig().shotsPerDrop;
    const g = this.dropDots.clear();
    const span = Math.min(28, 150 / total);
    for (let i = 0; i < total; i++) {
      const x = BOW_X + 190 + (i - (total - 1) / 2) * span;
      const lit = i < this.shotsLeft;
      g.fillStyle(lit ? 0xffb347 : 0x4a3a5a, lit ? 1 : 0.7).fillEllipse(x, BOW_Y + 14, 12, 20);
      if (lit) g.fillStyle(0xfff3c4).fillEllipse(x, BOW_Y + 18, 5, 9);
      g.fillStyle(0x8a3b12).fillRoundedRect(x - 9, BOW_Y + 24, 18, 8, 4);
    }

    // Warn when the demons get close to the line.
    const lowest = this.cells().reduce((m, c) => Math.max(m, this.cellXY(c.r, c.c).y), 0);
    const near = DANGER_Y - lowest < ROWH * 2.2;
    this.tweens.killTweensOf(this.dangerLine);
    if (near) this.tweens.add({ targets: this.dangerLine, alpha: { from: 0.4, to: 1 }, duration: 350, yoyo: true, repeat: -1 });
    else this.dangerLine.setAlpha(0.35);
  }

  // ── Bow ───────────────────────────────────────────────────────────────────
  buildBow() {
    this.aimAngle = -Math.PI / 2;
    this.pull = 0;
    this.tip = { x: BOW_X, y: BOW_Y - ARROW_LEN };
    this.add.image(BOW_X, BOW_Y + 10, 'shade').setScale(6.2, 2.6).setDepth(DEPTH.decor);
    this.bowGlow = this.add.image(BOW_X, BOW_Y, 'glow').setTint(0xffa83a).setScale(2.2).setAlpha(0.35)
      .setBlendMode('ADD').setDepth(DEPTH.bow);
    this.bow = this.add.graphics().setDepth(DEPTH.bow);
    this.loadedArrow = this.add.image(0, 0, 'arrow_0').setOrigin(0, 0.5).setDepth(DEPTH.bow);
    this.loadedGlow = this.add.image(0, 0, 'glow').setScale(0.55).setBlendMode('ADD').setDepth(DEPTH.bow);
    // "Next" arrow, standing upright in its ring.
    const nx = this.nextRing.x, ny = this.nextRing.y;
    this.nextGlow = this.add.image(nx, ny - 26, 'glow').setScale(0.45).setBlendMode('ADD').setDepth(DEPTH.hud);
    this.nextArrow = this.add.image(nx, ny, 'arrow_0').setScale(0.78).setAngle(-90).setDepth(DEPTH.hud);
  }

  drawBow() {
    const g = this.bow.clear();
    const a = this.aimAngle;
    const cos = Math.cos(a), sin = Math.sin(a);
    // Local frame: +x along the aim, +y across it. Rotate into world space.
    const P = (lx, ly) => ({ x: BOW_X + lx * cos - ly * sin, y: BOW_Y + lx * sin + ly * cos });

    const limb = [];
    for (let i = 0; i <= 24; i++) {
      const t = -1 + (2 * i) / 24;
      const recurve = Math.abs(t) > 0.82 ? (Math.abs(t) - 0.82) * 70 : 0;
      limb.push(P(30 * (1 - t * t) - 6 + recurve - this.pull * 6 * t * t, 82 * t));
    }
    const tipA = limb[0], tipB = limb[limb.length - 1];
    const nock = P(-6 - this.pull * 46, 0);

    g.lineStyle(3, 0xfff3d6, 0.95).beginPath();
    g.moveTo(tipA.x, tipA.y).lineTo(nock.x, nock.y).lineTo(tipB.x, tipB.y).strokePath();

    [[14, 0x3a1300], [9, 0xe2a12b], [3, 0xffe9a0]].forEach(([w, col]) => g.lineStyle(w, col).strokePoints(limb, false));
    const grip = P(24, 0);
    g.fillStyle(0xb3122e).fillCircle(grip.x, grip.y, 11);
    g.fillStyle(GOLD).fillCircle(grip.x, grip.y, 5);
    [tipA, tipB].forEach((p) => { g.fillStyle(0x3a1300).fillCircle(p.x, p.y, 8); g.fillStyle(GOLD).fillCircle(p.x, p.y, 5); });

    this.loadedArrow.setPosition(nock.x, nock.y).setRotation(a);
    this.tip = P(-6 - this.pull * 46 + ARROW_LEN - 6, 0);
    this.loadedGlow.setPosition(this.tip.x, this.tip.y);
  }

  refreshLoaded() {
    const cur = DEMONS[this.current], nxt = DEMONS[this.next];
    this.loadedArrow.setTexture(`arrow_${this.current}`).setVisible(true);
    this.loadedGlow.setTint(cur.tint).setVisible(true);
    this.nextArrow.setTexture(`arrow_${this.next}`);
    this.nextGlow.setTint(nxt.tint);
  }

  swap() {
    if (this.state !== 'ready') return;
    [this.current, this.next] = [this.next, this.current];
    this.refreshLoaded();
    this.tweens.add({ targets: this.nextArrow, angle: { from: -130, to: -90 }, duration: 250, ease: 'Back.easeOut' });
    Sfx.bounce();
  }

  toggleMute() {
    Sfx.unlock();
    this.muteBtn.setText(Music.toggleMute(this) ? '🔇' : '🔊');
  }

  // ── Input ─────────────────────────────────────────────────────────────────
  hit(p, obj, radius) { return Phaser.Math.Distance.Between(p.x, p.y, obj.x, obj.y) < radius; }

  onDown(p) {
    Sfx.unlock();
    if (this.hit(p, this.muteBtn, 40)) return this.toggleMute();
    if (this.hit(p, this.nextRing, 60)) return this.swap();
    if (this.state !== 'ready' || p.y < TOP) return;
    this.aiming = true;
    this.setAim(p);
    this.tweens.add({ targets: this, pull: 1, duration: 220, ease: 'Quad.easeOut' });
  }

  onMove(p) {
    if (this.state !== 'ready') return;
    // Mouse users get a live aim guide on hover; touch users only while dragging.
    if (this.aiming || !p.wasTouch) this.setAim(p);
  }

  onUp(p) {
    if (!this.aiming) return;
    this.aiming = false;
    this.setAim(p);
    if (this.state === 'ready' && p.y > TOP) this.fire();
  }

  setAim(p) {
    const a = Math.atan2(p.y - BOW_Y, p.x - BOW_X);
    // Keep the bow pointing upward, never flatter than ~8° above horizontal.
    const min = -Math.PI + 0.14, max = -0.14;
    this.aimAngle = a > Math.PI / 2 ? min : Phaser.Math.Clamp(a > 0 ? max : a, min, max);
    this.showGuide = true;
  }

  // ── Shooting ──────────────────────────────────────────────────────────────
  /** The demon cell the arrow tip at (x, y) is touching, if any. */
  demonAt(x, y) {
    const lim = (R * 0.9) ** 2;
    const r0 = Math.round((y - TOP - R) / ROWH);
    for (let r = Math.max(0, r0 - 1); r <= Math.min(MAX_ROWS - 1, r0 + 1); r++) {
      for (let c = 0; c < this.colsIn(r); c++) {
        if (!this.grid[r][c]) continue;
        const p = this.cellXY(r, c);
        if ((p.x - x) ** 2 + (p.y - y) ** 2 < lim) return { r, c };
      }
    }
    return null;
  }

  /**
   * Advance the arrow tip along its velocity, bouncing off the side walls.
   * Sets `s.hit` to the demon cell it struck, or 'top' for the garland; returns true when it stops.
   */
  step(s, ds) {
    s.x += s.vx * ds;
    s.y += s.vy * ds;
    let bounced = false;
    if (s.x < 8) { s.x = 16 - s.x; s.vx = Math.abs(s.vx); bounced = true; }
    if (s.x > W - 8) { s.x = 2 * (W - 8) - s.x; s.vx = -Math.abs(s.vx); bounced = true; }
    s.bounced = bounced;
    s.hit = s.y <= TOP ? 'top' : this.demonAt(s.x, s.y);
    return !!s.hit;
  }

  drawGuide() {
    const g = this.aimGfx.clear();
    if (!this.showGuide || this.state !== 'ready') return;
    const s = { x: this.tip.x, y: this.tip.y, vx: Math.cos(this.aimAngle), vy: Math.sin(this.aimAngle) };
    const tint = DEMONS[this.current].tint;
    let travelled = 0, bounces = 0;
    for (let i = 0; i < 400 && bounces < 3; i++) {
      if (this.step(s, 8)) break;
      if (s.bounced) bounces++;
      travelled += 8;
      if (travelled % 32 === 0) {
        const fade = 1 - travelled / 1800;
        if (fade <= 0) return;
        g.fillStyle(tint, 0.85 * fade).fillCircle(s.x, s.y, 5);
        g.fillStyle(0xffffff, 0.7 * fade).fillCircle(s.x, s.y, 2);
      }
    }
    // Ring the demon the arrow would hit: bright in the arrow's color if it matches, dim if it doesn't.
    if (s.hit && s.hit !== 'top') {
      const p = this.cellXY(s.hit.r, s.hit.c);
      const match = this.grid[s.hit.r][s.hit.c].color === this.current;
      if (match) g.lineStyle(5, tint, 0.95).strokeCircle(p.x, p.y, R + 4);
      else g.lineStyle(3, 0xffffff, 0.3).strokeCircle(p.x, p.y, R + 2);
    }
  }

  fire() {
    if (this.state !== 'ready') return;
    this.state = 'flying';
    this.showGuide = false;
    this.aimGfx.clear();
    Sfx.shoot();

    const color = this.current;
    const tint = DEMONS[color].tint;
    const vx = Math.cos(this.aimAngle) * SHOT_SPEED;
    const vy = Math.sin(this.aimAngle) * SHOT_SPEED;
    const arrow = this.add.image(0, 0, `arrow_${color}`).setOrigin(1, 0.5).setDepth(DEPTH.shot);
    const glow = this.add.image(0, 0, 'glow').setTint(tint).setScale(0.6).setBlendMode('ADD').setDepth(DEPTH.shot);
    const trail = this.add.particles(0, 0, 'spark', {
      follow: glow, frequency: 12, lifespan: 380, speed: { min: 10, max: 50 },
      scale: { start: 0.45, end: 0 }, alpha: { start: 0.9, end: 0 },
      tint: [tint, GOLD], blendMode: 'ADD',
    }).setDepth(DEPTH.shot);
    this.shot = { x: this.tip.x, y: this.tip.y, vx, vy, color, arrow, glow, trail };
    this.syncShot();

    this.loadedArrow.setVisible(false);
    this.loadedGlow.setVisible(false);
    this.tweens.killTweensOf(this);
    this.tweens.add({ targets: this, pull: 0, duration: 260, ease: 'Elastic.easeOut' });

    this.current = this.next;
    this.next = this.randomColor();
  }

  updateShot(dt) {
    const s = this.shot;
    const total = SHOT_SPEED * dt;
    const n = Math.ceil(total / (R / 4));
    for (let i = 0; i < n; i++) {
      const stop = this.step(s, dt / n);
      if (s.bounced) Sfx.bounce();
      if (stop) { this.syncShot(); return this.strike(s.hit); }
    }
    this.syncShot();
  }

  syncShot() {
    const s = this.shot;
    s.arrow.setPosition(s.x, s.y).setRotation(Math.atan2(s.vy, s.vx));
    s.glow.setPosition(s.x, s.y);
  }

  /** The arrow hit the garland or a demon. Matching colors pop the demon's whole same-color group. */
  strike(hit) {
    const s = this.shot;
    this.shot = null;
    s.trail.stop();
    this.time.delayedCall(450, () => s.trail.destroy());
    s.glow.destroy();

    const target = hit === 'top' ? null : this.grid[hit.r][hit.c];
    if (!target || target.color !== s.color) {
      this.missArrow(s, target);
      return this.afterShot(false);
    }

    // Direct hit: the arrow vanishes into the burst.
    s.arrow.destroy();
    const origin = this.cellXY(hit.r, hit.c);
    const group = this.flood(hit.r, hit.c, (o) => o.color === s.color);
    group
      .map(([r, c]) => ({ r, c, ...this.grid[r][c], ...this.cellXY(r, c) }))
      .sort((a, b) => Phaser.Math.Distance.Between(a.x, a.y, origin.x, origin.y) - Phaser.Math.Distance.Between(b.x, b.y, origin.x, origin.y))
      .forEach((o, i) => { this.grid[o.r][o.c] = null; this.popDemon(o, i * 55, i); });
    this.addScore(group.length * 10 + Math.max(0, group.length - 3) * 10, origin.x, origin.y);

    const dropped = this.dropFloating();
    if (group.length >= 6 || dropped >= 3) this.celebrate(Math.min(3, 1 + Math.floor((group.length + dropped) / 6)));
    // Only a big pop (3+ demons including fallers) saves a flame on the DROP counter.
    this.afterShot(group.length + dropped >= 3);
  }

  /** Wrong color (or the garland): the arrow glances off and tumbles away. */
  missArrow(s, target) {
    Sfx.land();
    if (target) {
      this.fx.emitter(0xffffff).core.explode(8, s.x, s.y);
      this.tweens.add({ targets: target.sprite, angle: { from: -12, to: 0 }, duration: 400, ease: 'Elastic.easeOut' });
    }
    const dir = s.vx >= 0 ? -1 : 1;
    this.tweens.add({
      targets: s.arrow, x: s.arrow.x + dir * Phaser.Math.Between(40, 90), y: s.arrow.y + 260,
      angle: s.arrow.angle + dir * Phaser.Math.Between(160, 260), alpha: 0, duration: 650, ease: 'Quad.easeIn',
      onComplete: () => s.arrow.destroy(),
    });
  }

  /** Cells connected to (r, c) whose content passes `match`. */
  flood(r, c, match) {
    const seen = new Set([`${r},${c}`]);
    const out = [[r, c]];
    for (let i = 0; i < out.length; i++) {
      for (const [a, b] of this.neighbors(...out[i])) {
        const k = `${a},${b}`;
        if (seen.has(k) || !this.grid[a][b] || !match(this.grid[a][b])) continue;
        seen.add(k);
        out.push([a, b]);
      }
    }
    return out;
  }

  popDemon(o, delay, i) {
    this.tweens.killTweensOf(o.sprite);
    this.time.delayedCall(delay, () => {
      this.fx.burst(o.x, o.y, DEMONS[o.color].tint);
      Sfx.pop(i);
      this.tweens.add({
        targets: o.sprite, scale: o.base * 1.5, alpha: 0, angle: Phaser.Math.Between(-30, 30), duration: 160,
        onComplete: () => o.sprite.destroy(),
      });
    });
  }

  dropFloating() {
    const anchored = new Set();
    for (let c = 0; c < this.colsIn(0); c++) {
      if (!this.grid[0][c]) continue;
      this.flood(0, c, () => true).forEach(([a, b]) => anchored.add(`${a},${b}`));
    }
    const falling = this.cells().filter((o) => !anchored.has(`${o.r},${o.c}`));
    falling.forEach((o, i) => {
      this.grid[o.r][o.c] = null;
      const sp = o.sprite;
      this.tweens.killTweensOf(sp);
      const boomAt = Phaser.Math.Between(380, 620);
      this.tweens.add({
        targets: sp, y: sp.y + 420, x: sp.x + Phaser.Math.Between(-60, 60), angle: Phaser.Math.Between(-200, 200),
        duration: boomAt, delay: 120 + i * 25, ease: 'Quad.easeIn',
        onComplete: () => {
          this.fx.burst(sp.x, sp.y, DEMONS[o.color].tint, { size: 1.2 });
          Sfx.pop(i + 4);
          sp.destroy();
        },
      });
    });
    if (falling.length) {
      const avgX = falling.reduce((s, o) => s + o.sprite.x, 0) / falling.length;
      this.time.delayedCall(250, () => this.addScore(falling.length * 25, avgX, falling[0].sprite.y + 60, '#ffb3f0'));
    }
    return falling.length;
  }

  celebrate(n) {
    for (let i = 0; i < n; i++) {
      this.time.delayedCall(i * 280, () => this.fx.rocket(Phaser.Math.Between(110, W - 110), Phaser.Math.Between(200, 480)));
    }
  }

  addScore(n, x, y, color = '#fff3a0') {
    this.score += n;
    this.updateHud();
    const t = text(this, x, y, `+${n}`, 46, { color }).setDepth(DEPTH.fx + 1);
    this.tweens.add({ targets: t, y: y - 90, alpha: 0, duration: 900, ease: 'Quad.easeOut', onComplete: () => t.destroy() });
  }

  afterShot(popped) {
    if (!this.cells().length) return this.levelCleared();

    if (!popped) {
      this.shotsLeft--;
      if (this.shotsLeft <= 0) {
        this.shotsLeft = this.levelConfig().shotsPerDrop;
        this.addRow();
      }
    }
    // The loaded demon must be a color that still exists on the board.
    const present = this.colorsOnBoard();
    if (!present.includes(this.current)) this.current = this.randomColor();
    if (!present.includes(this.next)) this.next = this.randomColor();
    this.refreshLoaded();
    this.updateHud();

    if (this.reachedDanger()) return this.gameOver();
    this.state = 'ready';
  }

  addRow() {
    Sfx.descend();
    this.grid.pop().forEach((cell) => cell && cell.sprite.destroy());
    this.parity ^= 1;
    this.grid.unshift(new Array(COLS).fill(null));
    this.cells().forEach((o) => this.tweens.add({ targets: o.sprite, y: this.cellXY(o.r, o.c).y, duration: 300, ease: 'Quad.easeOut' }));
    for (let c = 0; c < this.colsIn(0); c++) {
      const below = this.neighbors(0, c).map(([a, b]) => this.grid[a][b]).filter(Boolean);
      const color = below.length && Math.random() < 0.4 ? below[0].color : Phaser.Utils.Array.GetRandom(this.palette);
      this.place(0, c, color);
      const sp = this.grid[0][c].sprite;
      this.tweens.add({ targets: sp, y: { from: sp.y - ROWH, to: sp.y }, duration: 300, ease: 'Quad.easeOut' });
    }
    this.cameras.main.shake(180, 0.004);
  }

  reachedDanger() {
    return this.cells().some((o) => this.cellXY(o.r, o.c).y + R * 0.7 > DANGER_Y);
  }

  update(time, delta) {
    if (this.shot) this.updateShot(Math.min(delta, 50) / 1000);
    this.drawBow();
    this.drawGuide();
    this.bowGlow.setAlpha(0.3 + Math.sin(time / 400) * 0.08);
  }

  // ── End states ────────────────────────────────────────────────────────────
  saveBest() {
    if (this.score > bestScore()) { localStorage.setItem('diwali-best', String(this.score)); return true; }
    return false;
  }

  levelCleared() {
    this.state = 'over';
    const bonus = 200 * this.level;
    this.score += bonus;
    this.saveBest();
    this.updateHud();
    Sfx.win();
    Music.play(this, 'music_win', { loop: false, volume: 0.6 });
    this.celebrate(6);
    this.time.delayedCall(1800, () => this.celebrate(4));
    this.overlay('Shubh Deepavali!', `Level ${this.level} cleared\n+${bonus} bonus`, 'NEXT LEVEL', () => {
      this.level++;
      this.startLevel();
    });
  }

  gameOver() {
    this.state = 'over';
    const record = this.saveBest();
    Sfx.lose();
    Music.fadeOut(this, 1200);
    this.cameras.main.shake(300, 0.008);
    this.overlay('The demons\nreached the diyas!', `Score ${this.score}${record ? '\nNew best!' : ''}`, 'PLAY AGAIN', () => {
      this.scene.restart();
    });
    if (record) this.celebrate(4);
  }

  overlay(title, body, label, onClick) {
    const box = this.add.container(W / 2, H / 2).setDepth(DEPTH.overlay);
    const dim = this.add.rectangle(0, 0, W, H, 0x050214, 0.6).setInteractive();
    const panel = this.add.graphics();
    panel.fillStyle(0x3a1300).fillRoundedRect(-300, -250, 600, 500, 36);
    panel.fillStyle(0x1b1145).fillRoundedRect(-292, -242, 584, 484, 30);
    panel.lineStyle(3, GOLD, 0.8).strokeRoundedRect(-280, -230, 560, 460, 24);
    const t1 = text(this, 0, -130, title, 58).setLineSpacing(-14);
    const t2 = text(this, 0, 10, body, 40, { color: '#fff3d6' });
    const btn = this.add.container(0, 160);
    const bg = this.add.graphics();
    bg.fillStyle(0x3a1300).fillRoundedRect(-170, -46, 340, 92, 46);
    bg.fillStyle(0xff8a1f).fillRoundedRect(-164, -40, 328, 80, 40);
    bg.fillStyle(0xffc65a).fillRoundedRect(-150, -36, 300, 30, 15);
    btn.add([bg, text(this, 0, 2, label, 42, { color: '#fff8e6' })]);
    btn.setSize(340, 92).setInteractive({ useHandCursor: true });
    box.add([dim, panel, t1, t2, btn]);
    box.setScale(0.6).setAlpha(0);
    this.tweens.add({ targets: box, scale: 1, alpha: 1, duration: 400, delay: 500, ease: 'Back.easeOut' });
    btn.once('pointerup', () => { box.destroy(); onClick(); });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
function startGame() {
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: W,
    height: H,
    transparent: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    input: { activePointers: 2 },
    scene: [BootScene, MenuScene, GameScene],
    callbacks: {
      // Web Audio only; with Phaser's HTML5 Audio fallback the effects stay silent.
      postBoot: (game) => { if (game.sound.context) Sfx.attach(game.sound); },
    },
  });
}

// Wait (briefly) for the web font so canvas text renders in Baloo 2.
Promise.race([
  document.fonts?.load(`800 40px ${FONT}`) ?? Promise.resolve(),
  new Promise((r) => setTimeout(r, 1500)),
]).finally(startGame);
