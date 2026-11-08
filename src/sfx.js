// Tiny synthesized sound effects (Web Audio), so the game ships with no audio files.
// They share Phaser's AudioContext with the music, and this file also owns unlocking it on phones.

// iOS mutes Web Audio while the ring/silent switch is on, unless the page says it plays media.
try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* unsupported */ }

const Sfx = (() => {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = localStorage.getItem('diwali-muted') === '1';

  /** Use Phaser's AudioContext and keep it unlocked; `soundManager` is game.sound. */
  function attach(soundManager) {
    ctx = soundManager.context;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Phaser stops trying to unlock if the browser rejects its first attempt (iOS can on touchstart),
    // which leaves the music waiting forever. Tell Phaser whenever the context starts running.
    ctx.addEventListener('statechange', () => {
      if (ctx.state === 'running' && soundManager.locked) soundManager.unlocked = true;
    });
    // Retry on every real gesture (touchend/click count as user activation on iOS; touchstart may not),
    // and after the page comes back from the background, when iOS suspends or interrupts the context.
    ['touchend', 'pointerup', 'click', 'keydown'].forEach((e) => document.addEventListener(e, unlock, true));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) unlock(); });
  }

  function unlock() {
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
    ctx.resume().catch(() => {});
    // Older iOS only fully wakes the context once a sound starts inside the gesture.
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
  }

  const ready = () => ctx && !muted;

  function tone(type, f0, f1, dur, vol, delay = 0) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noise(dur, vol, filterType, freq, delay = 0) {
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  return {
    attach,
    unlock,
    get muted() { return muted; },
    toggleMute() {
      muted = !muted;
      localStorage.setItem('diwali-muted', muted ? '1' : '0');
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    shoot() {
      if (!ready()) return;
      tone('triangle', 330, 90, 0.18, 0.35);
      noise(0.08, 0.25, 'highpass', 3000);
    },
    bounce() { if (ready()) tone('sine', 900, 700, 0.05, 0.12); },
    land() { if (ready()) tone('sine', 180, 90, 0.12, 0.3); },
    pop(i = 0) {
      if (!ready()) return;
      const f = 520 * Math.pow(1.06, Math.min(i, 18));
      tone('sine', f, f * 1.8, 0.12, 0.22);
      noise(0.25, 0.12, 'bandpass', 2500 + Math.random() * 2000, 0.03);
    },
    boom() {
      if (!ready()) return;
      noise(0.7, 0.45, 'lowpass', 600);
      for (let i = 0; i < 10; i++) noise(0.04, 0.12, 'highpass', 4000, 0.25 + Math.random() * 0.6);
    },
    whistle() { if (ready()) tone('sine', 600, 1800, 0.6, 0.06); },
    descend() { if (ready()) tone('square', 160, 80, 0.3, 0.12); },
    win() {
      if (!ready()) return;
      [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.25, 0.25, i * 0.12));
    },
    lose() {
      if (!ready()) return;
      [392, 330, 262, 196].forEach((f, i) => tone('triangle', f, f * 0.98, 0.3, 0.25, i * 0.18));
    },
  };
})();
