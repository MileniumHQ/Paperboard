import type { BuiltinDef } from "./types";

export const conditionBuiltins: BuiltinDef[] = [
    { id: "logic-not", category: "logic.condition", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "logic-not",
                    schema: {
                        id: "logic-not",
                        name: "Not",
                        description: "Inverts a true/false value",
                        template: "Not {value}",
                        icon: "block",
                        inputs: {
                            value: {
                                type: "boolean",
                                label: "Value",
                                placeholder: "Value",
                                required: true,
                            },
                        },
                        output: {
                            type: "boolean",
                            label: "Inverted",
                        },
                    },
                } },
    { id: "is-empty", category: "logic.condition", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "is-empty",
                    schema: {
                        id: "is-empty",
                        name: "Is Empty",
                        description: "Checks whether text is empty or blank",
                        template: "Check if {text} is empty",
                        icon: "hourglass_empty",
                        inputs: {
                            text: {
                                type: "string",
                                label: "Text",
                                placeholder: "Text",
                                required: true,
                            },
                        },
                        output: {
                            type: "boolean",
                            label: "Is Empty",
                        },
                    },
                } },
    { id: "coalesce", category: "logic.condition", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "coalesce",
                    schema: {
                        id: "coalesce",
                        name: "First Value",
                        description: "Returns the first input that is not empty",
                        template: "First of {first} and {second}",
                        icon: "merge",
                        inputs: {
                            first: {
                                type: "string",
                                label: "First",
                                placeholder: "First",
                                required: true,
                            },
                            second: {
                                type: "string",
                                label: "Second",
                                placeholder: "Second",
                                required: true,
                            },
                        },
                        output: {
                            type: "string",
                            label: "First Value",
                        },
                    },
                } },
];
