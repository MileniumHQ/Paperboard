import type { BuiltinDef } from "./types";

export const variablesBuiltins: BuiltinDef[] = [
    { id: "set-variable", category: "logic.variables", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "set-variable",
                    schema: {
                        id: "set-variable",
                        name: "Set Variable",
                        description: "Assigns a value to a named variable",
                        template: "Set variable {key} to {value}",
                        icon: "data_object",
                        inputs: {
                            key: {
                                type: "string",
                                label: "Name",
                                placeholder: "Name",
                                required: true,
                            },
                            value: {
                                type: "string",
                                label: "Value",
                                placeholder: "Value",
                                required: true,
                            },
                        },
                        output: {
                            type: "string",
                            label: "Variable Value",
                        },
                    },
                } },
    { id: "increment-variable", category: "logic.variables", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "increment-variable",
                    schema: {
                        id: "increment-variable",
                        name: "Increment Variable",
                        description: "Increments a numeric variable by an amount",
                        template: "Increment {key} by {amount}",
                        icon: "add_circle",
                        inputs: {
                            key: {
                                type: "string",
                                label: "Name",
                                placeholder: "Name",
                                required: true,
                            },
                            amount: {
                                type: "number",
                                label: "Amount",
                                placeholder: "Amount",
                                default: 1,
                                required: true,
                            },
                        },
                        output: {
                            type: "number",
                            label: "New Value",
                        },
                    },
                } },
    { id: "clear-variable", category: "logic.variables", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "clear-variable",
                    schema: {
                        id: "clear-variable",
                        name: "Clear Variable",
                        description: "Clears or resets a variable value",
                        template: "Clear variable {key}",
                        icon: "delete_sweep",
                        inputs: {
                            key: {
                                type: "string",
                                label: "Name",
                                placeholder: "Name",
                                required: true,
                            },
                        },
                    },
                } },
    { id: "get-variable", category: "logic.variables", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "get-variable",
                    schema: {
                        id: "get-variable",
                        name: "Get Variable",
                        description: "Retrieves the value of a saved variable",
                        template: "Get variable {key}",
                        icon: "data_object",
                        inputs: {
                            key: {
                                type: "string",
                                label: "Name",
                                placeholder: "Name",
                                required: true,
                            },
                        },
                        output: {
                            type: "string",
                            label: "Variable Value",
                        },
                    },
                } },
];
