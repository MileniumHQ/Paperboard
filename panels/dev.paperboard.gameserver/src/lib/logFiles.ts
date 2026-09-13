import { serverBridge } from "./server";
import { ACTION_IDS } from "../service/contract";

export interface LogFileInfo {
    name: string;
    size: number;
    mtimeMs: number;
}

export interface LogFileContent {
    name: string;
    content: string;
    truncated: boolean;
}

export async function listLogFiles(): Promise<LogFileInfo[]> {
    return serverBridge.call<LogFileInfo[]>(ACTION_IDS.listLogFiles);
}

export async function readLogFile(name: string): Promise<LogFileContent> {
    return serverBridge.call<LogFileContent>(ACTION_IDS.readLogFile, { name });
}
