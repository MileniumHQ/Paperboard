// PaperUI as a suite outside a page has it. Its components can't load
// without a page, so the preload (bunfig.toml) mocks the whole package with
// the plain parts the code under test uses, from PaperUI's own source.
import { mock } from "bun:test";

mock.module("@mileniumhq/paperui", async () => ({
    ...(await import("../../../../packages/paperui/src/utils/keepUnchanged")),
    ...(await import("../../../../packages/paperui/src/utils/savedValue")),
    ...(await import("../../../../packages/paperui/src/utils/latest")),
}));
