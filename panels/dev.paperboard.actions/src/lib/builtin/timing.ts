import type { BuiltinDef } from "./types";

export const timingBuiltins: BuiltinDef[] = [
    { id: "on-play", category: "logic.timing", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    trigger: "on-play",
                    schema: {
                        id: "on-play",
                        name: "On Play",
                        description: "Fires when the green play button in the top right is clicked",
                        template: "On play",
                        icon: "play_arrow",
                    },
                } },
    { id: "wait", category: "logic.timing", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "wait",
                    schema: {
                        id: "wait",
                        name: "Wait",
                        description: "Pauses flow execution for a set duration in seconds",
                        template: "Wait {duration} seconds",
                        icon: "timer",
                        inputs: {
                            duration: {
                                type: "number",
                                label: "Seconds",
                                placeholder: "Seconds",
                                default: 1,
                                required: true,
                            },
                        },
                    },
                } },
    { id: "wait-millis", category: "logic.timing", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "wait-millis",
                    schema: {
                        id: "wait-millis",
                        name: "Wait Milliseconds",
                        description: "Pauses flow execution for a set duration in milliseconds",
                        template: "Wait {duration} ms",
                        icon: "hourglass_empty",
                        inputs: {
                            duration: {
                                type: "number",
                                label: "Milliseconds",
                                placeholder: "Milliseconds",
                                default: 500,
                                required: true,
                            },
                        },
                    },
                } },
    { id: "stop-flow", category: "logic.timing", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "stop-flow",
                    schema: {
                        id: "stop-flow",
                        name: "Stop Flow",
                        description: "Immediately halts execution of the current automation",
                        template: "Stop this flow",
                        icon: "stop_circle",
                    },
                } },    { id: "wait-until", category: "logic.timing", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "wait-until",
                    schema: {
                        id: "wait-until",
                        name: "Wait Until",
                        description: "Waits until a flow variable becomes true, and fails loudly when the timeout passes",
                        template: "Wait until {variable} is true",
                        icon: "hourglass_top",
                        inputs: {
                            variable: {
                                type: "string",
                                label: "Variable",
                                placeholder: "Variable",
                                required: true,
                            },
                            timeout: {
                                type: "number",
                                label: "Timeout (seconds)",
                                placeholder: "Timeout (seconds)",
                                default: 30,
                                required: true,
                            },
                        },
                        output: {
                            type: "boolean",
                            label: "Waited",
                        },
                    },
                } },
    { id: "measure-duration", category: "logic.timing", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "measure-duration",
                    schema: {
                        id: "measure-duration",
                        name: "Measure Duration",
                        description: "Milliseconds elapsed since a timestamp (pair with Current Time)",
                        template: "Measure duration since {since}",
                        icon: "timer",
                        inputs: {
                            since: {
                                type: "string",
                                label: "Since",
                                placeholder: "Timestamp",
                                required: true,
                            },
                        },
                        output: {
                            type: "number",
                            label: "Milliseconds",
                        },
                    },
                } },
];