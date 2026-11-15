import type { Server } from "./server";
import { system } from "@mileniumhq/paperapi";
import { createDirectoryLister } from "../core/directoryListing";
export { sanitizeFileName, isValidEntryName, isListableDirArg, type DirectoryListing } from "../core/directoryListing";
const lister = (ctx: Server) => createDirectoryLister({ fileApi: ctx.files, processApi: ctx.process, system });
/** A folder of the server's, by its path in the server folder. */
export const listDirectory = (ctx: Server, path: string) => lister(ctx).listDirectory(path);
/** listDirectory, giving what could be read when part of it could not. */
export const tryListDirectory = (ctx: Server, path: string) => lister(ctx).tryListDirectory(path);
