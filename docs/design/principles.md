# Design Principles

English | [简体中文](principles.zh.md)

Toby is a quiet personal tool, not a marketing surface. The visual language is minimal and flat, and every effect has to earn its place. This file is the reference for UI work in both web apps; the code-level theme lives in each app's `src/index.css`.

## Flat over layered

Selection and active states speak with **fill and weight** — the `--accent-soft` fill (the same tint the focus halo uses) plus `font-medium` — never with shadows. Elevation creates a hierarchy the product doesn't need. (Case: the sidebar's selected pill dropped its `shadow-sm`; the fill is what marks it now.)

## Focus is a halo, not a frame

Focus feedback is a soft 3px `--accent-soft` halo (8% primary) on boxed inputs — the chat composer carries it. The login field is an underline input: its focus state is the underline going full-strength (`border-foreground`), never a halo around a bare underline. Never a full-strength `--ring` as a focus ring: in light theme it is near-black and reads as a hard black frame. Keyboard focus must stay visible; the halo — or the strong underline — is how it stays visible, not a reason to remove it.

## Semantic tokens only

Components consume the theme tokens (`--background`, `--card`, `--muted`, `--ring`, `--accent-soft`, …) and never raw color values. The palette is the shadcn zinc neutrals — black primary, no color cast; each app's `index.css` is the single theme source for that app.

## Elevation is the exception

Soft, low-alpha ambient shadows exist only on the chat composer, following the ChatGPT/Claude convention. The login card is flat by design — borderless, shadow-free white on the muted panel — with the password field drawn as an underline (`border-foreground/40`, full strength on focus); a shadow rim reads muddy and a full-stroke outline reads thick on scaled displays. Everything else defaults to no shadow; adding a new one needs a reason stated here.

## One language, two apps

PC and mobile never share code but do share this language. When two components need the same affordance, they get the same treatment; the first implementation sets the pattern for the next one.
