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
widths are the design width; the desktop layout is the phone layout with two columns.

Tone: a scoreboard in a friend's living room. Plain nouns, real numbers, no hype. Never "GG", never "EPIC",
never a broadcast lower-third. The subject already has a vocabulary — `top jungle mid adc support`, blue 100
and red 200, ranks, ratings — and that vocabulary is the content. It is never decoration.

## Palette

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

## Type

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

## Spacing, size, motion

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
- Every tappable thing is at least **44 × 44px**, including the role-override taps (M3.6) and the reroll
  button.
- Motion: one transition, `opacity 150ms ease`. New rows fade in. Nothing slides, nothing scales, nothing
  pulses more than a 2s opacity cycle on the single live dot. Honour `prefers-reduced-motion: reduce` by
  dropping to no transition at all. The page must never move under a thumb that is about to tap.

## Components

### Lobby member list — state "filling"

- Hero: the count, `t-xl` mono, `7` in `accent`, then ` in the lobby` in `t-base` `dim`. Under it, a row of
  ten 3px bars, `sp-1` apart, filled ones `accent`, empty ones hairline. That row is the whole status at
  arm's length: you can count it without reading.
- One row per member, in join order, oldest first. Newest is appended, not prepended — a list that reorders
  under a thumb is worse than a list you scroll.
- Row (min-height 44px, hairline between): name `t-md` 600 · main role `t-xs` mono `dim`, secondary role
  after a `/` also `dim` · display rating right-aligned, `t-md` mono tabular.
- A member who joined in the last 3s carries a 2px `accent` left border, then it fades.
- The signed-in viewer's own row: 2px `accent` left border, permanent. Finding yourself is job one.
- **Reserve ten rows' height from the start.** Going from 9 to 10 must not shift the page while someone is
  reading it.
- People beyond the ten (`is_spectator`) sit under a hairline labelled `Around` in `t-xs` `dim`.
- Empty: `Nobody in the lobby yet.` in `dim`. Not an illustration, not a spinner.

### Team card

