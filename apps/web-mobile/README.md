# @toby/web-mobile — mobile app (entry `/m/`)

The mobile web SPA of Toby. Dev server on **8631** at `/m/` — today
`pnpm --filter @toby/web-mobile dev`; the root `pnpm run dev` orchestrator
lands with the PR3 dev script. Production build is served by the Toby server
at `/m/`.

## Source layout

```
src/
├── assets/       # static assets owned by this app (logo, images, fonts)
├── components/   # app-wide generic components
│   └── ui/       # shadcn components, written here by `shadcn add`
├── features/     # feature slices, one directory per server domain
│   └── system/   # pages and feature-local components for the system domain
├── hooks/        # app-wide hooks
├── layouts/      # route shells: header, outlet, navigation
├── lib/          # wiring — API clients (api.ts); utils.ts re-exports cn from "cn"
├── App.tsx       # route table
├── index.css     # the app's single theme source (Tailwind v4 tokens)
└── main.tsx      # React root: QueryClient + HashRouter
```

Conventions:

- A page lives in `features/<domain>/`; anything used by more than one feature
  moves up to `components/`, `hooks/` or `lib/`.
- Cross-layer imports use the `@/` alias with an explicit extension
  (`@/lib/api.ts`) — the repo runs TypeScript directly, so extensionless
  specifiers do not resolve.
- Components, styles and assets are owned by this app and are **never shared**
  with `apps/web`; the only shared code is `@toby/contract`
  (docs/decisions/web-split-dual-apps.md).
