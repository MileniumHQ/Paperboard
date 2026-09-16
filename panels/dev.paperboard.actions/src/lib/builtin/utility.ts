import type { BuiltinDef } from "./types";

export const utilityBuiltins: BuiltinDef[] = [
    { id: "log-console", category: "logic.utility", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "log-console",
                    schema: {
                        id: "log-console",
                        name: "Log Message",
                        description: "Outputs a message to the actions execution console",
                        template: "Log {message} to console",
                        icon: "terminal",
                        inputs: {
                            message: {
                                type: "string",
                                label: "Message",
                                placeholder: "Message",
                                required: true,
                            },
                        },
                        output: {
                            type: "string",
                            label: "Logged Message",
                        },
                    },
                } },
    { id: "play-beep", category: "logic.utility", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "play-beep",
                    schema: {
                        id: "play-beep",
                        name: "Play Alert Beep",
                        description: "Plays an OS chime on the host computer",
                        template: "Play alert sound",
                        icon: "notifications",
                    },
                } },    { id: "throw-error", category: "logic.utility", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "throw-error",
                    schema: {
                        id: "throw-error",
                        name: "Throw Error",
                        description: "Fails the flow on purpose with your message",
                        template: "Throw error {message}",
                        icon: "error",
                        inputs: {
                            message: {
                                type: "string",
                                label: "Message",
                                placeholder: "Message",
                                required: true,
                            },
                        },
                    },
                } },
];