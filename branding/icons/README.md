These are the SVG forms of icons found around the codebase. Some are unused. These icons use either custom designs, or Material Symbols Rounded icons. Generally, sizing of the inner vector and the colors/gradient type & direction don’t need to be consistent, as long as it looks good. What does need to be consistent is the stacked layer style, which works as follows:

Every icon is an 875 × 875 canvas holding three layers, each its own group in the SVG, painted in order:

1. **`layer-1`, the back tile.** An 800 × 800 tile offset by 75 on both axes, so it peeks out to the bottom right. Its corners are 150 except the bottom right, which is 225. It's a darker shade of the front tile's color (or a darker version of its gradient). The path is the same in every icon:

   ```
   M75 225C75 142.157 142.157 75 225 75H725C807.843 75 875 142.157 875 225V650C875 774.264 774.264 875 650 875H225C142.157 875 75 807.843 75 725V225Z
   ```

2. **`layer-2`, the front tile.** An 800 × 800 tile at the top left, corner radius 150: `<rect width="800" height="800" rx="150"/>`. A tile with a border keeps that same outer edge, so the border is drawn inside it (a 30 border is a rect at 15 with `rx="135"` and `stroke-width="30"`).
3. **`layer-3`, the glyph.** The symbol, usually white, centered on the front tile and kept inside it. It never reaches into the back tile.

Some icons split a layer into more shapes (PaperUI's quadrants, the Blocks pegboard), but those shapes still stay inside their layer's outline and group. An icon without a glyph, like Cascade, just leaves out `layer-3`.

Keep the SVGs plain: paths, basic shapes, linear gradients, patterns, clip paths and standard filters only. No Figma export leftovers (`data-figma-*` attributes, `foreignObject` gradients, generated ids). SVG has no conic gradient, so a conic one is drawn as thin wedges clipped to its tile (see `panel-library.svg`).

`png/` has every icon rendered at 512 × 512. Regenerate one after changing its SVG:

```sh
rsvg-convert -w 512 -h 512 branding/icons/<name>.svg -o branding/icons/png/<name>.png
```

## Apple app icon

macOS and iOS use the Paperboard icon as an Icon Composer `.icon`, so it gets Liquid Glass and the dark, clear and tinted appearances. Apple draws its own squircle, and the whole logo sits inside it: the glyph never leaves its stack. The fill is white fading to a cool grey, and the logo is four glass groups, front to back: the three white triangles, the half-opacity wedge, the front tile and the back tile. It's the 875 canvas at 78%, centred on a 1024 × 1024 one. The wedge is its own group so dark mode keeps it see-through.

- macOS: `apps/paperboard/build/icon.icon`. electron-builder compiles it with `actool` (Xcode 26 or later), which also writes the `.icns` older macOS shows.
- iOS: `mobile/ios/App/App/AppIcon.icon` in paperboard-cloud, the same files.

Edit it in Icon Composer (in Xcode's developer apps) and copy the result to both. To see every appearance without opening it:

```sh
ictool icon.icon --export-image --output-file out.png --platform iOS --rendition Dark --width 1024 --height 1024 --scale 1
```

Renditions are `Default`, `Dark`, `ClearLight`, `ClearDark`, `TintedLight` and `TintedDark`. `ictool` lives in `Icon Composer.app/Contents/Executables/`.

Android's launcher icon (paperboard-cloud, `mobile/android/app/src/main/res/drawable/ic_launcher_*.xml`) is the same fill and logo as vectors, with the logo two thirds of the visible icon. Its themed-icon layer draws the back tile, front tile and glyph at rising opacity.

The macOS menu bar shows `apps/paperboard/resources/trayTemplate.png` (18 px, with a 36 px `@2x`): the whole logo in black, the back tile at half opacity and the glyph cut out of the front tile, which macOS recolours for the bar.
