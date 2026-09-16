import type { BuiltinDef } from "./types";

// The schema for one Switch arm. Case blocks are created by the Switch
// block's own "Add Case" button, never dragged from the library, so this
// schema is exported but stays out of BUILTIN_DEFS.
export const SWITCH_CASE_SCHEMA = {
    id: "switch-case",
    name: "Case",
    description: "One match arm of a Switch",
    template: "Case {value}",
    icon: "call_split",
    inputs: {
        value: {
            type: "string",
            label: "Value",
            placeholder: "Value",
            required: true,
        },
    },
} as const;

export const controlBuiltins: BuiltinDef[] = [
    { id: "repeat", category: "logic.control", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "repeat",
                    schema: {
                        id: "repeat",
                        name: "Repeat",
                        description: "Repeats nested actions a set number of times",
                        template: "Repeat {count} times",
                        icon: "repeat",
                        inputs: {
                            count: {
                                type: "number",
                                label: "Count",
                                placeholder: "Count",
                                default: 5,
                                required: true,
                            },
                        },
                    },
                } },
    { id: "if", category: "logic.control", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "if",
                    schema: {
                        id: "if",
                        name: "If",
                        description: "Conditionally executes actions if the condition is met",
                        template: "if {left} {operator} {right}",
                        icon: "alt_route",
                        inputs: {
                            left: {
                                type: "string",
                                label: "Value",
                                placeholder: "Value",
                                required: true,
                            },
                            operator: {
                                type: "select",
                                label: "Operator",
                                default: "==",
                                options: [
                                    { label: "is equal to", value: "==" },
                                    { label: "is not equal to", value: "!=" },
                                    { label: "greater than", value: ">" },
                                    { label: "less than", value: "<" },
                                    { label: "includes", value: "includes" },
                                    { label: "starts with", value: "starts-with" },
                                    { label: "ends with", value: "ends-with" },
                                    { label: "is true", value: "is-true" },
                                    { label: "is false", value: "is-false" },
                                ],
                            },
                            right: {
                                type: "string",
                                label: "Value",
                                placeholder: "Value",
                                default: "",
                            },
                        },
                    },
                } },
    { id: "if-else", category: "logic.control", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "if-else",
                    schema: {
                        id: "if-else",
                        name: "If Else",
                        description: "Executes actions if condition is met, otherwise executes else actions",
                        template: "if {left} {operator} {right}",
                        icon: "alt_route",
                        inputs: {
                            left: {
                                type: "string",
                                label: "Value",
                                placeholder: "Value",
                                required: true,
                            },
                            operator: {
                                type: "select",
                                label: "Operator",
                                default: "==",
                                options: [
                                    { label: "is equal to", value: "==" },
                                    { label: "is not equal to", value: "!=" },
                                    { label: "greater than", value: ">" },
                                    { label: "less than", value: "<" },
                                    { label: "includes", value: "includes" },
                                    { label: "starts with", value: "starts-with" },
                                    { label: "ends with", value: "ends-with" },
                                    { label: "is true", value: "is-true" },
                                    { label: "is false", value: "is-false" },
                                ],
                            },
                            right: {
                                type: "string",
                                label: "Value",
                                placeholder: "Value",
                                default: "",
                            },
                        },
                    },
                } },    { id: "for-each", category: "logic.control", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "for-each",
                    schema: {
                        id: "for-each",
                        name: "For Each",
                        description: "Runs nested actions once per item in a list; the current item is this block's output",
                        template: "For each item in {list}",
                        icon: "repeat_on",
                        inputs: {
                            list: {
                                type: "array",
                                label: "List",
                                placeholder: "List",
                                required: true,
                            },
                        },
                        output: {
                            type: "any",
                            label: "Item",
                        },
                    },
                } },
    { id: "break", category: "logic.control", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "break",
                    schema: {
                        id: "break",
                        name: "Break",
                        description: "Stops the nearest Repeat or For Each loop immediately",
                        template: "Break out of loop",
                        icon: "logout",
                    },
                } },
    { id: "continue", category: "logic.control", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "continue",
                    schema: {
                        id: "continue",
                        name: "Continue",
                        description: "Skips to the next iteration of the nearest loop",
                        template: "Skip to next iteration",
                        icon: "skip_next",
                    },
                } },
    { id: "switch", category: "logic.control", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "switch",
                    schema: {
                        id: "switch",
                        name: "Switch",
                        description: "Runs the matching Case's actions, or the otherwise branch when none match",
                        template: "Switch on {value}",
                        icon: "call_split",
                        inputs: {
                            value: {
                                type: "string",
                                label: "Value",
                                placeholder: "Value",
                                required: true,
                            },
                        },
                    },
                } },
];