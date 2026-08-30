# ImWeb v0.22.0 — Out of Focus

*Released 2026-08-30*

The headline is a lens. Everything else in this release is the movie decks and
the Playback zone catching up with each other.

## Bokeh

A defocus effect in **Effects › Optics**, sitting immediately before Bloom —
which is where a lens would put it, so the boosted highlights feed Bloom's
threshold and the two compose as one optical stage.

It is not a blur with a hole in it. Bright points spread into real discs, and
**Bokeh.Ring** decides where the energy sits across each one: positive puts a
bright rim on every highlight and reads as nearly hollow at the extreme — the
soap-bubble bokeh of a fast lens or a mirror lens — while negative is
centre-weighted and soft. **Bokeh.Blades** shapes the disc into a 5, 6 or
8-sided iris, and **Bokeh.Iris** turns it.

What decides *where* it defocuses is **Bokeh.Mask**, and this is the part worth
understanding. Video carries no depth buffer, so a literal depth-of-field is not
available: the only monocular depth estimator that runs live in a browser costs
a throttled neural pass, and the diffusion-based approaches are seconds per
frame. So the effect reads a **routable source** as its mask instead, and does
not care what that source means. Motion by default — a moving subject stays
sharp while the static background goes soft. If real depth ever arrives as a
source, it drives this effect unchanged.

**Bokeh.Focus** is the mask value that stays sharp, in either direction: 100 %
keeps white sharp, 0 % keeps black sharp, and a value in between keeps a band
sharp and defocuses away from it on both sides. That is why there is no Invert
control — Focus already covers both polarities, and two ways to encode one state
is a second saved value that can disagree with the first.

**Bokeh.Discs** is what makes discs appear on ordinary footage rather than only
on fairy lights. A plain gather images what is actually there, so it forms a
disc only from a highlight smaller than the blur radius — and spreading a point
across a disc divides its energy by the sample count, leaving a disc too faint
to see. Discs extracts the highlights above **Bokeh.Thresh**, gathers those
separately, and adds them back with gain. Raising Thresh shrinks each highlight
to its brightest core, which is what lets a large soft highlight become a ring
at all. Set Discs to 0 for a purely optical defocus, which also skips both extra
passes.

**Bokeh.Smooth** eases the mask over time, so focus drifts in and lets go
instead of snapping with every twitch of a motion matte. In seconds, on the same
"time to visually gone" convention Motion Extraction uses.

**Bokeh.Radius** is a percentage of frame height rather than pixels, so a look
survives a change of resolution instead of halving in strength between 1080p and
4K. **Bokeh.Quality** (Draft/Good/Fine/Max) sets the sample count; Good costs
roughly one Bloom. A large radius at a low quality will show grain, because
radius and sample count are coupled by nature.

## Movie decks

- **Eight cue slots per deck.** A cue captures MovieStart, MovieEnd and
  MoviePos — a place in the clip, recalled as one act.
- **ClipFade** — switching clips on a deck can dissolve instead of cutting.
- **MovieLen** — the loop window's length as a control instead of an outcome.
- **SlideRange** — MoviePos drags the whole in/out window through the clip
  rather than moving the head inside it.
- **MovieSpeed now spans −5 – 5** (was −3 – 3), on both decks.

## Audio

- **Eight region cues for the Playback Zone**, on the same shared CueBank the
  movie decks use.
- **Level Play** — the Playback zone finally has a fader.

## MIDI

- **Learned mappings survive a reload.** Remembered per origin and restored at
  startup. **Mappings only, never values** — persisting a controller record
  whole would boot the instrument into a partial version of however you left it.
- **One MIDI control per option** on a button-group parameter.
- **A button no longer fires twice.** Hardware buttons are momentary; the CC
  path fed both press and release into the parameter, so a toggle turned on and
  straight back off. CC buttons now act on the press and ignore the release,
  which is what notes and gamepad buttons always did. Knobs and faders are
  unaffected.

## Fixes

- Trimming a loop no longer strands the playhead outside it.
- Shift+0 selects the first clip; Neutral State moved to Cmd+Shift+0, and Shift+0
  now says what it did.
- MovieSpeed 0 no longer throws inside the render loop.
