# Design Principles

English | [简体中文](principles.zh.md)

Toby is a quiet personal tool, not a marketing surface. The visual language is minimal and flat, and every effect has to earn its place. This file is the reference for UI work in both web apps; the code-level theme lives in each app's `src/index.css`.

## Flat over layered

Selection and active states speak with **fill and weight** — the `--accent-soft` fill (the same tint the focus halo uses) plus `font-medium` — never with shadows. Elevation creates a hierarchy the product doesn't need. (Case: the sidebar's selected pill dropped its `shadow-sm`; the fill is what marks it now.)

## Focus is a halo, not a frame

Focus feedback is a soft 3px `--accent-soft` halo (8% primary), and every input shares one treatment — the chat composer and the login field use the same halo. Never a full-strength `--ring` as a focus ring: in light theme it is near-black and reads as a hard black frame. Keyboard focus must stay visible; the halo is how it stays visible, not a reason to remove it.

## Semantic tokens only

Components consume the theme tokens (`--background`, `--card`, `--muted`, `--ring`, `--accent-soft`, …) and never raw color values. The palette is the shadcn zinc neutrals — black primary, no color cast; each app's `index.css` is the single theme source for that app.

## Elevation is the exception

Soft, low-alpha ambient shadows exist only on primary input surfaces — the chat composer and the login field, following the ChatGPT/Claude convention. Everything else defaults to no shadow; adding a new one needs a reason stated here.

## One language, two apps

PC and mobile never share code but do share this language. When two components need the same affordance, they get the same treatment; the first implementation sets the pattern for the next one.
