# Panel Library banners

From beta 5 on, each beta gets its own Panel Library banner. The banner sits
at the top of the library's grid (`src/App.tsx`).

- One folder per beta: `beta-<n>/banner.webp`.
- Older betas' banners stay here as history, exactly as they shipped:
  - `beta-1`: v0.1, a PNG.
  - `beta-2`: v0.2, and it stayed on through beta 3.
  - `beta-4`: v0.4.
- A new beta adds its folder and points the import in `src/App.tsx` at it.
- The banner carries its own title and tagline, so keep the `alt` text in
  `src/App.tsx` matching what the image says.
