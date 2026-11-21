# Panel Library banners

From beta 5 on, each beta gets its own Panel Library banner. The banner sits
at the top of the library's grid (`src/App.tsx`).

- One folder per beta: `beta-<n>/banner.webp`.
- Older betas' banners stay here, so they can be shown again.
- A new beta adds its folder and points the import in `src/App.tsx` at it.
- The banner carries its own title and tagline, so keep the `alt` text in
  `src/App.tsx` matching what the image says.
