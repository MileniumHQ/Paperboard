// PaperUI as a test outside a page has it: its components can't load without
// one, so only the plain parts the code under test uses. Every suite that
// mocks PaperUI mocks it with this one module, since a mock is the whole
// test run's.
export { createLatest } from "../../../../packages/paperui/src/utils/latest";

/** a tap is felt only on a device */
export function haptic(): void {}
