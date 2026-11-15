export interface ProgressPayload {
    downloadId: string;
    stage: string;
    percent: number;
    bytesLoaded?: number;
    bytesTotal?: number;
    message?: string;
}
