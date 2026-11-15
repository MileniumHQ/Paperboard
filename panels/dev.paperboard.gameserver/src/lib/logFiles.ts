import { serverCalls } from "./api";

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
    return serverCalls.listLogFiles();
}

export async function readLogFile(name: string): Promise<LogFileContent> {
    return serverCalls.readLogFile({ name });
}
