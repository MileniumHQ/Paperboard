import { BUILTIN_PANEL_ID, type BuiltinDef } from "./types";

export const systemBuiltins: BuiltinDef[] = [
    { id: "send-notification", category: "computer.system", panelId: BUILTIN_PANEL_ID, item: {
                    panelId: BUILTIN_PANEL_ID,
                    action: "send-notification",
                    schema: {
                        id: "send-notification",
                        name: "Send Notification",
                        description: "Displays a desktop notification with title and message",
                        template: "Show notification {title}: {message}",
                        icon: "notifications_active",
                        inputs: {
                            title: {
                                type: "string",
                                label: "Title",
                                placeholder: "Title",
                                default: "Paperboard",
                                required: true,
                            },
                            message: {
                                type: "string",
                                label: "Message",
                                placeholder: "Message",
                                required: true,
                            },
                        },
                    },
                } },
    { id: "lock-screen", category: "computer.system", panelId: BUILTIN_PANEL_ID, item: {
                    panelId: BUILTIN_PANEL_ID,
                    action: "lock-screen",
                    schema: {
                        id: "lock-screen",
                        name: "Lock Screen",
                        description: "Immediately locks the user session",
                        template: "Lock computer screen",
                        icon: "lock",
                    },
                } },

    {
        id: "run-command",
        category: "computer.system",
        panelId: BUILTIN_PANEL_ID,
        item: {
            panelId: BUILTIN_PANEL_ID,
            action: "run-command",
            schema: {
                id: "run-command",
                name: "Run Command",
                description: "Runs a shell command on the host computer",
                template: "Run command {command}",
                icon: "terminal",
                inputs: {
                    command: {
                        type: "string",
                        label: "Command",
                        placeholder: "Command",
                        required: true,
                    },
                },
                output: {
                    type: "string",
                    label: "Command Output",
                },
            },
        },
    },
];
