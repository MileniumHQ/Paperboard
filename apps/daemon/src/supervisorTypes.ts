import type { INPUT_ENCODINGS } from "@mileniumhq/paperapi/protocol";

// how a workload's input is encoded on its way in
export type InputEncoding = (typeof INPUT_ENCODINGS)[number];

// client surface shared by both supervisor runtimes
export interface PaperCraneClientLike {
    id: string;
    pid: number;
    childPid: number;
    isPty: boolean;
    isConnected(): boolean;
    on(event: string, cb: Function): unknown;
    connect(): Promise<boolean>;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(signal?: string): void;
    destroy(): void;
}
