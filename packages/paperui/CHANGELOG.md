# Changelog — `@paperboard-dev/paperui`

## 1.1.0

### New Features
- Layout props on `PaperContainer`, `PaperList`, `PaperFlex`, `PaperSettingList`: `flex`, `shrink`, `grow`, `min/maxWidth/Height`, `fullWidth`, `fullHeight`, `scrollable`, `overflowX/Y`
- `PaperList`: `borderless`, `fullWidth`, `fullHeight`, `scrollable` (`true` / `"x"` / `"y"`)
- `PaperText`: `breakWord`, `truncate` (`true` or line-clamp number)
- `PaperRail`: `showLabels` on the rail with per-item `showLabel` override
- `PaperSettingList`: `autoHeight`, `flex`
- Helpers: `usePaperLayout()`, `resolveLayoutStyles()`, `cx()`

### Changes
- `PaperSelectMenu` popup now renders in a `Portal` with fixed positioning: flips above the trigger when there is no room below, clamps to the viewport, and repositions on scroll/resize
- `PaperRailItem` is now a `div role="radio"` with keyboard support (Space/Enter) instead of a label + hidden input, so focusing it no longer scrolls ancestor scrollers or the iframe shell
- `PaperFlex` resize drag listens on `window` for smoother drags; spacing/background only resolve when set
- Selection radio input uses a zero-area focus target so the browser has nothing to scroll-reveal

### UI
- Rail with labels: 50px rows, 24px icons, 2-line clamped 10px labels, blue selected state
- Menus: `min-width: 160px`, 7-row max height with thin scrollbar, `z-index: 3000`
- `PaperSettingList` supports full-height scrolling or auto height

### Technical Changes
- Version `0.1.1` → `1.1.0`
- No dependency changes
- New modules: `src/contexts/layout.tsx`, `src/utils/cx.ts`
- New tests: `src/__tests__/layout.test.tsx`

## 0.1.1

### New Features
- `PaperMediaCardGroup`: responsive grid (`repeat(auto-fill, minmax(minCardWidth ?? 16rem, 1fr))`)
- `PaperFlex`: `overflow` prop

### Changes
- Fixed `PaperSelectMenu` toggle race (open state now computed before setting)
- Forced `light` / `dark` theme attributes now win over `prefers-color-scheme`
- `PaperSettingItem` rows rebuilt on `PaperFlex`; removed hover background and fixed sub-element classes
- `PaperBadge` monochrome uses light text

## 0.1.0

Alpha 1 baseline. Reduced motion + new `PaperSelectMenu`.
