# Design

Owner: `designer`. This document is the source of truth for tokens, type, copy shape and layout across
`apps/web` and the Discord embeds. If a UI task disagrees with this file, this file is wrong or the task is —
say which, do not invent a third answer.

## Who is looking at this, and where

A phone, held at arm's length, in a dark room, opened from a WhatsApp link, while the person is already in
Discord voice and about to be in a game. They have three questions, in this order:

1. **Am I in, and which side?**
2. **Why these teams?**
3. **What happened?**

Everything below is ordered by those three questions. Dark theme is the default, not the alternate. Phone
widths are the design width; the desktop layout adds a second column and a rail, not a bigger phone.

Tone, **amended 2026-09-09 by the user's own calibration**: *"it should look like an actual gaming product,
modern, something like Blitz and so, with its own character and style."* v1 read this as a scoreboard in a
friend's living room and built something so restrained it looked unfinished. The corrected tone is a **games
product for twenty friends**: dense, lit, confident, and still honest. Plain nouns, real numbers, no hype;
never "GG", never "EPIC", never a broadcast lower-third — but also never a bare list on a black field. The
subject has a vocabulary — `top jungle mid adc support`, blue 100 and red 200, ranks, ratings — and that
vocabulary is the content. It is never decoration. The system that carries it is **Floodlit**, next.

## Floodlit — the v2 system (2026-09-09)

**Supersedes** the `Palette`, `Type` and `Spacing, size, motion` sections below, and the tonight-page half of
`Components`. Those sections are kept, retitled `v1 — superseded`, because the embed sections and several
component rules still quote them and because a superseded decision is worth more than a deleted one. **Where
v1 and this section disagree, this section wins.** The Discord embed sections are untouched: Discord has no
CSS and nothing here reaches it.

Why there is a v2 at all: the deployed page (screenshot, 2026-09-09, 430px) renders v1 faithfully and reads as
unfinished. No wordmark, no date, no navigation, one unexplained number per row, the word `flexible` nine
times, and 449px of empty reserved card. The user's own words on what it should be instead: *"it should look
like an actual gaming product, modern, something like Blitz and so, with its own character and style."* v1 was
restrained to the point of having no character. This one has one, and the character is named so that every
later choice has something to be checked against.

### The character, in one sentence

> **Floodlit: a dark stadium after dark — near-black ink, one warm light overhead, and the ten names lit up
> under it in blue and red.**

Five rules fall straight out of it, and every visual decision in this section is one of them:

1. **The light comes from above, and there is one of it.** Surfaces are lit on their top edge (a 1px inner
   highlight) and sit on a background that is faintly warmer at the top of the page than at the bottom. There
   is exactly one glow in the product — the live pill — because there is one lamp.
2. **Ink, not grey.** The background is a blue-black at `#0B0E14`, not a neutral charcoal, so the two side
   colours sit on something that belongs to them. Never `#000`: pure black smears text on an OLED phone.
3. **Colour is a team, a state, or nothing.** Blue is side 100, red is side 200, amber is the light — live,
   you, off-role, the winner's ring, the control you may press. There is no fourth colour and no decorative
   use of the first three.
4. **Dense, like a stats site.** Rows are tight, numbers are tabular, labels are small and always present. A
   card that shows five facts is better than a card that shows one fact large. The only large type in the
   product is a result and a count.
5. **Structure over ornament.** Rules, tints, rings and one gradient. No glass blur, no neon, no champion art,
   no crest, no emoji, no purple.

### Palette

Nine named tokens per theme, up from seven. The two new ones are the reason the page can look built: a second
surface to raise things onto, and a line colour that is a colour rather than an alpha guess.

| Token | Role | Dark | Light |
|---|---|---|---|
| `bg` | Page ink. Blue-black. | `#0B0E14` | `#EEF1F6` |
| `surface` | Cards, rows, strips. | `#141923` | `#FFFFFF` |
| `raise` | The layer above a card: card headers, chips, tabs, the top bar, empty seats' contrast partner. | `#1D2431` | `#E4E9F1` |
| `line` | Every hairline and card border. A real colour, so borders are the same on all three surfaces. | `#2A3140` | `#D5DCE7` |
| `text` | Everything you are meant to read. | `#EEF2F8` | `#10141B` |
| `dim` | Labels, counts, secondary lines. Never a player's name, never a rating. | `#94A0B2` | `#556072` |
| `blue` | Side 100. | `#4C9AFF` | `#1F5FC4` |
| `red` | Side 200. | `#FF6B63` | `#B4302B` |
| `brand` | Amber. The light. Live state, "you", off-role, the reroll control, the winner's ring, the wordmark's one lit letterform, links. **Renamed from `accent`; every rule that said `accent` now says `brand`, unchanged.** | `#FFB13C` | `#8A5A0B` |

Contrast, measured (WCAG 2.1, computed 2026-09-09 — not eyeballed):

| | on `bg` dark | on `surface` dark | on `raise` dark | on `surface` light | on `raise` light |
|---|---|---|---|---|---|
| `text` | 17.19 | 15.67 | 13.86 | 18.45 | 15.14 |
| `dim` | 7.29 | 6.65 | 5.88 | 6.36 | 5.22 |
| `blue` | 6.78 | 6.18 | 5.47 | 6.01 | 4.93 |
| `red` | 6.93 | 6.32 | 5.59 | 6.18 | 5.07 |
| `brand` | 10.68 | 9.73 | 8.60 | 5.92 | 4.85 |

