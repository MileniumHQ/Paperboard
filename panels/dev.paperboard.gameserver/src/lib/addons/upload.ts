import type { fileApi, ServerCalls } from "../api";
import { addonStageDir } from "../../core/addonUpload";
import { PANEL_ID } from "../../service/types";
import type { UploadOutcome } from "../../service/addonUploads";
import type { AddonUploadSource } from "./kind";

// Uploading from disk: the page copies what the user picks into a staging
// folder of the server folder (paperapi's file import), then asks the
// service to check it and add it. The same stage id names both.

export type { UploadOutcome };

export const newStage = () => crypto.randomUUID();

export const stageFolder = (stage: string) => addonStageDir(stage);

/** removes what a pick staged */
export const discardUpload = (calls: ServerCalls) => async (stage: string) => {
    await calls.discardAddonUpload({ stage });
};

export const pickFiles = (files: typeof fileApi, label: string, extensions: string[], icon = "upload_file"): AddonUploadSource => ({
    label,
    icon,
    pick: (dir) => files.importFiles(dir, PANEL_ID, { filters: [{ name: label.replace(/^Upload /, ""), extensions }] }),
});

export const pickFolder = (files: typeof fileApi, label: string): AddonUploadSource => ({
    label,
    icon: "drive_folder_upload",
    pick: (dir) => files.importFolder(dir, PANEL_ID),
});

/** the one .mrpack a modpack upload takes, staged under a name the service expects */
export const pickModpackFile = (files: typeof fileApi, label: string): AddonUploadSource => ({
    label,
    icon: "upload_file",
    pick: (dir) => files.importFile(`${dir}/pack.mrpack`, PANEL_ID, { filters: [{ name: "Modpacks", extensions: ["mrpack"] }] }),
});

export const listAdded = (names: string[]) => (names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`);
