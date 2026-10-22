@AGENTS.md

## Workflow

- Joel is the only developer. Commit and push straight to `main`; don't open pull requests unless he asks for one.
- Before pushing, run `npm run typecheck`, `npm run lint` and `npm test`. Also run `npm run build` when a change touches routes, config or dependencies (Vercel deploys `main` with it).
- Push as you go, so nothing important lives only in a session's container.
