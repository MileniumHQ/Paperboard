import { BUILTIN_PANEL_ID, type BuiltinDef } from "./types";

export const audioBuiltins: BuiltinDef[] = [
    { id: "set-volume", category: "computer.audio", panelId: BUILTIN_PANEL_ID, item: {
                    panelId: BUILTIN_PANEL_ID,
                    action: "set-volume",
                    schema: {
                        id: "set-volume",
                        name: "Set Volume",
                        description: "Adjusts system master volume (0 - 100%)",
                        template: "Set volume to {volume}%",
                        icon: "volume_up",
                        inputs: {
                            volume: {
                                type: "number",
                                label: "Percent",
                                placeholder: "Percent",
                                default: 50,
                                required: true,
                            },
                        },
                    },
                } },
    { id: "mute-audio", category: "computer.audio", panelId: BUILTIN_PANEL_ID, item: {
                    panelId: BUILTIN_PANEL_ID,
                    action: "mute-audio",
                    schema: {
                        id: "mute-audio",
                        name: "Mute Audio",
                        description: "Sets audio mute state",
                        template: "Mute system audio: {muted}",
                        icon: "volume_off",
                        inputs: {
                            muted: {
                                type: "boolean",
                                label: "Mute",
                                default: true,
                            },
                        },
                    },
                } },
];
