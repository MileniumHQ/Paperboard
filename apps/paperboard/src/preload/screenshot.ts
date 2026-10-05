import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("screenshotTool", {
    resize: (width: number, height: number) => ipcRenderer.invoke("screenshot:operation", "resize", width, height),
    save: (scale: number) => ipcRenderer.invoke("screenshot:operation", "save", undefined, undefined, scale),
});
