# Diwali Demon Pop

A bubble shooter for Diwali night, built with [Phaser 3](https://phaser.io) (vendored in `lib/`, no build step).
Cute demon heads fill the night sky, and you shoot colored arrows at them with a golden bow. An arrow pops a
demon of its own color, along with every same-color demon touching it, in a burst of fireworks. Any demons
left hanging fall and explode too. After a few weak shots, the sky drops a new row. If the demons reach the
diyas, the game is over.

## Play

```sh
npm start            # serves the folder on http://localhost:8080 (any static server works)
```

Open it on a phone or a laptop. The playfield scales to fit and stretches to fill tall phone screens.

- **Aim:** drag on touch screens; on a laptop, move the mouse. Release or click to shoot. `Space` also shoots.
- **Swap:** tap the NEXT arrow, or press `S`.
- **Mute:** tap the speaker, or press `M`.

## How it works

### Shooting and matching

- Every arrow has a colored head and flies until it touches the first demon in its path. Arrows bounce off
  the side walls.
- **Matching color:** the demon pops, along with every demon of the same color connected to it.
- **Wrong color:** the arrow glances off and nothing pops. An arrow that reaches the garland at the top
  pops nothing either.
- After a pop, any demons no longer connected to the top fall and explode too.
- The aim guide puts a ring around the demon your arrow will hit. The ring is bright in the arrow's color if
  the colors match, and faint white if they don't.
- You only ever get arrows in colors still on the board. The NEXT arrow can be swapped in, which helps when
  no demon of the current color is in reach.

### The sky drops

The diya flames next to the bow (**DROP**) count down your weak shots. A weak shot is a miss, a wrong color,
or a pop of fewer than 3 demons in total (falling demons count). When the last flame goes out, a new row of
demons slides in from the top and pushes the board down, and the flames refill. A shot that pops 3 or more
demons doesn't use up a flame, so it pays to aim for big groups and for demons holding up others.

### Winning and losing

- **Level clear:** pop every demon on the board. You get a bonus, a fireworks show, and the next level.
- **Game over:** a demon crosses the dashed line above the diyas. The line starts pulsing when the board
  is within about two rows of it.

### Levels

Each level starts with more rows and more colors, and the sky drops sooner:

| Level | Starting rows | Colors | Weak shots before a new row |
|------:|--------------:|-------:|----------------------------:|
| 1     | 5             | 4      | 7                       |
| 2     | 6             | 5      | 6                       |
| 3     | 7             | 6      | 5                       |
| 4     | 8             | 6      | 4                       |
| 5     | 9             | 6      | 3                       |
| 6+    | 10            | 6      | 3                       |

Each level picks its colors at random from the six demons. Starting boards are biased towards clumps of the
same color, so there are good groups to aim for. Your score carries over from level to level. Game over starts
you again from level 1.

### Scoring

| Action                          | Points                                  |
|---------------------------------|-----------------------------------------|
| Popping a same-color group      | 10 per demon, +10 for each beyond 3     |
| Demons that fall after a pop    | 25 each                                 |
| Clearing a level                | 200 × level number                      |

Popping 6+ demons in one group, or dropping 3+, launches celebration rockets. The best score is saved in
the browser (`localStorage`).

To tune the difficulty, edit `levelConfig()` in `src/game.js`.

## Art

The demon heads and backgrounds in `assets/` were generated with Google Vertex AI (Nano Banana 2,
`gemini-3.1-flash-image`). The generator uses the same service-account flow as storybook-kit's `gemini-storygen`
skill. The red demon is generated first and used as the style reference for the other five colors.
Backgrounds are removed with ImageMagick.

```sh
npm run assets                          # only generates what's missing in assets/raw
node tools/generate-assets.mjs --force --only demon_blue,bg_portrait
```

Credentials come from `VERTEX_SA_KEY` in `./.env` or `../storybook-kit/.env`. The login code is shared by both
generator scripts (`tools/vertex.mjs`).

## Music and sound

The music in `assets/music/` was composed with Google Lyria (`lyria-002` on Vertex AI). Each prompt asks for
fun, whimsical, instrumental casual-game music: glockenspiel, celesta, marimba, xylophone, pizzicato strings,
woodwinds and light percussion.

| Track      | When it plays                                   |
|------------|-------------------------------------------------|
| `menu.mp3` | Title screen. Cozy music-box feel, loops.       |
| `game.mp3` | During play. Bouncy and playful, loops.         |
| `win.mp3`  | Level cleared. A 7-second victory jingle.       |

The music crossfades between tracks and fades out on game over. Lyria returns about 30 seconds per prompt, so
the script crossfades the end of each looping track into its start so it repeats without a seam. It then
encodes everything to MP3 with ffmpeg.

```sh
npm run music                           # only composes tracks missing from assets/raw
node tools/generate-music.mjs --force --only game
```

The raw Lyria WAVs (about 6 MB each) are kept out of git. Sound effects are synthesized at runtime with Web Audio
(`src/sfx.js`). The speaker button (or `M`) mutes music and effects together, on both the title screen and in game.
