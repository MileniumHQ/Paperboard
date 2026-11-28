import type { INPUT_ENCODINGS } from "@mileniumhq/paperapi/protocol";

// how a workload's input is encoded on its way in
export type InputEncoding = (typeof INPUT_ENCODINGS)[number];

