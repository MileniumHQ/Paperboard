import { BUILTIN_PANEL_ID, type BuiltinDef } from "./types";

export const displayBuiltins: BuiltinDef[] = [
    { id: "take-screenshot", category: "computer.display", panelId: BUILTIN_PANEL_ID, item: {
                    panelId: BUILTIN_PANEL_ID,
                    action: "take-screenshot",
                    schema: {
                        id: "take-screenshot",
                        name: "Take Screenshot",
                        description: "Captures the screen to an image file",
                        template: "Take screenshot to {savePath}",
                        icon: "screenshot_monitor",
                        inputs: {
                            savePath: {
                                type: "string",
                                label: "File Path",
                                placeholder: "File Path",
                                default: "screenshot.png",
                                required: true,
                            },
                        },
                        output: {
                            type: "string",
                            label: "Image File Path",
                        },
                    },
                } },
];
