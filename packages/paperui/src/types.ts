export const loaderStatuses = [
    "loading",
    "indeterminate",
    "success",
    "error",
    "waiting",
] as const;
export type LoaderStatus = (typeof loaderStatuses)[number];

export const selectorStyles = ["selector", "list", "rail"] as const;
export type SelectorStyle = (typeof selectorStyles)[number];

export const spacingSizes = [
    "none",
    "onefourth",
    "half",
    "threefourths",
    "full",
    "sixfourths",
    "double",
    "triple",
    "quadruple",
] as const;

export type PaperSpacingSize = (typeof spacingSizes)[number];
export type PaperSpacing = PaperSpacingSize | (string & {}) | number;

/** the semantic color roles; each maps to --paper-<role> and -deep */
export const paperRoles = [
    "primary",
    "brand",
    "success",
    "danger",
    "warning",
    "attention",
    "extra-1",
    "extra-2",
    "extra-3",
] as const;

export type PaperRole = (typeof paperRoles)[number];

export const backgroundSurfaces = [
    "surface-raised",
    "surface",
    "surface-sunken",
    "surface-app",
    "surface-inset",
    "surface-element",
] as const;

export type PaperBackgroundSurface = (typeof backgroundSurfaces)[number];

export const borderColors = [
    "border-subtle",
    "border",
    "border-strong",
    "border-emphasis",
] as const;

export type PaperBorderColor = (typeof borderColors)[number];

export const textColors = [
    "text",
    "text-muted",
    "text-subtle",
    "text-faint",
    "contrast",
    "on-color",
] as const;

export type PaperTextColor = (typeof textColors)[number];

export const paperColors = [
    ...paperRoles,
    ...backgroundSurfaces,
    ...borderColors,
    ...textColors,
] as const;

export type PaperColor =
    | PaperRole
    | PaperBackgroundSurface
    | PaperBorderColor
    | PaperTextColor
    | (string & {});

export const textSizes = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
] as const;
export type PaperTextSize = (typeof textSizes)[number];

export const textPresets = [
    "headline",
    "header",
    "subheader",
    "title",
    "subtitle",
    "section",
    "body",
    "caption",
] as const;

export type PaperTextPreset = (typeof textPresets)[number] | (string & {});

export const buttonVariants = [
    ...paperRoles,
    "text",
] as const;

export type PaperButtonVariant = (typeof buttonVariants)[number];

export const badgeVariants = [
    "monochrome",
    ...paperRoles,
] as const;

export type PaperBadgeVariant = (typeof badgeVariants)[number];
