export const loaderStatuses = [
    "loading",
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

export const brandColors = [
    "front-blue",
    "back-blue",
    "front-green",
    "back-green",
    "front-red",
    "back-red",
    "front-yellow",
    "back-yellow",
    "over-brand",
] as const;

export type PaperBrandColor = (typeof brandColors)[number];

export const backgroundSurfaces = [
    "frontest",
    "front",
    "back",
    "backest",
    "definition",
    "element",
] as const;

export type PaperBackgroundSurface = (typeof backgroundSurfaces)[number];

export const borderColors = [
    "medium-border",
    "medium-dark-border",
    "dark-border",
] as const;

export type PaperBorderColor = (typeof borderColors)[number];

export const textColors = [
    "main-text",
    "lightish-text",
    "light-text",
    "lightest-text",
    "anti-background",
] as const;

export type PaperTextColor = (typeof textColors)[number];

export const paperColors = [
    ...brandColors,
    ...backgroundSurfaces,
    ...borderColors,
    ...textColors,
] as const;

export type PaperColor =
    | PaperBrandColor
    | PaperBackgroundSurface
    | PaperBorderColor
    | PaperTextColor
    | "blue"
    | "green"
    | "yellow"
    | "red"
    | "brand"
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
    "brand",
    "blue",
    "green",
    "yellow",
    "red",
    "text",
] as const;

export type PaperButtonVariant = (typeof buttonVariants)[number];

export const badgeVariants = [
    "monochrome",
    "blue",
    "green",
    "yellow",
    "red",
] as const;

export type PaperBadgeVariant = (typeof badgeVariants)[number];
