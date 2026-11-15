import type { PaperFileContent, PaperFileListing, PaperFileSaveResult } from "@mileniumhq/paperui";
import type { AddonConfigLocation } from "../service/addonConfig";
import { serverCalls } from "./api";

// The Files tab's calls. The service owns every path check and size cap;
// these only carry the request.

export const listServerFiles = (path: string) =>
    serverCalls.listServerFiles({ path });

export const readServerFile = (path: string) =>
    serverCalls.readServerFile({ path });

export const writeServerFile = (path: string, text: string, version: string | undefined) =>
    serverCalls.writeServerFile({ path, text, version });

export const locateAddonConfig = (filename: string) =>
    serverCalls.locateAddonConfig({ filename });
