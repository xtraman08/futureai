# Kanban Studio

## Run

```bash
npm install
npm run dev
```

`npm run build` exports the static site to `out/`. Production serves that output
through FastAPI in the project Docker image; there is no standalone Next.js
production server.

## Tests

```bash
npm run test:unit
npm run test:e2e
```
