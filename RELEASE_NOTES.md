# ImWeb v0.21.1 — Reaching the Second Screen

*Released 2026-08-15*

v0.21.0 raised the output ceiling to 4K. It also left the one display that
matters most to a performer still capped at 1080p, and nobody would have noticed
from the release notes, because the setting that did it does not look like a
resolution setting.

Both items here came back from the tester v0.21.0 was built for, within hours of
him pulling it.

---

## The second screen can actually receive 4K

`2Display` is a different list from `Display` and `Record`, and it was never
extended. It offered `Same / 1080p / 720p / 540p` and **defaulted to 1080p** — so
a 4K project was quietly downscaled on its way to the projector. The picture the
audience sees was the one place the new resolutions could not reach.

It now runs `Same / 4K / 1440p / 1080p / 720p / 540p`.

**The default is deliberately unchanged at 1080p.** Raising a ceiling is not the
same as raising a default: the frame is read back off the GPU and transferred to
the other window, so 4K on every other frame is a real cost that should be asked
for rather than assumed. If you are driving a 4K projector, set it to `4K` or to
`Same`.

## …and it says what it is

The first question asked about that row was "what exactly does it refer to?",
which was entirely fair — it was a set of resolution-shaped values with nothing
saying what they applied to.

It is **not** the second screen's resolution. It is the size the picture is
resized to *before being sent* to that window: a detail-versus-transfer-cost
dial, where `Same` means no resize at all. Both the label and the control now
explain that on hover.

## Fullscreen on the second screen, without the white bar

The output window asked for fullscreen on `<body>` rather than on the document
element, which leaves the page's root element visible behind it as a strip along
the top. Reported in Brave and Zen; Safari happened to tolerate it, which is
exactly how a bug like this survives being tested in one browser.

The main window has always fullscreened the document element. The popup was the
only place that did not, and now it matches.

---

## Upgrading

Nothing to do, and nothing to re-save. The `2Display` setting is per-session and
was never stored in your projects, so reordering its list cannot affect a saved
file.

The service worker cache is now named **`imweb-v0.21.1`**. **If you self-host,
deploy a fresh `npm run build`** — a returning visitor's browser serves the
cached `index.html` until that constant changes, and a stale one points at bundle
hashes that no longer exist.

## Credits

ImWeb is a reimagining of *Image/ine* by Tom Demeyer and Steina Vasulka
(STEIM Amsterdam, 1997/2008). See [CREDITS.md](CREDITS.md).