- Two cards. Stacked on phone, **blue first** (side 100 is the lower number and the client's first side).
  Side by side at ≥720px, equal width, blue left.
- Card: `surface` with the side tint, 6px radius, a 3px rule in the side colour along the **top** edge only.
- Header row: `Blue` in the side colour, `t-lg` 600, and on the right the sum of the five display ratings,
  mono `t-md` `dim`. Label it `7695` with no word: the header is `Blue` and a number, and the explanation line
  below owns the word "gap". They are not the same quantity (see "Sums are not the gap" below).
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
  shows core's own sentence in `dim` `t-sm`: `No more splits. Rebalance or play these.`
- After a reroll the strip re-renders with the promoted split's stored string (M3.7). Same element, opacity
  fade, no scroll.

### Sit-out notice

- Full-width strip above the team cards, `surface`, 2px `accent` left border, `t-base`.
- Above, not below: if you are sitting out, everything under it is not about you, and you should learn that
  before you scan for your name.
- When the viewer is one of the sitting players the strip leads with a second-person sentence and keeps the
  `accent` border; nobody else's strip changes.
- Copy — **PLACEHOLDER, product to finalise** (the rule is fewest games tonight, then oldest sit-out):
  - general: `Sitting out this game: Sara and Deniz. They have played the most tonight, so they are first in next game.`
  - viewer: `You are sitting this one out. You have played the most tonight, so you are first in next game.`

### Result card

- Headline `Red wins` in the winner's side colour, `t-xl` 700, with the duration beside it in mono `t-sm`
  `dim`: `34:12`.
- Second line, `t-base` `dim`: the prediction, kept honest — `Blue was favored 54%.` The bot said a number
  before the game; it does not get to quietly drop it after.
- Then the two team cards again, unchanged in structure, with each row's rating replaced by the **after**
  rating and a delta chip. The card for the winning side keeps its 3px top rule; the losing side's rule drops
  to hairline `dim`. That is the only difference between them.
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
- Line 1: rank number, mono `t-sm` `dim`, fixed 2.5ch · name Archivo `t-md` 600, single line, ellipsis ·
  the board number, mono `t-md` 600, right.
- Line 2, `t-xs` `dim`: `24 games · 13W 11L · W3` and, when the player has fewer than 30 games, the
  `settling` chip.
- Rank 1 gets `accent` on the **rank number only**. No medals, no trophies, no emoji, no highlight row.
- The viewer's own row: 2px `accent` left border. No auto-scroll to it.
- **Two numbers, one problem.** The board sorts on `ordinal = mu − 2σ` but the number everyone knows is
  `round(mu × 60)`. Showing the second while sorting on the first puts visibly out-of-order numbers on the
  page, which is the exact complaint M3.8 exists to prevent. The design shows **both**, columns labelled:
  `Board` (`round(ordinal × 60)`, the sort key, primary, right-most) and `Rating` (`round(mu × 60)`, `dim`,
  mono `t-sm`, on line 2). Then the sort matches the primary column exactly, and "still settling" is the
  sentence that explains why your two numbers differ. Flagged to the lead — see FINDINGS.

### Still-settling marker (M3.8)

- The marker is a chip: the word `settling`, mono `t-xs`, `dim`, 1px hairline border, 3px radius, `sp-1`
  horizontal padding. No colour, no dot, no emoji, no asterisk. It reads as a label, not a warning.
- Placed after the meta on line 2 of the leaderboard row, and beside the rating on `/p/[puuid]`.
- The sentence appears **once per page**, under the leaderboard heading and under the rating chart on the
  player page — not per row. Copy is **PLACEHOLDER, product finalises** (M3.8 says so explicitly):
  `The board is deliberately cautious with new players: it counts you lower than your rating until it has seen
  about 30 games.`
- Disappears at 30 games with no ceremony.

### Rating history (`/p/[puuid]`)

- A single 1.5px `accent` line, no fill, no points, no grid. X is game index, not date — nights are uneven and
  a date axis makes a settled player look erratic.
- One hairline horizontal reference at the seed rating with a `t-xs` `dim` label `seed`.
- Height 140px on phone. No tooltip on hover; the recent-games list underneath is the detail view.

## Discord embeds

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
url          https://<tonight page>
description  <splits.explanation, verbatim>
field 1      name "Blue · 7695"   inline  value: five lines, lane order
field 2      name "Red · 7595"    inline  value: five lines, lane order
field 3      name "Sitting out"   block   value: names + one sentence   [only if > 10 around]
field 4      name "Lobby"         block   value: name and password      [only if known]
footer       Customs Night · reroll on the tonight page
timestamp    now
```

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
> Customs Night · reroll on the tonight page

The exact strings the API builds:

```
title        Teams are set
description  Blue favored 54%. Everyone on a main role. Gap 100. Next best: swap Hana and Omar, gap 170.

field 1 name   Blue · 7695
field 1 value  `top` Hana · 1434
               `jungle` Iris · 1578
               `mid` Karim · 1551
               `adc` Bilal · 1713
               `support` Theo · 1419

field 2 name   Red · 7595
field 2 value  `top` Omar · 1469
               `jungle` Rami · 1638
               `mid` Nadia · 1266
               `adc` Lena · 2088
               `support` Yuki · 1134

field 4 name   Lobby
field 4 value  `customs-night` · password `4471`

footer         Customs Night · reroll on the tonight page
```

Budget: a side field is ~110 characters against a 1024 limit, so a name would have to be ~180 characters to
threaten it. Truncate a display name at 32 characters with `…` at the source anyway; do not truncate the field.

Sit-out field, when it exists — copy is **PLACEHOLDER, product finalises**:

```
field 3 name   Sitting out
field 3 value  Sara, Deniz
               They have played the most tonight, so they are first in next game.
```

**Sums are not the gap.** `7695` and `7595` are the sums of five display ratings. Their difference equals the
`Gap 100` in the explanation only because nobody here is off-role; the gap is computed on effective
(role-adjusted) skill. The field name is therefore just `Blue · 7695`, with no label — the embed never claims
the two numbers are the same thing, and the explanation line is the only place the word "gap" appears.

### Result embed

```
color        winner's side colour
title        Red wins · 34:12
url          https://<tonight page>
description  Blue was favored 54%. Top damage: Lena, 47.3k.
field 1      name "Blue"   inline   five lines: new rating and delta
field 2      name "Red"    inline   five lines: new rating and delta
footer       Season 1 · game 47
timestamp    game end
```

Line format, deliberately the same shape as the teams embed so the two messages read as one scoreboard:

```
`adc` Bilal · 1667 (-46)
```

Filled in — Red wins the worked example, the underdog at 46%:

> **Red wins · 34:12**
>
> Blue was favored 54%. Top damage: Lena, 47.3k.
>
> | **Blue** | **Red** |
> |---|---|
> | `top` Hana · 1392 (-42) | `top` Omar · 1512 (+43) |
> | `jungle` Iris · 1530 (-48) | `jungle` Rami · 1684 (+46) |
> | `mid` Karim · 1507 (-44) | `mid` Nadia · 1318 (+52) |
> | `adc` Bilal · 1667 (-46) | `adc` Lena · 2128 (+40) |
> | `support` Theo · 1371 (-48) | `support` Yuki · 1184 (+50) |
>
> Season 1 · game 47

Notes on the numbers above: they are consistent with the model (movement scales with each player's σ², so
Nadia at σ 5.10 moves most and Lena at σ 4.50 moves least, and the underdog win moves everyone more than a
favourite's win would), but they were computed by hand from the two-team Plackett-Luce reduction, not by the
`openskill` package. **Verify against `rateGame` before pinning them in a test.** Duration and top damage are
invented; the docs pin no result for the worked example.

The two columns do not sum to zero (−228 and +231). That is correct and it is why the result embed prints no
team totals.

Losers keep their side's field first-or-second position by side number, never reordered to put the winner
first: the two embeds must line up so that "my column" is in the same place both times.

### Nightly leaderboard embed (M3.5)

One field, block, no columns — a ranked list is a single column by nature and inline fields would break it
across a row.

```
color        accent
title        Season 1 · standings
url          https://<leaderboard>
field 1 name   Top ten
field 1 value  `1` Lena · 2128 · 31 games
               `2` Bilal · 1667 · 44 games
               ...
footer       Board rating counts new players low until about 30 games.
```

The number after the name is the **board** number (`round(ordinal × 60)`), matching the sort. The footer is
the still-settling sentence in its shortest form — placeholder, product finalises.

## Implementation notes for the web engineer

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
| `finished` | `Final` | Result card | Team cards and the explanation line, unchanged |

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

## What this design does not do

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
