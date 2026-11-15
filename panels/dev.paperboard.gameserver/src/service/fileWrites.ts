// How the service edits a file the server reads: one edit at a time per
// file, each written whole by PaperAPI's writeFileAtomic. The Loader tab and
// the Files tab both edit server files, so both go through here.
import { KeyedQueue } from "@mileniumhq/paperapi";

// one write at a time per file: two quick edits must not both read the
// old text and the second overwrite the first
export const serializedFileTask = new KeyedQueue().run;
