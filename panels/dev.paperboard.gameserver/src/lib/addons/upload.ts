import { fileApi } from "../api";
import { addonStageDir } from "../../core/addonUpload";
import { serverBridge } from "../server";
import { ACTION_IDS } from "../../service/contract";
import { PANEL_ID } from "../../service/types";
import type { UploadOutcome } from "../../service/addonUploads";
import type { AddonUploadSource } from "./kind";

// Uploading from disk: the page copies what the user picks into a staging
// folder of the server folder (paperapi's file import), then asks the
// service to check it and add it. The same stage id names both.

export type { UploadOutcome };

export const newStage = () => crypto.randomUUID();

export const stageFolder = (stage: string) => addonStageDir(stage);

export const discardUpload = async (stage: string) => {
    await serverBridge.call(ACTION_IDS.discardAddonUpload, { stage });
};

export const commitPlugins = (stage: string) => serverBridge.call<UploadOutcome>(ACTION_IDS.uploadPlugins, { stage });

export const commitDatapacks = (stage: string) => serverBridge.call<UploadOutcome>(ACTION_IDS.uploadDatapacks, { stage });

// reading, downloading and placing a pack runs for minutes: the call is
// waited out, not cut off at the bridge's 30 s default
export const commitModpack = (stage: string) =>
    serverBridge.call(ACTION_IDS.uploadModpack, { stage }, { timeoutMs: null });

export const pickFiles = (label: string, extensions: string[], icon = "upload_file"): AddonUploadSource => ({
    label,
    icon,
    pick: (dir) => fileApi.importFiles(dir, PANEL_ID, { filters: [{ name: label.replace(/^Upload /, ""), extensions }] }),
});

export const pickFolder = (label: string): AddonUploadSource => ({
    label,
    icon: "drive_folder_upload",
    pick: (dir) => fileApi.importFolder(dir, PANEL_ID),
});

/** the one .mrpack a modpack upload takes, staged under a name the service expects */
export const pickModpackFile = (label: string): AddonUploadSource => ({
    label,
    icon: "upload_file",
    pick: (dir) => fileApi.importFile(`${dir}/pack.mrpack`, PANEL_ID, { filters: [{ name: "Modpacks", extensions: ["mrpack"] }] }),
});

export const listAdded = (names: string[]) => (names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`);