Everything passes AA on every surface in both themes. **Blue and red are within 0.15 of each other in dark**
(6.18 / 6.32, against v1's 1.1 spread): if one side were brighter, that side would read as the favoured one
before anybody read a number. `brand` at 9.73 is deliberately the brightest thing on a dark page — it is the
lamp, and it is only ever on a few square centimetres at a time.

**Derived values. Do not add hex; derive.**

```
blue tint      color-mix(in srgb, var(--cn-blue) 10%, var(--cn-surface))
red tint       color-mix(in srgb, var(--cn-red) 10%, var(--cn-surface))
brand tint     color-mix(in srgb, var(--cn-brand) 12%, var(--cn-surface))
blue line      color-mix(in srgb, var(--cn-blue) 55%, var(--cn-line))
red line       color-mix(in srgb, var(--cn-red) 55%, var(--cn-line))
pressed        color-mix(in srgb, var(--cn-text) 8%, var(--cn-raise))
lit            inset 0 1px 0 color-mix(in srgb, #ffffff 6%, transparent)     /* the top-edge highlight */
glow           0 0 0 4px color-mix(in srgb, var(--cn-brand) 14%, transparent) /* the live pill, and nothing else */
```

**The one gradient in the product.** The shell carries a single soft radial at the top, the floodlight:

```css
background:
  radial-gradient(120% 70% at 50% -15%, color-mix(in srgb, var(--cn-brand) 5%, transparent), transparent 65%),
  var(--cn-bg);
```

5% amber over 65% of the fold. It is felt, not seen, and it is what stops a 1400px desktop viewport from
being a flat black field. It is fixed to the shell, does not scroll, and is the only `linear`/`radial-gradient`
allowed anywhere in `apps/web`. No purple, no teal, no two-stop brand ramp behind a hero.

**Colour rules that survive v1 unchanged, and are still the ones people break:**

- A side colour is a rule, a text colour, a ring, or a tint at 10%. **Never a filled block behind five names.**
- **Rating deltas are never coloured by sign.** No green. A gain is `text` at 600, a loss is `dim` at 400, both
  always signed. Green-for-good collides with `red` meaning side 200.
- Nothing pulses but the live dot. Nothing shimmers. There are no skeletons.

### Type

Two families. Archivo is loaded as a **variable font with the width axis**, which buys a display cut with no
second download: `next/font/google` supports `axes` on variable families.

| Family | Role | How | Fallback |
|---|---|---|---|
| **Archivo** (`wght` 400–800, `wdth` 100–125) | Everything read as language, plus the display cut. Normal width for names, copy and labels; **`wdth` 118 at weight 800 for display** — the result headline, the lobby count, the wordmark. A wide grotesque at 800 is a scoreboard face; it is also not what an AI page looks like, which is a thin serif or a geometric sans. | `Archivo({ subsets:['latin'], axes:['wdth'], display:'swap', variable:'--cn-font-archivo' })` | `'Helvetica Neue', Arial, system-ui, sans-serif` |
| **IBM Plex Mono** (400, 600) | Everything read as data: ratings, deltas, gap, percentages, duration, rank, role words, lobby password, PUUID fragments. Tabular figures, a distinguishable `1`/`l`, a real minus. | unchanged from v1 | `ui-monospace, 'SF Mono', Menlo, monospace` |

The split is still the whole system: **number or role → mono; person or sentence → Archivo.** Every numeric run
sets `font-variant-numeric: tabular-nums`.

The display cut is one utility, used in four places and nowhere else:

```css
.cn-display {
  font-family: var(--cn-font-sans);
  font-variation-settings: 'wdth' 118;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.02;
}
```

If the `wdth` axis is a problem in `next/font` for any reason, the fallback is plain Archivo 800 with
`letter-spacing: -0.02em` and the page loses a little character and nothing else. Do not substitute a second
family for it.

#### Scale

Root 16px. Body 17px — the page is read at arm's length. Nothing that carries meaning goes below 12px.

| Token | Phone | ≥720px | Line height | Used for |
|---|---|---|---|---|
| `t-xs` | 12px | 12px | 1.35 | role words, chips, legends, per-row meta, nav tabs |
| `t-sm` | 14px | 14px | 1.4 | deltas, duration, the status sentence, footer |
| `t-base` | 17px | 17px | 1.5 | body, the explanation line, sit-out copy |
| `t-md` | 19px | 19px | 1.25 | player names in rows, ratings |
| `t-lg` | 24px | 26px | 1.2 | side names, card and section headings |
| `t-xl` | 32px | 36px | 1.1 | the wordmark's home for growth; secondary headlines |
| `t-display` | 44px | 56px | 1.02 | **two things only**: the lobby count and the result headline |

Weights: 400 body, 500 labels, 600 names and numbers that matter, 800 display only. **No 300, ever.**

Letter-spacing: `-0.02em` on `t-display`, `-0.01em` on `t-lg` and `t-xl`, `0.06em` on mono role words and
`0.08em` on mono micro-labels (`live`, `open`, legends), which are always lower case — `top`, `adc`, never
`TOP`. **Upper case is allowed on the display cut only** (`BLUE WINS`), because that is a scoreboard and not a
role.

### Space, shape, elevation, motion

4px base, unchanged: `sp-1` 4, `sp-2` 8, `sp-3` 12, `sp-4` 16, `sp-5` 24, `sp-6` 32, `sp-7` 48, `sp-8` 64.

- Radius: `10px` on cards, `8px` on inner rows and buttons, `4px` on chips, `0` on hairlines. Softer than v1's
  6px because cards are now layered and a tight radius on a stack reads as a table.
- **Every card is: `surface` fill, 1px `line` border, `lit` inner top highlight.** That trio is the whole
  elevation system. There is no shadow anywhere else; a dark UI gets depth from a lit edge, not from a blur.
- `raise` is the layer *inside* a card: the card's header bar, chips, the nav tabs, the top bar itself.
- Every tappable thing is at least **44 × 44px**, including role taps (M3.6), the reroll button, the nav tabs
  and every footer link.
- Motion: `opacity 150ms ease` for anything appearing, `background-color 120ms` and `transform: scale(.985)`
  on press for buttons and tabs, a 2s opacity cycle on the live dot. Nothing else moves.
  `prefers-reduced-motion: reduce` drops all of it including the pulse.

### Iconography

Inline SVG, drawn in this repo, `currentColor`, 24×24 viewBox, `stroke-width: 2`, round caps and joins, no
fill. One component, `apps/web/app/_icons/RoleIcon.tsx`, five paths. **The icon never appears without its
word** — it is an anchor for the eye in a dense row, not a replacement for language — and it is always
`aria-hidden`, because the word beside it is the accessible name.

```
frame (top/mid/adc only, stroke at 35% opacity)   <rect x="3.5" y="3.5" width="17" height="17" rx="4"/>
top        M6 18 V6 H18
mid        M6 18 L18 6
adc        M6 18 H18 V6
jungle     M18 6 C9 6 6 9 6 18 C15 18 18 15 18 6 Z     +  M9 15 L15 9
support    M12 4 L19 7 v5 c0 4 -3 6.5 -7 8 c-4 -1.5 -7 -4 -7 -8 V7 Z
```

Sizes: 14px beside a name in a row, 16px in a card header, 20px on `/p/[puuid]`. Colour: `dim` normally,
`brand` when the seat is off-role, the side colour never — a role is not a team.

**Sides get no icon and no crest.** A side is a 4px rule in its colour on the card's leading edge plus its name
in the display cut. There is no asset pipeline in this project and there should not be one.

The only other glyph in the product is the live dot: an 8px circle, `brand`, inside a `raise` pill with the
word `live` in mono `t-xs`. The pill carries the `glow` shadow. That is the one glow.

### The app shell

Every page of `apps/web` outside `/admin` gets the same shell. It is what makes the tonight page a page of a
product rather than a document that happens to be dark.

```
┌───────────────────────────────────────────────────────────────┐
│  ▍CUSTOMS NIGHT           Tonight  Leaderboard  Stats  Get ↗  │  top bar: raise, 1px line under
├───────────────────────────────────────────────────────────────┤
│                                                               │
│   … page content, on the ink, under the floodlight …          │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│  How this works · Get the companion · Your games              │  footer: dim, t-sm
└───────────────────────────────────────────────────────────────┘
```

- **Wordmark.** `CUSTOMS NIGHT` in the display cut at `t-md`, upper case, letter-spacing `0.02em`, in `text`,
  preceded by a 3px × 18px `brand` bar (`▍`). That bar is the lamp and it is the entire logo. No image, no
  favicon work beyond a 32px version of the bar on ink.
- **Nav.** Tabs, mono `t-xs`, `0.08em`, lower case is wrong here — these are destinations, so Archivo `t-sm`
  500 in `dim`, the current one in `text` with a 2px `brand` underline. Order: `Tonight`, `Leaderboard`,
  `Stats`, `Get the app ↗`. **A tab is rendered only if its route exists**: `Leaderboard` lands with M3.5,
  `Stats` with M5.4, `Get the app` is external and always there. A nav item that 404s is worse than a missing
  one. Keep the list in one exported array (`lib/nav.ts`) so no page hand-writes it.
- **Phone.** Two rows: wordmark row (44px), then the tab row (44px, tabs left aligned, horizontally scrollable
  with no scrollbar if a fifth destination ever exists). Not sticky — a sticky bar costs 88px of a 700px
  screen on the one page people read in full.
- **Desktop (≥720px).** One row: wordmark left, tabs right.
- **The live pill is not in the top bar.** It belongs to the status strip, next to the state it describes, and
  a product has one place for a piece of information. The top bar carries identity and destinations only.
- **Footer.** One line of links, `t-sm` `dim`, top border `line`, `sp-6` above it. The date and season are the
  status strip's slug line and are not repeated here. `Your games` appears only for a signed-in viewer and points at
  `/p/<their puuid>`. `Get the companion` points at the **releases page**, not the `.exe` — the tonight page
  is opened on a phone, and a link that starts a 90MB Windows download on a phone is a bug:
  `https://github.com/suyaser/kustom-releases/releases/latest`. The direct `.../latest/download/CustomsNight.exe`
  link stays on `/admin` and in the group chat, where the reader is on the PC that needs it.
- **`How this works`** is a `<details>` in the footer, closed by default, four short lines. No new route, no
  new data, and the one place on the page allowed to change height — because a person tapped it.

Shell CSS, in outline:

```css
.cn-shell {                      /* wraps top bar, main, footer */
  min-height: 100svh;            /* svh, not vh: the phone URL bar must not move the footer */
  display: flex; flex-direction: column;
  background:
    radial-gradient(120% 70% at 50% -15%, color-mix(in srgb, var(--cn-brand) 5%, transparent), transparent 65%),
    var(--cn-bg);
}
.cn-topbar { background: var(--cn-raise); border-bottom: 1px solid var(--cn-line); }
.cn-topbar-inner, .cn-main, .cn-footer-inner {
  max-width: 76rem; margin: 0 auto; width: 100%;
  padding-inline: var(--cn-sp-4);
}
.cn-main { flex: 1; padding-block: var(--cn-sp-5) var(--cn-sp-7); }
.cn-footer { margin-top: auto; border-top: 1px solid var(--cn-line); }
@supports (padding: max(0px)) {
  .cn-topbar-inner { padding-top: max(0px, env(safe-area-inset-top)); }
  .cn-footer-inner { padding-bottom: max(var(--cn-sp-5), env(safe-area-inset-bottom)); }
}
```

### Breakpoints and the desktop grid

Three widths, and no fourth:

| Width | Layout |
|---|---|
| `< 720px` | One column, full width inside `sp-4` gutters. The design width. |
| `≥ 720px` | One column, `max-width: 44rem`, centred; team cards go side by side, blue left; gutters `sp-5`. |
| `≥ 1080px` | **Two columns**: main `minmax(0, 1fr)`, rail `20rem`, gap `sp-6`, the pair centred inside the shell's 76rem. |

The rail is what stops a phone column floating in a black field, and it is never empty:

```
≥1080px
┌ main ─────────────────────────────┐ ┌ rail ──────────────┐
│ status strip                      │ │ Top of the board   │
│ primary block (seats/teams/result)│ │  5 rows            │
│                                   │ │                    │
│                                   │ │ How this works     │
│                                   │ │  4 lines           │
│                                   │ │                    │
│                                   │ │ Run the companion  │
│                                   │ │  1 line + link     │
└───────────────────────────────────┘ └────────────────────┘
```

- `Top of the board` is the leaderboard's first five rows, reusing M3.5's row component and a
  `loadTopPlayers(client, { limit: 5 })`. It ships **with M3.5**; until then the rail holds the other two
  cards and nothing looks broken.
- The rail is `display: none` below 1080px. Its content is duplicated in the footer (`How this works`,
  `Get the companion`), so a phone loses no information.
- **The rail never carries state.** No live data that changes under a thumb, no reroll, no role tap. It is
  three static cards and a board snapshot that refreshes with the page.

### The tonight page v2

The two rules from v1 that do **not** change, and that nothing below is allowed to bend:

- **One primary block**, chosen from `lobbies.status` for the newest non-abandoned lobby tonight, replaced in
  place. The state table in "The tonight page's three states — one rule" is still the state table.
- **No layout shift inside a state.** A join, a name arriving, a reroll: none of them may move a pixel that a
  thumb is already over. v2 keeps this by making the reserved space *content* instead of emptiness.

#### The status strip

Always mounted, the only element that survives every transition, and now three lines instead of one:

```
TUESDAY 9 SEPTEMBER · SEASON 2                    ← slug: mono t-xs, dim, 0.08em, upper case
9 IN THE LOBBY                          ● live    ← headline: count t-display brand + label t-lg display, upper
One more to go.                                   ← sentence: t-sm dim, two lines reserved
```

- The **slug** is the night's date (from `nightStart`, so a 01:00 game still says Tuesday) and the active
  season's name. It is the line that tells a friend from WhatsApp what they are looking at and when.
  Formatted **on the server and in the snapshot**, `Intl.DateTimeFormat('en-GB', { weekday:'long',
  day:'numeric', month:'long', timeZone: CUSTOMS_NIGHT_TZ })` — a fixed locale and the configured timezone, or
  the browser re-render disagrees with the server render and the line changes under the reader. When no season
  is active the slug is the date alone; the no-season sentence (M3.17) is unchanged and stays directly below
  the strip.
- The **headline** is `<count> IN THE LOBBY` while filling and one word or phrase otherwise:
  `NOTHING TONIGHT`, `TEAMS ARE SET`, `IN GAME`, `FINAL`. The count is `t-display` in `brand`; the label is
  `t-lg`, display cut, upper case, `text`.
- The **live pill** sits at the right end of the headline row: `raise` fill, 4px radius, an 8px `brand` dot on
  a 2s opacity cycle, the word `live` in mono `t-xs` `0.08em` `dim`, and the `glow` shadow. It is the only
  glow in the product and the only pulse. It is gone at `finished` and on the idle page. The word is the
  accessible text; the dot is `aria-hidden`. **The v1 dot with no word is a defect**: a pulsing orange circle
  that nothing names means nothing.
- The **sentence** is the page's one polite live region (`aria-live="polite"`) and is given
  `min-height: calc(2 * 1.4 * var(--cn-t-sm))` so that any sentence up to two lines on a 390px screen changes
  without moving the block below it. It changes with the count, which is the one text on the page that changes
  without a state change.
- The **ten bars of v1 are removed.** The seat rack below says the same thing with names in it.

#### Filling — the seat rack

The v1 list reserved 449px and left it blank, which on a six-person night is four rows of empty card and is
what "unfinished" looks like. v2 renders **ten seats, always**, and an unfilled seat is a seat.

```
┌ SEATS · 9 of 10 ─────────────────────── rating ┐   header: raise, 32px, mono t-xs dim
│  1sec Reloading                           1612 │   44px rows, hairline between
│  FoxHound                                 1612 │
│▌ PRT Empty                                1252 │   ▌ = 2px brand inset rule: you
│  PRT Khokha                               1553 │
│  Raafat                                   1688 │
│  Ramzyinhović                             1274 │
│  Rano of Zaun                             1373 │
│  SugarPapy                                1576 │
│  The Single Guy                           1634 │
│  open                                          │   recessed: bg fill, `open` mono t-xs dim 0.08em
└────────────────────────────────────────────────┘
Nobody has a role set, so the balancer treats everyone as flexible.
```

- The rack is exactly ten rows tall at every count, so the 9 → 10 join replaces `open` with a name and moves
  nothing. This is the same guarantee as v1's `min-height`, kept as content rather than as a number that has to
  agree with a font. `10 × 44px + 9px` is still the arithmetic and `rowHeight.test.ts` still guards it — it
  now also asserts that ten `<li>` are rendered at every count.
- An empty seat is filled with `var(--cn-bg)` — recessed below the card — so the rack reads as a rack. It is
  not a skeleton: it does not shimmer, it does not fade, and it is the same on the server and the client.
- Header: `SEATS · 9 of 10` left, `rating` right, both mono `t-xs` `dim` `0.08em`. **That `rating` legend is
  the fix for "1612 means nothing".** One 12px word, right-aligned over the column, in exactly the pattern the
  leaderboard already uses (`Proven · Rating` as a legend, not a header row).
- Row grid: `[you] name 1fr · role 6.5rem · rating 4.5rem`, gap `sp-4`. The v1 grid was `1fr auto auto` with a
  12px gap, which let `flexible` and `1612` collide into one blob against the right edge. Fixed columns give
  the eye an edge and are what a stats site looks like.
- **`flexible` only appears when it distinguishes.** If *no* member on screen has a role, the role column is
  not rendered at all and one line under the rack says so once. If *some* do, every row shows its roles and
  the ones with none show `flexible`, because there the word is contrastive information. Nine identical grey
  words in a column is not information; it looks like a field that failed to load.
- Roles, when shown: `RoleIcon` at 14px + the role word, mono `t-xs` `dim`; a secondary role follows in the
  same treatment after a middot, no icon. `top · mid`, never `top / mid` — a slash between two roles reads as
  a fraction next to a column of numbers.
- The "just joined" 2px `brand` inset rule and the permanent "you" rule are unchanged from v1, including the
  reason they are inset shadows rather than borders.
- People past the ten sit under the rack, under a `raise` divider labelled `Around`, in the same row shape.
  Nothing is reserved for them.
- Empty lobby: the rack renders ten `open` seats and `Nobody in the lobby yet.` sits under it. A rack of ten
  empty seats is a better empty state than a sentence alone, and it is the same component.

#### Teams

```
┌ SITTING OUT ───────────────────────────────────┐   raise header + brand 3px left rule
│ Sitting out this game: Sara and Deniz. Each    │
│ game goes to whoever has played least tonight… │
└────────────────────────────────────────────────┘

┏━━━━━━━━━━━━━━ 4px blue ━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ BLUE                                      7695 ┃  raise header: side name display t-lg blue, sum mono t-md dim
┠────────────────────────────────────────────────┨
┃ ◺ top       Hana                          1434 ┃
┃ ✦ jungle    Iris                          1578 ┃
┃ ◹ mid       Karim                         1551 ┃
┃ ◿ adc       Bilal                         1713 ┃
┃ ⛨ support   Theo                          1419 ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

┏━━━━━━━━━━━━━━ 4px red ━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ RED  · ●off-role                          7595 ┃
┃ ◺ top       Omar                          1469 ┃
┃ …                                              ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

┃ Blue favored 54%. Everyone on a main role.      ┃  explanation: 3px brand left rule, t-base text
┃ Gap 100. Next best: swap Hana and Omar, gap 170.┃
┃                                    [ Reroll ]   ┃  admins only, right on ≥720px
```

- The 4px side rule is on the **leading edge**: the top edge when the cards are stacked (phone), the left edge
  when they are side by side (≥720px). Same rule, one `border-block-start` / `border-inline-start` swap in the
  media query.
- Card body keeps the 10% side tint; header bar is `raise` with the side colour on the name only. **Never a
  filled side-coloured block behind five names.**
- Role column: icon + word, `dim`; **off-role turns the icon and word `brand` and adds a dotted underline
  under the word**, plus the `brand` dot before the name and the visually-hidden `off-role` — colour is never
  the only signal, and the stored explanation names them in a sentence anyway.
- Lane order, always, top to support. Never sorted by rating. The sum stays a bare number with its
  visually-hidden `sum of the five ratings` (product, 2026-09-08 — not reopened).
- The explanation strip is unchanged in every way that matters: `splits.explanation` verbatim, one `<p>`,
  never recomposed, never truncated, `text` and not `dim`. It gets the v2 card treatment (surface, `line`
  border, `lit` highlight, 3px `brand` left rule).
- **The reroll control stays on the explanation strip** and does not move to the top bar. The button means
  "give me a different version of *this sentence*"; in a header it would be a control with no object. On phone
  it is full width below the sentence, on ≥720px it is right-aligned beside it. The disabled state and the
  `No more splits. …` note are unchanged.
- The sit-out strip stays **above** the cards, for v1's reason, and gains a `raise` header bar reading
  `SITTING OUT` so it reads as a card and not as a loose paragraph.

#### Result

```
┌────────────────────────────────────────────────┐  1px brand ring on the winner's block
│ RED WINS                                 34:12 │  t-display red · duration mono t-sm dim
│ Blue was favored 54%.                          │  t-base dim
│ Top damage: Lena, 47.3k                        │  t-sm, the number in brand
└────────────────────────────────────────────────┘

┏━ 1px line (lost) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ BLUE                                           ┃
┃ ◺ top       Hana                  1393  (−41)  ┃
┃ …                                              ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
┏━ 4px red ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ RED                                            ┃
┃ ◺ top       Omar                  1510  (+41)  ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

Blue favored 54%. Everyone on a main role. Gap 100. …   ← the split they played, verbatim
```

Everything M3.16 settled holds: **the result card is the only pair of team cards on this screen**, one rating
per player per screen, no side sums in a result header, no off-role marker repeated, no team total of deltas,
deltas never coloured by sign. What v2 changes is only dress:

- The headline is the display cut at `t-display` in the winner's colour, upper case. This is the one place in
  the product where a colour is large, and it is large for one line.
- The winning card keeps its 4px side rule **and** gains a 1px `brand` ring; the losing card's rule drops to
  1px `line`. Two signals, both structural, neither a wash of colour over the page.
- `Top damage` moves inside the headline card as its third line rather than floating under the two team cards.
  It is a fact about the game, and the game's card is where facts about the game go.
- **The header does not repeat the winner.** The strip says `FINAL`; the card says `RED WINS` in 44px forty
  pixels below it. Two winners on one screen is the same redundancy M3.16 removed for ratings. If product
  wants the winner in the strip instead, then the card headline drops to `t-lg` — one of the two, never both.

#### Idle

The idle page is the one a friend hits at 19:00, and v1 gave it one sentence and one link on an otherwise
black screen. v2:

- Strip: slug, headline `NOTHING TONIGHT`, no live pill, sentence = the existing M1.10 wording, unchanged:
  `When ten of you are in a custom lobby with the companion running, the teams show up here.`
- Primary block: an **empty seat rack**, ten `open` rows, with the header `SEATS · 0 of 10`. It says the same
  thing the sentence says, in the shape the page will have in an hour, and it gives the idle screen a body.
- Under it, the two cards the desktop rail carries: `How this works` and `Run the companion`. On the idle page
  they render inline on every width, because there is nothing else to read.
- The v1 `Last night and the board` link becomes the `Leaderboard` tab in the top bar. One destination, one
  place.

#### Copy — final (product 2026-09-09)

Product has passed every string. `(shipped)` marks a sentence that already exists and is quoted unchanged;
everything else is final text the engineer types into `apps/web/lib/tonight/copy.ts`, `lib/nav.ts` and the
shell without asking. **Nine strings changed from the designer's proposal and four differ from what the code
says today** — the `Status` column names them, so M3.18 knows which are edits and not typos. Layout, order and
placement are the designer's and are untouched.

| Where | String | Status |
|---|---|---|
| wordmark | `CUSTOMS NIGHT` (the amber bar is the logo, not a word) | product 2026-09-09 |
| strip headline, idle | `NOBODY IN YET` | product 2026-09-09 — **changed**, code says `Nothing tonight` |
| strip headline, filling | `<n> IN THE LOBBY` | product 2026-09-09 |
| strip headline, balanced | `TEAMS ARE SET` | product 2026-09-09 — code says `Teams set` |
| strip headline, in game | `IN GAME` | product 2026-09-09 |
| strip headline, finished | `GAME OVER` | product 2026-09-09 — **changed**, code says `Final` |
| sentence, idle | *(shipped)* `When ten of you are in a custom lobby with the companion running, the teams show up here.` | shipped, kept |
| sentence, 0 in | *(shipped)* `Nobody in the lobby yet.` — in the strip, and **not repeated under the rack** | product 2026-09-09 — **changed** |
| sentence, 1–9 in | `One more to go.` … `Nine more to go.` (word, not digit — the digit is already 44px above it) | product 2026-09-09 |
| sentence, 10 in | `Teams in a moment.` | product 2026-09-09 — **changed** |
| sentence, 11+ in | `Ten play, the rest sit out this game.` | product 2026-09-09 |
| sentence, balanced | `Split by rating and role. Nobody picked the teams.` | product 2026-09-09 — **changed** |
| sentence, in game | `Ratings move when it ends.` | product 2026-09-09 — **changed** |
| sentence, finished rated | `Ratings are updated. The leaderboard has the rest.` | product 2026-09-09 — **changed** |
| sentence, finished unrated | *(none — the slot keeps its height and stays empty; no apology, per v1)* | product 2026-09-09 |
| rack header | `SEATS` · `<n> of 10` · `rating` | product 2026-09-09 |
| empty seat | `open` | product 2026-09-09 |
| all-flexible hint | `Nobody has set a role tonight, so the bot can put anyone anywhere.` | product 2026-09-09 — **changed** |
| all-flexible hint, admin only, appended | `Set roles` (link to `/admin`) — **rendered only once M3.6 ships the control it points at** | product 2026-09-09 |
| empty lobby | *(shipped)* `Nobody in the lobby yet.` — one place only, see `sentence, 0 in` | shipped, kept |
| past the ten | *(shipped)* `Around` | shipped, kept |
| nameless hint | *(shipped)* `Names fill in after someone's first game.` | shipped, kept |
| no season | *(shipped, M3.17)* `No season is active, so tonight's games are not being saved. An admin can start one.` | shipped, kept |
| nav | `Tonight` · `Leaderboard` · `Stats` · `Companion ↗` | product 2026-09-09 — **changed** from `Get the app` |
| footer | `How this works` · `Get the companion` · `Your games` | product 2026-09-09 |
| how this works, line 1 | `Nobody checks in. The companion app on somebody's PC reads the League lobby and sends who is in it.` | product 2026-09-09 |
| how this works, line 2 | `The bot makes three splits and posts the fairest, with the win chance and the rating gap. An admin can step to the next one. Nothing is picked at random.` | product 2026-09-09 — **changed** |
| how this works, line 3 | `Results come off the end-of-game screen. Nobody reports a score.` | product 2026-09-09 |
| how this works, line 4 | `Your rating starts from your rank and moves with every result. Proven is the board's careful version of it and catches up after about 30 games.` | product 2026-09-09 — **changed** |
| companion card, title | `Run the companion` | product 2026-09-09 |
| companion card, body | `Windows only. Install it once, paste in the token an admin gives you, and leave it running while you play.` | product 2026-09-09 — **changed** |
| companion card, link | `Get the companion` → `https://github.com/suyaser/kustom-releases/releases/latest` | product 2026-09-09 |

**Why the nine changed.** Each one is a rule, not a preference, so the next string is decided the same way.

- **`NOTHING TONIGHT` → `NOBODY IN YET`.** This is the screen a friend hits at 19:00 from a WhatsApp link, and
  "nothing tonight" reads as *the night is off* to a group that plays every night. It is also false in the
  other idle case, an abandoned lobby. `NOBODY IN YET` is true in both and invites the reader to be first.
- **`FINAL` → `GAME OVER`.** The tone line in this document says *never a broadcast lower-third*, and `FINAL`
  is the lower-third word. `GAME OVER` is the group's own vocabulary and just as short. The winner stays named
  once, on the result card headline at `t-display` — product does **not** take M3.16's offer to move it up
  into the strip.
- **The sentence never repeats the headline.** `Ten in. Teams in a moment.` under a 44px `10 IN THE LOBBY`,
  and `They are in.` under `IN GAME`, spend the page's one live line saying what the biggest type already
  said. Both drop their first clause.
- **`Same ten, split by rating and role.` → `Split by rating and role. Nobody picked the teams.`** With eleven
  around it is not the same ten, so the old line is wrong on exactly the nights the sit-out strip appears. The
  new second half is the product's promise (principle 1, "the bot is the referee") in four words, and it is the
  sentence that ends the argument the whole thing exists to end.
- **0 in the lobby says it once.** The proposal had `Nobody has joined yet.` in the strip and the shipped
  `Nobody in the lobby yet.` under the rack — the same fact twice, 40px apart. The settled string wins and it
  goes in the strip, because the strip's sentence slot is mounted in every state and has to hold its two lines
  anyway. Nothing is rendered under the rack at count 0; a rack of ten `open` seats is the picture.
- **`the balancer` → `the bot`.** Product calls it the bot on every other surface. "Balancer" is the name of a
  module in `packages/core`; nobody in the voice channel says it.
- **`Get the app` → `Companion ↗`.** One thing needs one name, and the name is already fixed by a shipped
  sentence this redesign may not rewrite ("…with the companion running"). With `Get the companion` in the
  footer and `Run the companion` on the card, `Get the app` was the only place on the page inventing a second
  word for the same download. A destination noun also matches the three tabs beside it.
- **`how this works` line 2 gains the reroll.** Four lines are the whole explanation of the system, and the one
  human control in it was missing. Admin-only and never random are both said, because "the bot is rigged" is
  the argument this paragraph exists to pre-empt.
- **`how this works` line 3/4 swap and line 4 is rewritten.** The order is now the order of a night: lobby,
  teams, result, rating. The old rating line named `Rating` and `Proven` without saying where a rating comes
  from or when it can be trusted, which is the actual question a new player asks.

**The four lines are true of the shipped system, claim by claim.**

| Claim | True because |
|---|---|
| Nobody checks in; a companion on somebody's PC reads the lobby | M2.3's lobby watcher; `00-product.md`, "Zero input" |
| Three splits, fairest posted, with win chance and rating gap | M1.4 returns three ranked splits; `splits.explanation` prints both numbers |
| An admin can step to the next one, nothing is random | M3.2: reroll is admin-only, promotes rank 2 then rank 3, never picks at random, and stops |
| Results come off the end-of-game screen | M2.5's eog capture; no manual reporting anywhere in the product |
| Rating starts from your rank | `seedFromRank`, seeded from the rank the client reads (M1.3, M2.2) |
| Rating moves with every result | the fold on every rated game (M2.5, M5.2) |
| Proven catches up after about 30 games | `ordinal = mu − 2σ`; `00-product.md`, "a new player sits below their Rating until the board has watched about 30 games" |

Nothing in the four lines mentions "ten games" for Rating: the page has room for one number, and the number
worth printing is the one that governs the board people argue about.

The sit-out strip, the explanation line, the no-season sentence, the `No more splits.` note and every embed
string are **unchanged**. v2 is a visual redesign; it does not get to rewrite settled sentences.

**One shipped string retires with the shell:** `IDLE_LINK_LABEL` (`Last night and the board`) has no home once
`Leaderboard` is a tab, as this section's "Idle" already says. Delete the constant with M3.18 rather than
leaving a dead export in `copy.ts`.

### What changes on the leaderboard and the player page (M3.5)

M3.5 is being built against v1 right now. Nothing in its **content** decisions moves — `Proven` is still the
primary number and the sort key, `Rating` is still on line 2, the two names are still fixed, the legend is
still a legend and not a sticky header row, the `settling` chip is still a chip, the history chart still plots
`Rating` and only `Rating`, with the seed line in the same units. What changes is dress, and it is a follow-up
task, not a reason to stop:

1. **The shell.** `/leaderboard` and `/p/[puuid]` mount the same top bar and footer. This is the biggest single
   change and it is free if the shell lands as a layout.
2. **Tokens.** `accent` → `brand`, and the new `raise` and `line` tokens. Rows sit on `surface` inside a card
   with a `raise` header bar carrying the `Proven · Rating` legend, instead of a bare list on the page.
3. **Type.** `Proven` on line 1 becomes mono `t-md` 600 (unchanged in kind); the player page's current
   `Proven` number becomes `t-display`. Rank 1 keeps `brand` on the rank number only — no medals.
4. **Role icons** wherever a role is named on `/p/[puuid]`.
5. **Extract the row.** The rail on the tonight page renders the board's top five, so M3.5's row must be a
   component (`app/_leaderboard/BoardRow.tsx`) and its query must take a limit
   (`loadTopPlayers(client, { limit })`). Building it inline in the page means writing it twice.
6. **The sparkline stays hand-drawn.** One inline `<svg>`, one `<path>`, 1.5px `brand`, no fill, no points, no
   grid, no charting library. 140px on phone, 180px in the rail if it ever appears there.

### `tokens.css`, v2 — the file to write

```css
:root {
  color-scheme: dark light;

  --cn-bg: #0b0e14;
  --cn-surface: #141923;
  --cn-raise: #1d2431;
  --cn-line: #2a3140;
  --cn-text: #eef2f8;
  --cn-dim: #94a0b2;
  --cn-blue: #4c9aff;
  --cn-red: #ff6b63;
  --cn-brand: #ffb13c;

  --cn-blue-tint: color-mix(in srgb, var(--cn-blue) 10%, var(--cn-surface));
  --cn-red-tint: color-mix(in srgb, var(--cn-red) 10%, var(--cn-surface));
  --cn-brand-tint: color-mix(in srgb, var(--cn-brand) 12%, var(--cn-surface));
  --cn-blue-line: color-mix(in srgb, var(--cn-blue) 55%, var(--cn-line));
  --cn-red-line: color-mix(in srgb, var(--cn-red) 55%, var(--cn-line));
  --cn-pressed: color-mix(in srgb, var(--cn-text) 8%, var(--cn-raise));
  --cn-lit: inset 0 1px 0 color-mix(in srgb, #ffffff 6%, transparent);
  --cn-glow: 0 0 0 4px color-mix(in srgb, var(--cn-brand) 14%, transparent);

  --cn-sp-1: 0.25rem; --cn-sp-2: 0.5rem; --cn-sp-3: 0.75rem; --cn-sp-4: 1rem;
  --cn-sp-5: 1.5rem;  --cn-sp-6: 2rem;   --cn-sp-7: 3rem;    --cn-sp-8: 4rem;

  --cn-t-xs: 0.75rem;   --cn-t-sm: 0.875rem; --cn-t-base: 1.0625rem;
  --cn-t-md: 1.1875rem; --cn-t-lg: 1.5rem;   --cn-t-xl: 2rem;
  --cn-t-display: 2.75rem;

  --cn-radius: 10px;
  --cn-radius-row: 8px;
  --cn-radius-chip: 4px;

  --cn-font-sans: var(--cn-font-archivo), "Helvetica Neue", Arial, system-ui, sans-serif;
  --cn-font-mono: var(--cn-font-plex-mono), ui-monospace, "SF Mono", Menlo, monospace;
}

@media (prefers-color-scheme: light) {
  :root {
    --cn-bg: #eef1f6;
    --cn-surface: #ffffff;
    --cn-raise: #e4e9f1;
    --cn-line: #d5dce7;
    --cn-text: #10141b;
    --cn-dim: #556072;
    --cn-blue: #1f5fc4;
    --cn-red: #b4302b;
    --cn-brand: #8a5a0b;
    --cn-lit: inset 0 1px 0 color-mix(in srgb, #ffffff 70%, transparent);
  }
}

@media (min-width: 720px) {
  :root { --cn-t-lg: 1.625rem; --cn-t-xl: 2.25rem; --cn-t-display: 3.5rem; }
}

.cn-display {
  font-family: var(--cn-font-sans);
  font-variation-settings: "wdth" 118;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.02;
}

.cn-card {
  background: var(--cn-surface);
  border: 1px solid var(--cn-line);
  border-radius: var(--cn-radius);
  box-shadow: var(--cn-lit);
}

.cn-card-head {
  background: var(--cn-raise);
  border-bottom: 1px solid var(--cn-line);
  border-radius: var(--cn-radius) var(--cn-radius) 0 0;
}
```

`.cn-num` and `.cn-sr` are unchanged from v1. `themeColor` in `app/layout.tsx` becomes `#0b0e14` / `#eef1f6`.
`admin.css` is **not** touched: it keeps `color-scheme: light dark`, `.admin { font-family: system-ui }` and
the browser's own controls, for the reasons in "The admin area stays plain".

### Implementation list — ranked by what a first-time visitor notices

Build order is not this order: item 4 is the foundation and lands first. This order is impact.

1. **The app shell.** New `apps/web/app/_shell/TopBar.tsx`, `Footer.tsx`, `HowThisWorks.tsx`, `lib/nav.ts`,
   `app/shell.css`; mounted in `app/layout.tsx` around `{children}`, with `/admin` opting out (it already
   scopes itself with `.admin`). Wordmark `▍CUSTOMS NIGHT`, tabs for routes that exist, footer links. This is
   the whole "what is this page and where else can I go" gap in one commit.
2. **The status strip.** `lib/tonight/state.ts`: `tonightHeader` returns `{ headline, count, sentence, live }`.
   `lib/tonight/types.ts` + `load.ts`: the snapshot gains `seasonName: string | null` (select `name` alongside
   `id` in `selectSeasonId`) and `nightLabel: string` (formatted server-side, fixed locale, configured
   timezone). `TonightView.tsx`: slug line, display headline, live pill, two-line-reserved sentence.
   `<h1>` becomes the wordmark in the shell, so the strip headline becomes a `<p>` — `TonightView.test.tsx`
   queries the heading and will need updating in the same commit.
3. **The seat rack.** New `app/_tonight/SeatRack.tsx` out of `MemberList`; ten rows always; `open` rows on
   `bg`; header `SEATS · n of 10` and the `rating` legend; fixed row grid; the all-flexible rule and its hint
   line. `tonight.css` for the rack; `rowHeight.test.ts` gains "ten `<li>` at every count" and keeps its
   44px arithmetic.
4. **Tokens and type.** `app/tokens.css` rewritten to the nine tokens, the derived values, `lit`/`glow`, the
   new scale and the `.cn-display` utility; `app/layout.tsx` adds `axes: ['wdth']` to the Archivo import and
   the `themeColor` values change to `#0b0e14` / `#eef1f6`. Every existing `--cn-accent` reference becomes
   `--cn-brand` (grep: `tonight.css`, `TonightView.tsx` has none, `admin.css` must **not** be touched).
5. **Cards.** The card recipe — `surface`, 1px `line`, `lit` inset, 10px radius, `raise` header bar — applied
   to the team cards, the sit-out strip, the explanation strip and the result card in `tonight.css`. The 4px
   side rule moves from `border-top` to the leading edge per breakpoint.
6. **Role icons.** New `app/_icons/RoleIcon.tsx`, five paths, used in the rack, both team cards and both
   result cards. `aria-hidden`, always beside the word.
7. **The result card.** Display headline in the winner's colour, `Top damage` pulled into the headline card,
   `brand` ring on the winner, 1px `line` on the loser. No content change: M3.16 stands.
8. **Desktop.** `shell.css`: 76rem shell, `≥720px` one column at 44rem, `≥1080px` `1fr / 20rem` grid with the
   rail. Rail cards: `How this works`, `Run the companion`, and `Top of the board` when M3.5 lands.
   `min-height: 100svh` on the shell and `margin-top: auto` on the footer, so the column has an end.
9. **Safe areas.** `env(safe-area-inset-top)` on the top bar and `-bottom` on the footer. The current page's
   16px top padding puts the count under a notch.
10. **The companion link points at the releases page**, `https://github.com/suyaser/kustom-releases/releases/latest`,
    not at `…/latest/download/CustomsNight.exe`. This page is opened on a phone.

### What to keep — do not rewrite these

The page is not wrong. It is under-dressed. The engineer should touch presentation and leave the machinery
alone:

- `lib/tonight/load.ts` — the loader, its anon-key reads, its rating derivation. It gains two fields
  (`seasonName`, `nightLabel`) and nothing else.
- `lib/tonight/state.ts`'s `tonightState` — the state machine and the `finished`-but-unrated fallback are
  correct and were argued for twice. Only `tonightHeader` grows.
- `TonightLive` and the Realtime path, including the nameless-name polling condition.
- `RerollControl` in full: the no-JS form fallback, the named split, the error sentences.
- Delta computation at render (`-0` does not survive JSON), `displayRating`, `formatDuration`, `formatDamage`,
  `favoredClause`, `renderWebName`, `joinWebNames`.
- Every settled string: the sit-out copy, the explanation verbatim rule, the no-season sentence, `No more
  splits. …`, the idle sentence, `Around`, `Nobody in the lobby yet.`, the nameless hint.
- The one-primary-block rule, the no-shift rule, the 44px floor, "no numbers in a proportional font", and the
  list under "What this design does not do" — with one amendment, recorded below.

**Amendment to "What this design does not do".** Two entries are relaxed by Floodlit and no others: there is
now **one** gradient (the shell's 5% amber floodlight) and **one** glow (the live pill's 14% amber ring). Both
are named, both are single instances, and both are load-bearing — they are what makes a 1400px viewport look
lit rather than empty. Everything else on that list stands: no emoji, no cream, no serif display, no purple,
no teal, no acid green, no glass blur, no champion art, no avatars, no crests, no "VS", no skeletons, no
toasts, no shimmer.


## Palette (v1 — superseded 2026-09-09 by Floodlit)

> Kept for the reasoning, not for the values. `accent` is now `brand`, `#12151A` is now `#0B0E14`, and there
> are two more tokens. The **rules** in this section — a side colour is a rule or a tint and never a fill,
> deltas are never coloured by sign, blue and red must sit within about a point of each other in contrast —
> all survive into v2 unchanged.

Seven named tokens per theme. Everything else in the UI is derived from these with `color-mix()`, so there is
no eighth colour to keep in step.

| Token | Role | Dark | Light |
|---|---|---|---|
| `bg` | Page. A cool near-black, never `#000`: pure black on an OLED phone smears text at arm's length. | `#12151A` | `#F3F4F6` |
| `surface` | Cards, rows, strips. One step off `bg`, no shadow. | `#1B2027` | `#FFFFFF` |
| `text` | Everything you are meant to read. | `#E7EAEF` | `#161A20` |
| `dim` | Labels, counts, secondary lines. Never a player's name, never a rating. | `#97A0AD` | `#5B6573` |
| `blue` | Side 100. Team names, the card's top rule, the win colour on a blue result. | `#6BA5F7` | `#1F5FC4` |
| `red` | Side 200. Same jobs on the other side. | `#EA6F69` | `#B4302B` |
| `accent` | Brass. The one colour that is **neither side**: live state, off-role marker, "you", the reroll control, the rating-history line. | `#E0A33E` | `#8E5B0E` |

Contrast, measured (WCAG 2.1, against `surface`, the worst of the two backgrounds):

| | dark | light |
|---|---|---|
| `text` | 13.6 | 17.5 |
| `dim` | 6.2 | 5.9 |
| `blue` | 6.5 | 6.0 |
| `red` | 5.4 | 6.2 |
| `accent` | 7.4 | 5.8 |

All pass AA for body text. `blue` and `red` are deliberately within ~1.2 of each other in ratio: if one side
were visibly brighter, that side would read as the favoured one before anyone read a number.

**Derived values.** Do not add hex; derive.

```
hairline      color-mix(in srgb, var(--cn-text) 14%, transparent)
blue tint     color-mix(in srgb, var(--cn-blue) 7%, var(--cn-surface))
red tint      color-mix(in srgb, var(--cn-red) 7%, var(--cn-surface))
accent tint   color-mix(in srgb, var(--cn-accent) 10%, var(--cn-surface))
pressed       color-mix(in srgb, var(--cn-text) 8%, var(--cn-surface))
```

**Colour rules.**

- A side colour is only ever a **1px to 3px rule, a text colour, or a 7% tint**. Never a filled block behind
  five names. A saturated fill in a dark room at 11pm is a flashlight.
- **Rating deltas are never coloured by sign.** No green. A gain is `text` at weight 600, a loss is `dim`, and
  both always print their sign. Green-for-good would collide with `red` meaning "side 200", and a red number
  next to a red team is unreadable in every sense.
- Nothing is a gradient. No shadows except a 1px hairline. No glow.

## Type (v1 — superseded 2026-09-09 by Floodlit)

> The families are the same two and the mono/proportional split is unchanged. What v2 adds is the Archivo
> width axis as a display cut and a `t-display` step above `t-xl`.

Two families, Google Fonts, loaded through `next/font/google`.

| Family | Role | Weights | Fallback stack |
|---|---|---|---|
| **Archivo** | Everything read as language: names, headings, the explanation line, copy. A grotesque with tight sidebearings — it stays legible small and does not look like a dashboard template. | 400, 600, 700 | `'Archivo', 'Helvetica Neue', Arial, system-ui, sans-serif` |
| **IBM Plex Mono** | Everything read as data: ratings, deltas, gap, win percentage, duration, rank number, role labels, lobby password, PUUID fragments. True tabular figures, a distinguishable `1`/`l`, and a real minus. | 400, 600 | `'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace` |

The split is the whole system: **if it is a number or a role, it is mono; if it is a person or a sentence, it
is Archivo.** A column of ratings in a proportional font wobbles and a scoreboard that wobbles looks wrong
before anyone can say why.

Every numeric run also sets `font-variant-numeric: tabular-nums`.

### Scale

Root stays at 16px. Body is 17px because the page is read at arm's length; nothing that carries meaning goes
below 12px.

| Token | Size | Line height | Used for |
|---|---|---|---|
| `t-xs` | 0.75rem / 12px | 1.35 | role labels, `settling` chip, per-row meta (`24 games · 13W 11L`) |
| `t-sm` | 0.875rem / 14px | 1.4 | rating delta, duration, secondary lines |
| `t-base` | 1.0625rem / 17px | 1.5 | body, the explanation line, sit-out copy |
| `t-md` | 1.25rem / 20px | 1.3 | player names in team cards and leaderboard rows, ratings |
| `t-lg` | 1.625rem / 26px | 1.2 | side headers (`Blue`), section headings |
| `t-xl` | 2.25rem / 36px | 1.1 | the lobby count (`7`), the result headline (`Red wins`) |

`t-xl` is the only size that changes across breakpoints, and only upward (2.75rem at ≥720px). Everything else
is the same on a phone and a laptop; a name is not more important on a bigger screen.

Weights: 400 body, 600 names and numbers that matter, 700 only for `t-xl`. No 300, ever — hairline weights
vanish on a phone at arm's length.

Letter-spacing: `-0.01em` on `t-lg` and above; `0.06em` on mono role labels rendered in lower case, which is
how they are always rendered (`top`, `jungle`, `adc` — never `TOP`, never `ADC` in caps, because the client
and the group say them in lower case).

## Spacing, size, motion (v1 — superseded 2026-09-09 by Floodlit)

> The 4px scale and the 44px floor are unchanged. Radii and elevation are not: v2 cards are 10px with a 1px
> `line` border and a lit top edge, and the max content width is no longer 42rem.

4px base.

| Token | px |
|---|---|
| `sp-1` | 4 |
| `sp-2` | 8 |
| `sp-3` | 12 |
| `sp-4` | 16 |
| `sp-5` | 24 |
| `sp-6` | 32 |
| `sp-7` | 48 |
| `sp-8` | 64 |

- Page gutter `sp-4` on phone, `sp-5` at ≥720px. Max content width 42rem; the tonight page never gets wider,
  it centres.
- Gap between blocks `sp-5`. Gap between rows inside a card `0` — rows are separated by a hairline, not space.
- Radius: `6px` on cards and strips, `3px` on chips, `0` on hairline dividers. Nothing is a pill.
- Every tappable thing is at least **44 × 44px**, including the role-override taps (M3.6), the reroll button
  and the idle page's `Last night and the board` link — a bare inline anchor is about 26px tall and is the one
  tappable thing on the whole idle screen.
- Motion: one transition, `opacity 150ms ease`. New rows fade in. Nothing slides, nothing scales, nothing
  pulses more than a 2s opacity cycle on the single live dot. Honour `prefers-reduced-motion: reduce` by
  dropping to no transition at all. The page must never move under a thumb that is about to tap.

## Components (v1 — the tonight-page entries are superseded by Floodlit)

> Read this section for **what a component contains and why**, which is still current everywhere, and Floodlit
> for **how it looks**. Where a component below names `accent`, read `brand`. The leaderboard, still-settling
> and rating-history entries are current for M3.5 with the follow-up listed under "What changes on the
> leaderboard and the player page".

### Lobby member list — state "filling"

- Hero: the count, `t-xl` mono, `7` in `accent`, then ` in the lobby` in `t-base` `dim`. Under it, a row of
  ten 3px bars, `sp-1` apart, filled ones `accent`, empty ones hairline. That row is the whole status at
  arm's length: you can count it without reading.
- One row per member, in join order, oldest first. Newest is appended, not prepended — a list that reorders
  under a thumb is worse than a list you scroll. Everyone in the **same** companion post arrived at the same
  instant and has no join order between them: break that tie on the **name**, not on a database id, so a first
  post of seven reads as a list rather than as a shuffle.
- Row (exactly 44px tall, hairline between): name `t-md` 600 · main role `t-xs` mono `dim`, secondary role
  after a `/` also `dim` · display rating right-aligned, `t-md` mono tabular. A member with no role declared
  reads `flexible` in that column, in the same mono `t-xs` `dim` — it is what the balancer will treat them as,
  and a blank there reads as missing data.
- A member who joined in the last 3s carries a 2px `accent` left rule, then it fades out on the page's one
  150ms opacity transition. Draw it as an element that is always there and only changes opacity, never as a
  border that appears: a row that gains a border gains 2px of width under a thumb.
- The signed-in viewer's own row: 2px `accent` left rule, permanent, drawn as an inset shadow so it adds no
  width. Finding yourself is job one.
- **Reserve ten rows' height from the start**, and reserve it in the row's own units: `10 × 44px` plus the
  nine hairlines between them. Going from 9 to 10 must not shift the page while someone is reading it, and a
  reserved height that was guessed from the font instead of the row is a shift of about thirty pixels at the
  exact moment everybody is looking.
- People beyond the ten (`is_spectator`) sit under a hairline labelled `Around` in `t-xs` `dim`.
- Empty: `Nobody in the lobby yet.` in `dim`. Not an illustration, not a spinner.

### Team card

- Two cards. Stacked on phone, **blue first** (side 100 is the lower number and the client's first side).
  Side by side at ≥720px, equal width, blue left.
- Card: `surface` with the side tint, 6px radius, a 3px rule in the side colour along the **top** edge only.
- Header row: `Blue` in the side colour, `t-lg` 600, and on the right the sum of the five display ratings,
  mono `t-md` `dim`. Label it `7695` with no word: the header is `Blue` and a number, and the explanation line
  below owns the word "gap". They are not the same quantity (see "Sums are not the gap" below). Decided
  (product, 2026-09-08): the side sums stay **bare numbers with no label**, here and in the embed. Give the
  web number visually-hidden text `sum of the five ratings` so a screen reader is not left with a bare
  integer.
- Five rows, always five, **always in lane order** top, jungle, mid, adc, support. Never sorted by rating.
  That order is `Split.blue` / `Split.red` as stored, so render the array as given.
- Row: role label, mono `t-xs` `dim`, in a fixed 4.5rem column · name Archivo `t-md` 600 · display rating,
  mono `t-md`, right-aligned tabular.
- **Off-role:** the role label turns `accent` and gains a 1px dotted underline, and the row gets an `accent`
  dot before the name. Colour is never the only signal — the explanation line names the player and the role in
  words, and the row carries visually-hidden text `off-role`.
- **You:** 2px `accent` left border on the row.
- No crest, no "VS", no champion art, no avatars. There is no source for any of it and it would be the first
  thing that made this look like a template.

### Explanation line

- Sits directly **below** both team cards, full width. Read order on a phone is: my side, my name, then why.
- A `surface` strip, 2px `accent` left border, `sp-3` padding, text `t-base` in `text` — not `dim`. This
  sentence is the product's whole argument; it does not get demoted to caption grey.
- Rendered **verbatim** from `splits.explanation` as a single `<p>`. Never re-composed from the split's
  numbers, never chopped into badges or chips, never truncated, never ellipsised. Three lines of wrap on a
  phone is the correct outcome.

  > Blue favored 54%. Everyone on a main role. Gap 100. Next best: swap Hana and Omar, gap 170.

- The reroll control (M3.2, admins only) is a ghost button on the right of the strip on wide screens, and a
  full-width button under it on phone. Label `Reroll`. After the last split it is `disabled` and the strip
  shows, in `dim` `t-sm`: `No more splits. Change who is in the lobby to rebalance, or play these.`
  (Product copy, 2026-09-08. It is deliberately *not* core's `BalanceError` message
  `No more splits. Rebalance or play these.` — "rebalance" is not a button on this page, it is what happens
  when the lobby membership changes, and the friend reading it should be told which.)
- After a reroll the strip re-renders with the promoted split's stored string (M3.7). Same element, opacity
  fade, no scroll.

### Sit-out notice

- Full-width strip above the team cards, `surface`, 2px `accent` left border, `t-base`.
- Above, not below: if you are sitting out, everything under it is not about you, and you should learn that
  before you scan for your name.
- When the viewer is one of the sitting players the strip leads with a second-person sentence and keeps the
  `accent` border; nobody else's strip changes.
- Copy (product, 2026-09-08 — final; the rule behind it is fewest games tonight, then oldest sit-out):
  - general: `Sitting out this game: Sara and Deniz. Each game goes to whoever has played least tonight, so they are first in line for the next one.`
  - viewer: `You are sitting this one out. Each game goes to whoever has played least tonight, so you are first in line for the next one.`
  - Names are joined with `, ` and a final ` and`: `Sara and Deniz`, `Sara, Deniz and Ali`. Any change to
    these two sentences goes through product.

### Result card

- Headline `Red wins` in the winner's side colour, `t-xl` 700, with the duration beside it in mono `t-sm`
  `dim`: `34:12`.
- Second line, `t-base` `dim`: the prediction, kept honest — `Blue was favored 54%.` The bot said a number
  before the game; it does not get to quietly drop it after.
- Then the two team cards again, with each row's rating replaced by the **after** rating and a delta chip. The
  card for the winning side keeps its 3px top rule; the losing side's rule drops to hairline `dim`.
- **These are the only team cards on the finished screen.** The explanation line of the split they played sits
  under them; nothing renders a second pair with the before numbers (M3.16, and the state table above).
- **Same five positions as the teams block, lane order, top to support.** "My row" has to be where it was
  twenty minutes ago, and the result embed already sorts this way. A player the scoreboard has no role for is
  printed without one and sorts after the five who have one.
- **No side sums in the result card's headers.** The sum answers "are these teams even?", which is a question
  the game has just answered, and a reader who saw `6000` before the game and `6465` after has computed a team
  total of deltas by subtraction — the one number this page must not put on screen (below). The header of a
  result card is the side name alone.
- The off-role marker is **not** repeated here. It described a decision, and the decision has been played; the
  stored explanation under the cards still names the player and the role in words.
- One line under the cards, `t-base`: `Top damage: Lena, 47.3k.` with the number in `accent`.
- No wash of colour over the page, no banner, no confetti. The result is a fact, not an event.
- **Never print a team total of deltas.** The two sides do not sum to zero — different sigmas and rounding —
  and a visible imbalance is a free argument about a thing that is working correctly.

### Rating delta

- Mono, `t-sm`, tabular, in parentheses after the new rating: `1512 (+43)`.
- Always signed. `+` and U+2212 `−` on the web (it is the width of `+` in Plex Mono and aligns in a column);
  plain ASCII `+` and `-` in Discord, which has no font control and gets copy-pasted.
- Not coloured by sign: gain is `text` at 600, loss is `dim` at 400.
- `(0)` never appears — if the delta rounds to zero, print `(+0)` or `(−0)` to match the sign of the mu change,
  so a column of ten rows never has a stray unsigned entry.
- Rounding rule: the delta is `displayAfter − displayBefore`, both already rounded — never
  `round((muAfter − muBefore) * 60)`. Otherwise `1469 + 42 = 1512` is false on the screen. See DECISIONS.

### Leaderboard row

- One row per player, min-height 56px (two lines), hairline between, no zebra striping.
- **Line 1**, left to right: rank number, mono `t-sm` `dim`, fixed 2.5ch · name Archivo `t-md` 600, single
  line, ellipsis · **Proven**, mono `t-md` 600, right-aligned, hard against the row's right edge.
- **Line 2**, `t-xs` `dim`, exactly this order, separated by ` · `:

  ```
  Rating 1266 · 28 games · 13W 15L · L2 · [settling]
  ```

  Rating comes **first on line 2 and sits directly under the Proven number**, right-aligned to the same edge,
  so the two numbers form one vertical pair per row and the eye reads them as one player's two facts rather
  than as two competing columns. Everything after it (games, W/L, streak, the `settling` chip) is left-aligned
  under the name. So line 2 is two groups pinned to opposite edges, the same as line 1.
- **The words print per row, not as column headers.** `Rating` prints inline on every line 2, `Proven` prints
  nowhere on the row at all — it is the unlabelled primary number, named once in a `t-xs` `dim` header line
  above the list (`Proven · Rating`, right-aligned over the two numbers). Reasons: the list is a stacked card
  list on a phone, not a table, so a header row scrolls away after four rows and every row below it is then
  two unexplained numbers; and `Rating` is the number people arrive knowing, so it is the one that needs its
  name attached where it appears. The header line is a legend, not a header row: it does not stick, does not
  sort, and is not tappable.
- `Proven` is never abbreviated and the two numbers are never merged into one cell (`1266 / 654`). They are
  different quantities on different lines.
- Rank 1 gets `accent` on the **rank number only**. No medals, no trophies, no emoji, no highlight row.
- The viewer's own row: 2px `accent` left border. No auto-scroll to it.
- At ≥720px the row does not become a table. Same two lines, wider gutters. A twenty-person board does not
  need a table and a table would need the header row this design just removed.
- **Two numbers, one problem.** The board sorts on `ordinal = mu − 2σ` but the number everyone knows is
  `round(mu × 60)`. Showing the second while sorting on the first puts visibly out-of-order numbers on the
  page, which is the exact complaint M3.8 exists to prevent. The design shows **both**, columns labelled:
  **`Proven`** (`round(ordinal × 60)`, the sort key, primary, right-most) and **`Rating`** (`round(mu × 60)`,
  `dim`, mono `t-sm`, on line 2). Then the sort matches the primary column exactly, and the still-settling
  sentence is what explains why a new player's two numbers differ. Accepted by the lead; the names `Proven`
  and `Rating` are fixed by product (M3.5 brief, `02-milestones.md`) and no surface invents a third name.

### Still-settling marker (M3.8)

- The marker is a chip: the word `settling`, mono `t-xs`, `dim`, 1px hairline border, 3px radius, `sp-1`
  horizontal padding. No colour, no dot, no emoji, no asterisk. It reads as a label, not a warning.
- Placed after the meta on line 2 of the leaderboard row, and beside the rating on `/p/[puuid]`.
- The sentence appears **once per page**, under the leaderboard heading and under the rating chart on the
  player page — not per row. Copy (product, 2026-09-08 — final):
  `The board sorts on Proven, which stays below your rating until it has seen about 30 games. New players
  start low on purpose and climb as they play.`
  Short form, for the one-line Discord footer where two sentences will not fit:
  `Proven stays below a new player's rating until the board has seen about 30 games.`
- Disappears at 30 games with no ceremony.

### Rating history (`/p/[puuid]`)

- **The plotted series is `Rating` (`round(mu × 60)`) — one series, never Proven.** The chart is titled
  `Rating` in `t-xs` `dim` above the plot, using the same word as line 2 of the leaderboard row, so the page
  has exactly two numbers with two names and the chart belongs to one of them.

  Product's reasoning, recorded here so nobody "fixes" it later: a Proven line sags at the start of a player's
  history for a reason the chart cannot show. Proven falls when σ is high and rises as σ falls, so a new
  player's Proven line climbs steeply while their actual skill estimate is flat, and a returning player's dips
  while nothing about them changed. That shape reads as "I got worse" and there is no axis, label or tooltip
  on a 140px phone chart that can say "that is your uncertainty, not your play". Rating moves only when you
  win or lose a game, which is the only thing a history chart can honestly claim to be about.

- Consequence: **the seed reference line is in the same units** — a hairline horizontal at
  `round(seedMu × 60)` with a `t-xs` `dim` label `seed`. Never the seed's ordinal. One unit on one chart.
- The player's current `Proven` number is not plotted; it appears once as text beside the current Rating, with
  the `settling` chip when under 30 games, above the chart. The chart shows the journey, the numbers beside it
  show where the board has them today.
- A single 1.5px `accent` line, no fill, no points, no grid. X is game index, not date — nights are uneven and
  a date axis makes a settled player look erratic.
- Height 140px on phone. No tooltip on hover; the recent-games list underneath is the detail view.
- Y range is the series min/max padded by 5%, and the seed line is always inside it even when that widens the
  range. A chart whose reference line is off-screen is a chart with no reference.

## Discord embeds

Checked against the shipped JSON on 2026-09-09 (`apps/web/lib/discord/__snapshots__/embeds.test.ts.snap`,
M3.1 and M3.3). Both worked examples below — every field name, every line, both colours, both footers, the
`Red wins · 34:12` title and all ten result deltas — match the snapshot character for character. Where this
section changed on that date it is called out in place, and the field order of the teams embed is the one
place the code has to move to meet it.

Constraints this layout is built against, and none of them are negotiable: no custom fonts, no CSS, one accent
colour per embed (a 4px bar down the left edge), field **name** ≤ 256 and field **value** ≤ 1024 characters,
25 fields max, 6000 characters total. Inline fields pack up to three per row on desktop and re-wrap on mobile,
so **every field must make sense read alone**, in any order, on one column.

Two consequences that shape everything below:

- **No column alignment.** Discord's proportional font will not align `Hana` and `Karim`, and a fenced code
  block that does align is a grey slab that scrolls sideways on a phone and kills every other colour on the
  message. So each line is short and self-contained: a role in inline code, a name, a middot, a number.
- **Colour is structure, not decoration.** The embed bar is `accent` (brass) for teams — neither side — and
  the winner's side colour for a result. A teams embed tinted blue would look like a prediction.

Embed bar colours, as the integers the API passes:

| | hex | int |
|---|---|---|
| blue (side 100) | `#6BA5F7` | `7054839` |
| red (side 200) | `#EA6F69` | `15363945` |
| accent | `#E0A33E` | `14721854` |

These are the **dark** palette values, because Discord's default is dark and the bar sits on a dark card.

### Teams embed

Structure:

```
color        accent (14721854)
title        Teams are set
url          https://<tonight page>          [dropped when the only honest origin is localhost]
description  <splits.explanation, verbatim>
field 1      name "Sitting out"   block   value: one sentence           [only if somebody sits]
field 2      name "Seats"         block   value: one line per move      [only if somebody moves]
field 3      name "Blue · 7695"   inline  value: five lines, lane order
field 4      name "Red · 7595"    inline  value: five lines, lane order
field 5      name "Lobby"         block   value: name and password      [only if known]
footer       Customs Night · more on the tonight page
timestamp    now
```

**The rotation goes above the teams** (revised 2026-09-09, reading the shipped M3.1 JSON; M3.1 shipped these
two fields *after* `Blue` and `Red`, which is the one place the code and this file disagree). The web puts the
sit-out strip above the team cards on a stated rule: *if you are sitting out, everything under it is not about
you, and you should learn that before you scan for your name.* That rule is stronger in Discord, not weaker.
Ten rating lines plus a wrapped explanation is about one phone screen, so `Swap: Omar out, Nadia in.` — the one
line in the message that has to happen before anybody can play — was landing below the fold. On a ten-person
night neither field exists and the embed is byte-identical to what shipped; on an eleven-person night everyone
else pays two short lines to put the instruction above the fold. Discord groups *consecutive* inline fields, so
a block field in front of `Blue` and `Red` does not break their pairing.

Line format inside a side field, one per role in lane order:

```
`top` Hana · 1434
```

Off-role players get ` · off-role` appended to their own line, so the fact survives being read on its own; the
description already names them in a sentence.

Filled in with the worked example (`docs/00-product.md`, split 1):

> **Teams are set**
>
> Blue favored 54%. Everyone on a main role. Gap 100. Next best: swap Hana and Omar, gap 170.
>
> | **Blue · 7695** | **Red · 7595** |
> |---|---|
> | `top` Hana · 1434 | `top` Omar · 1469 |
> | `jungle` Iris · 1578 | `jungle` Rami · 1638 |
> | `mid` Karim · 1551 | `mid` Nadia · 1266 |
> | `adc` Bilal · 1713 | `adc` Lena · 2088 |
> | `support` Theo · 1419 | `support` Yuki · 1134 |
>
> **Lobby**
> `customs-night` · password `4471`
>
> Customs Night · more on the tonight page

The exact strings the API builds:

```
title        Teams are set
description  Blue favored 54%. Everyone on a main role. Gap 100. Next best: swap Hana and Omar, gap 170.

field 3 name   Blue · 7695
field 3 value  `top` Hana · 1434
               `jungle` Iris · 1578
               `mid` Karim · 1551
               `adc` Bilal · 1713
               `support` Theo · 1419

field 4 name   Red · 7595
field 4 value  `top` Omar · 1469
               `jungle` Rami · 1638
               `mid` Nadia · 1266
               `adc` Lena · 2088
               `support` Yuki · 1134

field 5 name   Lobby
field 5 value  `customs-night` · password `4471`

footer         Customs Night · more on the tonight page
```

Budget: a side field is ~110 characters against a 1024 limit, so a name would have to be ~180 characters to
threaten it. Truncate a display name at 32 characters with `…` at the source anyway; do not truncate the field.

**The title on a reroll** (product, 2026-09-09, for M3.2). A reroll is a new message, never an edit of the
old one, and the title says how far down the list the group has gone: `Teams are set · reroll 1 of 2` for
split 2, `Teams are set · reroll 2 of 2` for split 3. Split 1 keeps the plain `Teams are set`, including when
an admin promotes it back. Nothing else about the embed changes — same accent bar, the promoted split's
explanation verbatim, the same ten. `of 2` is there so the second one reads as the last one without anybody
having to be told there is no fourth split; the web strip carries the sentence for the friend who presses
again (`No more splits. …`, above).

**Names, in every line of both embeds.** One renderer (`renderName`): the newest display name we have,
trimmed; `Someone` when we have none (M3.10); 31 characters and `…` when it is longer than 32. A blank-looking
line in a five-line field reads as a bug, which is why the fallback is a word and not an empty string.
`Someone` is never written to a **row**: `players.display_name` and `players.game_name` stay null, so the
next sweep or end-of-game block fills the real name in with no migration and no cleanup. It is not only a
rendering rule, though (amended 2026-09-09, M3.15): it is also the name the API hands the balancer, so it is
the word inside `splits.explanation` — a stored sentence the embed and the tonight page quote verbatim and may
never recompose. One word in both places, or one message reads `Someone` on a team line and
`Next best: swap Unknown and Hana` in the sentence above it. See the 2026-09-09 row in `04-decisions.md`.

A name is printed as **text, not markup**. Riot IDs carry underscores and asterisks, and a single stray
backtick closes the role's code span and swallows the rest of the field. Escape `` ` ``, `*`, `_`, `~` and `|`
with a backslash inside `renderName` — **last**, on the already-truncated string, so a backslash can never be
sliced away from the character it escapes and the 32 characters stay 32 characters as read. There is no name
we want rendered as italics.

**The `Lobby` field has three shapes**, and the third one is the code's, recorded here because it was missing:

```
`customs-night` · password `4471`     both known
`customs-night`                       no password (every lobby before M4.1)
Password `4471`                       a password with no name
(no field at all)                     neither
```

Never `password: —`, never the word `unknown`, never an empty field. The capital `P` in the third shape is
correct: there it starts the sentence, where in the first shape it is mid-line after the name.

**When there is no `url`** — a dev machine, or any origin that resolves to localhost, which `tonightPageUrl`
drops rather than post a link that works for one person — the title is not a link, so the footer must not
promise one. The footer is then `Customs Night` alone. A footer that says "more on the tonight page" over an
unlinked title is the message telling a friend to tap something that is not there.

Sit-out fields, when they exist — copy (product, **M2.15**, 2026-09-08; shipped verbatim by M3.1). Two
independent fields: `Sitting out` answers "who is not playing", `Seats` answers "who has to move", and those
are not the same question. Each appears only when it has something to say.

```
field 1 name   Sitting out
field 1 value  Sitting out: Omar — most games tonight.
               (…and when everyone around has played the same number tonight, the clause is
                `— longest since they last sat out.` Always "they".)
               (…and when they are tied on games *and* nobody around has ever sat out — the
                first balance of a night with a fresh group — the clause is
                `— nobody has sat out before, so somebody had to be first.`)

field 2 name   Seats
field 2 value  Swap: Omar out, Nadia in.
               Yuki is playing — take the open slot.      [a mover with nobody to swap with]
```

**Three reason clauses, not two** (product, 2026-09-09). `— longest since they last sat out.` is true on the
first balance of a night — nobody has sat out, so everybody has been waiting the longest possible time — and
vacuous, which is worse than useless: it states a fact about a history that does not exist, and the friend
reading it goes looking for the night they sat out and cannot find it. What actually happens on game one is
that everyone ties on games and on sit-outs and the comparator falls through to PUUID order, which is to say
it is arbitrary. So the clause says that, in the words a friend would use: `nobody has sat out before, so
somebody had to be first.` It does not say "random" or "the bot drew a name", because it is neither — the same
person is picked every time until somebody plays a game, and a friend told it was a draw will ask for another
one. From the second game of the night on, the two existing clauses are true and this one never appears again.

The value repeats the field name (`Sitting out` / `Sitting out: Omar …`) and that repetition stays. Inline
fields re-wrap and a field can be read alone, quoted alone, or screenshotted alone, so the sentence carries its
own subject. A field whose value only makes sense under its bold heading is a field that breaks the first time
Discord re-flows it.

This supersedes the earlier single-sentence version of the sit-out field (`Sara and Deniz` / "Each game goes to
whoever has played least tonight…"), which stays as it is on the **web** sit-out strip above: the strip is a
paragraph a friend reads on a page, the embed field is two short lines in a channel. M2.15 is the source of the
embed copy and `lib/discord/embeds.ts` is the only place it is composed.

Filled in, eleven around, all tied at zero games tonight (this is the case
`discord.integration.test.ts` pins, with the group's placeholder names):

> **Teams are set**
>
> Even 50%. Everyone on a main role. Gap 0. Next best: swap Player4 and Player5, gap 0.
>
> **Sitting out**
> Sitting out: Player0 — nobody has sat out before, so somebody had to be first.
>
> **Seats**
> Swap: Player0 out, Player10 in.
>
> | **Blue · 6000** | **Red · 6000** |
> |---|---|
> | *the ten who are playing, five a side, lane order — Player10 among them and Player0 not* | |
>
> **Lobby**
> `customs-night`
>
> Customs Night · more on the tonight page

Two fields, not one line: the sitter reads the first and stops, the mover reads the second and acts, and
neither has to work out which half of a compound sentence is about them.

**Sums are not the gap.** `7695` and `7595` are the sums of five display ratings. Their difference equals the
`Gap 100` in the explanation only because nobody here is off-role; the gap is computed on effective
(role-adjusted) skill. The field name is therefore just `Blue · 7695`, with no label — the embed never claims
the two numbers are the same thing, and the explanation line is the only place the word "gap" appears.

### Result embed

```
color        winner's side colour
title        Red wins · 34:12
url          https://<tonight page>                          [same localhost rule as the teams embed]
description  Blue was favored 54%. Top damage: Lena, 47.3k.  [absent when it would be empty]
field 1      name "Blue"   inline   five lines: new rating and delta
field 2      name "Red"    inline   five lines: new rating and delta
footer       Season 1 · game 47                              ["Season 1" alone if the game cannot be counted]
timestamp    game end
```

`Season 1` alone in the footer is right and needs no apology (product, 2026-09-09): the game number is a
count, and a count we could not take is simply not printed. Never `game ?`, never `game 0`, never a sentence
explaining that something did not add up. Nobody reading a footer has asked a question yet.

The embed exists only for a game the rating fold actually rated. A remake, a four-minute surrender, a
scoreboard that is not five a side, the second companion's re-post: no message. There is no "no ratings this
game" variant, because the whole message is what the game did to ten ratings and an embed that says nothing is
worse than silence.

Line format, deliberately the same shape as the teams embed so the two messages read as one scoreboard:

```
`adc` Bilal · 1668 (-45)
```

Filled in — Red wins the worked example, the underdog at 46%. **These are `rateGame`'s numbers** (M3.3,
2026-09-08: the earlier hand-computed version of this table was replaced by the output of the `openskill`
package, pinned as a snapshot in `apps/web/lib/discord/embeds.test.ts`):

> **Red wins · 34:12**
>
> Blue was favored 54%. Top damage: Lena, 47.3k.
>
> | **Blue** | **Red** |
> |---|---|
> | `top` Hana · 1393 (-41) | `top` Omar · 1510 (+41) |
> | `jungle` Iris · 1531 (-47) | `jungle` Rami · 1683 (+45) |
> | `mid` Karim · 1508 (-43) | `mid` Nadia · 1316 (+50) |
> | `adc` Bilal · 1668 (-45) | `adc` Lena · 2127 (+39) |
> | `support` Theo · 1372 (-47) | `support` Yuki · 1182 (+48) |
>
> Season 1 · game 47

The shape the hand version predicted survived contact with the package — Nadia at σ 5.10 moves most, Lena at
σ 4.50 moves least — but every individual number moved by one or two points, which is why nothing here may be
retyped by hand again. Duration and top damage are still invented; the docs pin no result for the worked
example.

**On this roster the two columns do happen to cancel** (−223 and +223), which the hand-computed version did
not (it had −228 and +231). They are not guaranteed to: movement scales with each player's own σ² and the two
sides' σ² sums are not equal, so the cancellation here is arithmetic luck, not a property. The rule is
unchanged and it is a rule about the embed, not about the numbers: **the result embed prints no team totals.**

Losers keep their side's field first-or-second position by side number, never reordered to put the winner
first: the two embeds must line up so that "my column" is in the same place both times. That includes the
vertical order inside a column: lane order, top to support, the same five positions as the teams embed. A
player whose role neither the scoreboard nor the stored split knows is printed without a role — the name
starts the line — and sorts after the five who have one, so the known rows never move to make room.

**The four number formats, so no surface invents a fifth.**

| | rule | reads |
|---|---|---|
| duration | `m:ss`, and `h:mm:ss` once past the hour. No zero padding on the leading unit, no `min`, no `34m 12s`. | `34:12`, `1:02:03`, `0:59` |
| delta | signed always, ASCII `+` / `-`, `+0` and `-0` for a change too small to round to a point | `(+43)`, `(-45)`, `(-0)` |
| damage | one decimal and `k` from a thousand up, the plain integer below it | `47.3k`, `1.0k`, `940` |
| odds | past tense, the favourite named, whole percent; when nobody was favoured, no number | `Blue was favored 54%.` `Red was favored 58%.` `Neither side was favored.` |

The coin flip is the one clause that is **not** core's words. Core's explanation line says `Even 50%.` and
that is right where it sits — first clause of a present-tense list, before the game, next to `Gap 0.` In the
result embed the same fragment lands under the headline `Red wins · 34:12`, in a line whose other half is a
full past-tense sentence, and it reads as a claim about the game that was just played rather than about the
prediction: *even, 50%* beside *Red wins* is a scoreline until you read it twice. It is also the common case
on the first night the group ever uses this — everyone unrated, every split gap 0 — so it is the first
result sentence anybody reads. Product, 2026-09-09: the result embed says `Neither side was favored.` The
number is dropped with it because 50% is what "neither" means and the percent was only ever there to carry
the size of the claim. Core's `Even 50%.` in the teams explanation is unchanged and stays core's.

**`-0` is a real value and it does not survive JSON.** `displayDelta` returns negative zero for a rating that
fell by less than half a point, and `formatDelta` asks `Object.is` before it looks at the sign. Anything that
carries a delta through `JSON.stringify` — an API response, a cached payload — turns `-0` into `0` and prints
`(+0)` on a row that went down. So a delta is computed where it is rendered and never transported. This is the
rule the tonight page and `/p/[puuid]` inherit (M3.4, M3.8), not just the embed.

**If the two columns wrap on a phone, drop `inline`.** `` `support` Theo · 1372 (-47) `` is 27 characters, and
a Discord mobile inline field is about half the message width. If that wraps to two lines, a five-line column
becomes ten ragged ones and the column stops being a column. The fix in that case is to make both result
fields full-width block fields — `Blue` above `Red`, five clean lines each — and **not** to shorten the line:
the role, the name, the new rating and the delta are the entire content. The teams embed's lines are six to
eight characters shorter and are expected to survive; if they do not, they take the same treatment. Decide this
by looking at one real post on one real phone, not from the JSON.

### Nightly leaderboard embed (M3.5)

One field, block, no columns — a ranked list is a single column by nature and inline fields would break it
across a row.

```
color        accent
title        Season 1 · standings
url          https://<leaderboard>
field 1 name   Top ten
field 1 value  `1` Lena · 1548 · 41 games
               `2` Bilal · 1137 · 44 games
               ...
footer       Proven stays below a new player's rating until the board has seen about 30 games.
```

The number after the name is the **Proven** number (`round(ordinal × 60)`), and the list is ordered by it,
descending. The embed prints Proven only: a one-number list must show the number it is ordered by, and a
second number in a proportional font with no column to sit in is unreadable. `Rating` is on the web page.

Filled in with the worked example's ten (`docs/02-milestones.md` M1.4 table — `ordinal = mu − 2σ`, then
`× 60`, rounded once). Game counts are illustrative; the docs pin none:

> **Season 1 · standings**
>
> **Top ten**
> `1` Lena · 1548 · 41 games
> `2` Bilal · 1137 · 44 games
> `3` Rami · 1062 · 39 games
> `4` Iris · 990 · 38 games
> `5` Karim · 987 · 40 games
> `6` Omar · 917 · 42 games
> `7` Hana · 882 · 37 games
> `8` Theo · 831 · 38 games
> `9` Nadia · 654 · 28 games
> `10` Yuki · 534 · 24 games
>
> Proven stays below a new player's rating until the board has seen about 30 games.

The arithmetic, so nobody has to redo it: Lena `34.80 − 2 × 4.50 = 25.80`, `× 60 = 1548`. Omar
`24.49 − 9.20 = 15.29`, `× 60 = 917.4 → 917`. Iris and Karim land 3 points apart (`990` / `987`) on a `1578` /
`1551` rating gap of 27 — Proven compresses, and rows will often sit close together. Design for near-ties: the
number is `t-md` mono tabular and never abbreviated, so `990` above `987` reads as ordered rather than equal.

Note the order is not the Rating order. Nadia (`1266` rating, `654` Proven) sits below Theo (`1419` / `831`)
on both, but Yuki at `1134` rating is last on Proven by a wider margin than her rating suggests, because her
σ is the second highest in the room. That is the whole point of the column, and it is why the footer sentence
ships with every one of these posts and not just the first.

Nadia and Yuki are under 30 games in this example, so on the **web** leaderboard both carry the `settling`
chip. The embed has no chip: the footer sentence covers the message, and a `(settling)` suffix per line would
double the length of the two lines that are already about the newest players.

## Implementation notes for the web engineer (v1 — token block superseded by Floodlit)

> The `tokens.css` block below is the **v1** file. The shipped file matches it; Floodlit replaces it. "The
> admin area stays plain", "The tonight page's three states — one rule" and the state table underneath are
> current and are not superseded.

### Tokens as CSS custom properties

New file `apps/web/app/tokens.css`, imported once from `apps/web/app/layout.tsx`. Prefix every custom property
`--cn-` so nothing collides with a library later.

```css
:root {
  color-scheme: dark light;

  --cn-bg: #12151a;
  --cn-surface: #1b2027;
  --cn-text: #e7eaef;
  --cn-dim: #97a0ad;
  --cn-blue: #6ba5f7;
  --cn-red: #ea6f69;
  --cn-accent: #e0a33e;

  --cn-hairline: color-mix(in srgb, var(--cn-text) 14%, transparent);
  --cn-blue-tint: color-mix(in srgb, var(--cn-blue) 7%, var(--cn-surface));
  --cn-red-tint: color-mix(in srgb, var(--cn-red) 7%, var(--cn-surface));
  --cn-accent-tint: color-mix(in srgb, var(--cn-accent) 10%, var(--cn-surface));

  --cn-sp-1: 0.25rem;  --cn-sp-2: 0.5rem;  --cn-sp-3: 0.75rem;  --cn-sp-4: 1rem;
  --cn-sp-5: 1.5rem;   --cn-sp-6: 2rem;    --cn-sp-7: 3rem;     --cn-sp-8: 4rem;

  --cn-t-xs: 0.75rem;  --cn-t-sm: 0.875rem;  --cn-t-base: 1.0625rem;
  --cn-t-md: 1.25rem;  --cn-t-lg: 1.625rem;  --cn-t-xl: 2.25rem;

  --cn-radius: 6px;
  --cn-radius-chip: 3px;
}

@media (prefers-color-scheme: light) {
  :root {
    --cn-bg: #f3f4f6;
    --cn-surface: #ffffff;
    --cn-text: #161a20;
    --cn-dim: #5b6573;
    --cn-blue: #1f5fc4;
    --cn-red: #b4302b;
    --cn-accent: #8e5b0e;
  }
}
```

Only the seven change between themes; every derived value follows for free. `color-scheme: dark light` (dark
first) makes scrollbars, form controls and the pre-paint background follow the same choice, so there is no
white flash opening the link in a dark room.

There is **no theme toggle** in M3. `prefers-color-scheme` is the whole switch. A toggle needs storage, a
server/client mismatch guard and a control in the header, and nobody has asked.

### Fonts

`next/font/google` in `apps/web/app/layout.tsx`, exposed as variables, `display: 'swap'`, `subsets: ['latin']`:

```
Archivo        -> --cn-font-sans   weights 400, 600, 700
IBM_Plex_Mono  -> --cn-font-mono   weights 400, 600
```

Put the generated class on `<html>`, and set `font-family: var(--cn-font-sans)` on `body`. Add a `.cn-num`
utility that sets `font-family: var(--cn-font-mono)` and `font-variant-numeric: tabular-nums`, and use it on
every rating, delta, gap, percentage, duration, rank number and role label. Fallback stacks are in the Type
section; put them in the CSS variable, not only in the `next/font` fallback array, so a blocked Google Fonts
request still lands on Helvetica/Menlo rather than Times.

### The admin area stays plain

`apps/web/app/admin/admin.css` **does not adopt these tokens.** It keeps `color-scheme: light dark` and the
browser's own colours and controls, exactly as its header comment says. Reasons: it is five people on a
laptop, it has no client JavaScript, every control is a native form control, and skinning them would mean
maintaining a second set of button/input/select styles for an audience that is already inside the building.

One thing to protect: `.admin` sets `font-family: system-ui, sans-serif`, which must **stay**, because the
root layout will set `body { font-family: var(--cn-font-sans) }` and the admin pages are inside that body.
Keep the `.admin` rule and the admin area keeps system fonts. If the admin ever gets a real UI, that is a task
and a decision row, not a drive-by.

### The tonight page's three states — one rule

M3.4 does not get to invent its own state model. The page renders **exactly one primary block**, chosen from
`lobbies.status` for the newest non-abandoned lobby today, plus at most one secondary block:

| `lobbies.status` | header strip reads | primary block | secondary block below |
|---|---|---|---|
| no lobby, or `abandoned` | `Nothing tonight` | Idle: one sentence, and a link to the leaderboard | — |
| `open` | `<n> in the lobby`, live dot | Lobby member list | — |
| `balanced` | `Teams set`, live dot | Sit-out notice, team cards, explanation line | — |
| `in_game` | `In game`, live dot | Sit-out notice, team cards, explanation line | — |
| `finished` | `Final` | Result card: headline, prediction line, the two team cards with **after** ratings and deltas, top damage | The explanation line of the split they played |

**The finished state, said once (M3.16, designer, 2026-09-09).** An earlier version of this row listed
"team cards and the explanation line" as a secondary block *under* the result card, and the "Result card"
component already puts both team cards inside the result card with the after ratings. Read together they put
two ratings for the same player on one screen, which is a bug report waiting in voice. Product's rule for M3.4
is **one rating per player per screen**, and the result card's is the one. So: the finished state renders the
result card and, under it, the explanation line of the split they played — and nothing else. There is no
second pair of team cards, before or after. The built page (M3.4) took this answer; this file now says the
same thing in both places.

A `finished` lobby whose game the rating fold did not rate — a remake, a four-minute surrender — has no result
card to draw: the header reads `Final`, the teams block and the explanation line stay up as they were, and
there are no deltas. No banner apologising for it; Discord stays silent about these games too.

Idle copy (product, 2026-09-08 — final), the same sentence the placeholder page already carries from M1.10 so
the wording does not change under people when M3.4 lands: `When ten of you are in a custom lobby with the
companion running, the teams show up here.` Under it, a link reading `Last night and the board`. Nothing
else: no illustration, no spinner, no "check back later". The header strip already says `Nothing tonight`, so
the body does not repeat it.

**No season active — the tonight page's own sentence (product, 2026-09-09 — final; M3.17).** `/admin`, the
seasons page and the companion's 503 all say `No season is active, so games cannot be saved. Start a season on
the Seasons page.` — one constant, `NO_ACTIVE_SEASON_MESSAGE` (M2.18). The tonight page does **not** say that.
It is the link that gets pasted in WhatsApp, so it is read by the whole group, and it would end by telling
twenty friends to open a page one of them can open. Its sentence is:

> No season is active, so tonight's games are not being saved. An admin can start one.

Same fact, no instruction the reader cannot follow, and no link to a locked door. It is not a state — it can
be true while the page is idle, filling, showing teams or showing a result — so it sits at the top of `main`,
directly under the header strip and above the primary block, in all four states. It is the one element on this
page that is ever additional to the state table above; it never replaces a block, and it is absent entirely
whenever a season is active. The treatment is the designer's call; the words are product's, and a change to
them goes through product.

The rule, in one sentence: **a state change replaces the primary block in place; the page never appends, never
scrolls itself, and never animates anything but a 150ms opacity fade.** The header strip is always mounted and
is the only element that survives every transition, so a phone reopened mid-night answers "where are we" in
one glance without scrolling.

Corollaries the implementation must respect:

- The lobby member list reserves ten rows of height, so the 9→10 transition does not move the page.
- `balanced` and `in_game` render the identical block. The only difference is the header word and the live
  dot; the teams do not re-render, do not re-fetch and do not fade.
- The explanation line is always the stored string of the currently promoted split (`splits.is_chosen`), on
  every state that shows teams, including after a reroll (M3.7).
- Realtime updates mutate state, never scroll position or focus. Someone tapping their role (M3.6) when the
  tenth player joins must not have the page move under their thumb.
- The header's live dot is the only pulsing element on the page, 2s opacity cycle, `accent`, and it stops at
  `finished`.

## What this design does not do (amended by Floodlit: one gradient, one glow)

Listed because each one is a thing a page like this drifts into:

- No emoji anywhere — not as section markers, not as side icons, not in embed field names, not for
  win/loss. The role words are the icons.
- No cream backgrounds, no serif display face, no purple or teal gradient, no acid green on black, no glass
  blur, no neon glow, no dark-mode-with-a-single-saturated-accent-everywhere.
- No champion art, avatars, crests, "VS" badges, or animated win banners. There is no asset pipeline and there
  should not be one.
- No skeleton shimmer. A dark room does not want a moving grey rectangle; empty states are one sentence.
- No toasts. Realtime already changes the thing you are looking at.
- No numbers rendered in a proportional font, ever.
