// The parts of PaperUI that need no page: state helpers, haptics and the
// toast calls (PaperToastRegion, a component, draws them), for
// code a test runs outside a browser (a page's logic in a Bun test, a
// widget's store). They import nothing but Solid, no component and no CSS.
// A page may import them from here or from "@mileniumhq/paperui"; both are
// the same modules.
export * from "./utils/latest";
export * from "./utils/read";
export * from "./utils/action";
export * from "./utils/keepUnchanged";
export * from "./utils/savedValue";
export * from "./utils/haptics";
export {
    createFailureToast,
    dismissToast,
    showError,
    showToast,
    type FailureToastOptions,
    type ShowErrorOptions,
    type PaperToastAction,
    type PaperToastOptions,
    type PaperToastVariant,
} from "./utils/toasts";
