import { serverBridge } from "./server";
import { CALLS } from "../service/contract";

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
    return serverBridge.call<LogFileInfo[]>(CALLS.listLogFiles);
}

export async function readLogFile(name: string): Promise<LogFileContent> {
    return serverBridge.call<LogFileContent>(CALLS.readLogFile, { name });
}
