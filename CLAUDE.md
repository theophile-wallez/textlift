# textlift

A Chrome extension (manifest v3) that reads the text of an image with Tesseract
and lays a selectable copy of that text over the picture. TypeScript, Zod for
every message, Effect for the pipeline of the two service layers.

`README.md` holds the architecture and the reasons behind it. Read it first.

## Checks

```sh
npm run check         # every change: format, types, build, unit tests
npm run test:browser  # a change of the engine, the manifest, or the overlay
```

`npm run test:browser` needs Chromium and a display. Use
`xvfb-run -a npm run test:browser` on a machine without one, because Chrome loads
an unpacked extension in a headed browser only.

## Rules

- Keep `src/core/` pure. It imports no browser API and no Effect, apart from
  `errors.ts`, which needs `Data.TaggedError`. The unit tests cover this
  directory, and that only works while it stays pure.
- Keep the content script free of Effect. It runs on every page, so its bundle
  stays small. It holds the DOM and nothing else.
- Import Zod as `import * as z from "zod"`. The named import
  `import { z } from "zod"` builds a namespace object that no bundler can shake,
  and it added 335 kB to the content script.
- Validate every incoming message against its schema in `src/core/protocol.ts`.
  A stale page of a previous version can still send an old shape after a reload.
- Do not edit `dist/manifest.json`. Edit `src/manifest.ts`, then run
  `npm run build`. A test compares the two.
- Report a failure through a tagged error of `src/core/errors.ts`. The service
  worker chooses the recovery from the tag, and `userMessage` gives the sentence
  that the user reads.
- Add `retryable: true` to an error only when a second source of pixels can
  succeed, because that flag starts the screenshot fallback.
- Never repaint the text layer on a scroll. A repaint replaces every span, and
  that drops the selection of the user. `Overlay.reposition` repaints on a size
  change and on new data only.
- Keep `public/vendor/` out of git. `npm run vendor` collects it, and the build
  runs that script when a file is missing.
- The icons in `icons/` are generated. Edit `scripts/make-icons.mjs`, then run
  `npm run icons`.
- `docs/demo.png` is generated, and it stays in git because the README shows it.
  Run `xvfb-run -a npm run demo` after a change of the overlay.
- A release comes from a tag. `npm version patch && git push --follow-tags` starts
  `.github/workflows/release.yml`, which attaches the ZIP to the release. Never
  upload a package by hand, because the workflow is the only path that runs the
  browser test first.

## Auto-ship

- Work in a secondary worktree, not in the primary `master` checkout.
- When the task is complete and `npm run check` passes, run `/ship` without
  asking. Run `npm run test:browser` as well when the change touches the engine,
  the manifest, or the overlay.
