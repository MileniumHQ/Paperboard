export interface IpcRendererLike {
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, listener: (event: any, ...args: any[]) => void): (() => void) | void;
  once?(channel: string, listener: (event: any, ...args: any[]) => void): void;
  removeListener?(channel: string, listener: (...args: any[]) => void): void;
  removeAllListeners?(channel?: string): void;
}

declare global {
  interface Window {
    electron?: {
      ipcRenderer?: IpcRendererLike;
    };
    ipcRenderer?: IpcRendererLike;
  }
}
