// Shared Electron stub for bun test.
//
// mock.module("electron", …) is process-global, so two suites that stub the
// same module share one registration for the whole run. A partial stub in
// one suite bleeds into another suite's transitive imports depending on
// test-file order (which follows filesystem readdir order, not alphabetical),
// and a module that names an export the active stub lacks fails to load.
// One stub with the full surface any module under test imports avoids it.
export function electronStub() {
    return {
        app: {
            getVersion: () => "0.0.0-test",
            relaunch: () => undefined,
            quit: () => undefined,
            requestSingleInstanceLock: () => true,
            whenReady: async () => undefined,
            on: () => undefined,
            off: () => undefined,
        },
        clipboard: { readText: async () => "", writeText: async () => undefined },
        shell: { openPath: async () => "" },
        BrowserWindow: class {},
        Menu: {},
        protocol: {},
        nativeTheme: {
            themeSource: "system",
            shouldUseDarkColors: false,
            on: () => undefined,
        },
        nativeImage: {},
        session: {},
        ipcMain: {
            handle: () => undefined,
            removeHandler: () => undefined,
            on: () => undefined,
        },
        webContents: {},
        webFrameMain: {},
        dialog: {},
    };
}
