import type { PaperFileContent, PaperFileListing, PaperFileSaveResult } from "@mileniumhq/paperui";
import { serverBridge } from "./server";
import { ACTION_IDS } from "../service/contract";
import type { AddonConfigLocation } from "../service/addonConfig";

// The Files tab's calls. The service owns every path check and size cap;
// these only carry the request.

export const listServerFiles = (path: string) =>
    serverBridge.call<PaperFileListing>(ACTION_IDS.listServerFiles, { path });

export const readServerFile = (path: string) =>
    serverBridge.call<PaperFileContent>(ACTION_IDS.readServerFile, { path });

export const writeServerFile = (path: string, text: string, version: string | undefined) =>
    serverBridge.call<PaperFileSaveResult>(ACTION_IDS.writeServerFile, { path, text, version });

export const locateAddonConfig = (filename: string) =>
    serverBridge.call<AddonConfigLocation>(ACTION_IDS.locateAddonConfig, { filename });
