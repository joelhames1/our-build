# Our Build

Describe a house the way you'd tell a friend, typed or spoken, and watch it appear in 3D. Walk through it. Change it by talking ("add a third story", "move the sink to the island", tap a window and say "make this bigger"). When it feels right, export a plan set as a PDF or DXF.

Built for houses and small buildings: cottages, cabins, farmhouses, A-frames, bungalows, lake houses, tiny houses, a garage with a studio over it. Setup for deploying it is in [SETUP.md](SETUP.md).

## What it does

- **Talk to design.** Claude reads a compact summary of the design and changes it through typed operations (add a level, add a wing, resize a room, set up a kitchen, swap a window...). It never draws geometry itself, so every change is precise and undoable, and the 3D model assembles live while it works.
- **Architectural common sense.** Rooms get doors, windows and furniture automatically; kitchens get a working layout (sink under a window, a sensible triangle, 42" aisles), baths get real clearances, stairs get legal risers and headroom. Guardrails flag the things worth a second look (a bedroom without an egress window, a cramped hall) with one-tap fixes.
- **See it every way.** Exterior with materials, sun and site (lakes, islands, trees); a dollhouse cutaway; a walk-through with WASD/mouse or an on-screen joystick on the iPad; and a plan view where tapping anything selects it so "this" means something.
- **Drawings that look like drawings.** Floor plans with poché walls, door swings, fixture symbols, dimensions and door/window marks; a roof plan; four elevations and two sections with hidden lines removed; door, window, room and area schedules; titled sheets with a cover. PDF on 11×17 or 24×36, and DXF (R12, inches, AIA layers) for CAD.
- **Shared and safe.** Supabase sign-in for a household of two; every change is a version you can go back to.

Without an API key, a small rule-based demo assistant handles the common requests so everything else can be tried for free.

## How it fits together

```
src/core/       Pure TypeScript, shared by browser and server
  model/        Zod schema for the building (levels, rooms, openings, fixtures, stairs, roof, style, site)
  ops/          applyOps: atomic batches of operations, auto-dressing, layout helpers
  resolve/      Walls from room edges, openings, stairs, roof envelope, fixtures
  geometry/     Polygons, walls, roof faces, chimney, porch frame, planar faces for 3D and drawings
  furnish/      Furniture and kitchen/bath layouts
  rules/        Guardrails with fixes
  templates/    House types as code generators
  ai/           System prompt, tool definitions, design summary
src/drawings/   Drawing IR, plans, elevations, sections (hidden-line engine), schedules, sheets, SVG/PDF/DXF
src/viewer/     React Three Fiber scene, materials, walk mode
src/ui/         Home, studio, conversation bar, voice, panels, export dialog
src/lib/        Store (Supabase or IndexedDB), AI tool loop and demo engine, server auth
src/app/        Next.js routes, including /api/design (streams the AI turn as server-sent events)
```

The design model is the single source of truth. The 3D view, the plan view, the drawing set and the AI's summary are all derived from it, so they never disagree.

## Commands

| | |
| --- | --- |
| `npm run dev` | Run locally at http://localhost:3000 |
| `npm run build` / `npm start` | Production build (what Vercel runs) |
| `npm run typecheck`, `npm run lint` | TypeScript and ESLint |
| `npm test` | Unit tests (geometry, ops, rules, furnishing, walkability, drawings, PDF/DXF) |
| `npm run e2e` | Playwright: builds, starts with the demo assistant, drives the app at desktop and iPad sizes (first run: `npx playwright install chromium`) |
| `npm run eval` | Live AI evaluation over a dozen briefs and edits, with an HTML gallery in `eval-out/` |

Developer previews live at `/dev` (model gallery) and `/dev/drawings` (single drawings and whole sheet sets) when running `npm run dev`.

## Limits worth knowing

- These are conceptual design drawings, not construction documents. The sheets say so, and an architect or engineer should review anything before it gets built.
- Walls are rectilinear (no curves or angled walls yet), and roofs come from a fixed family (gable, hip, shed, flat, gambrel, A-frame, with porches and wings).
- Voice input uses the browser's speech recognition: Safari on iPad and Chrome on desktop work; Firefox doesn't.
