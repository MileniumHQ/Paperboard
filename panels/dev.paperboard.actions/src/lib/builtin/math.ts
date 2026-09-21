import type { BuiltinDef } from "./types";

export const mathBuiltins: BuiltinDef[] = [
    { id: "math-calculate", category: "logic.math", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "math-calculate",
                    schema: {
                        id: "math-calculate",
                        name: "Calculate",
                        description: "Evaluates a mathematical expression (e.g. 5 + 10 * 2)",
                        template: "Calculate {expression}",
                        icon: "calculate",
                        inputs: {
                            expression: {
                                type: "string",
                                label: "Expression",
                                placeholder: "Expression",
                                required: true,
                            },
                        },
                        output: {
                            type: "number",
                            label: "Math Result",
                        },
                    },
                } },
    { id: "math-random", category: "logic.math", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "math-random",
                    schema: {
                        id: "math-random",
                        name: "Pick Random",
                        description: "Picks a random whole number between min and max",
                        template: "Pick random between {min} and {max}",
                        icon: "casino",
                        inputs: {
                            min: {
                                type: "number",
                                label: "Min",
                                placeholder: "Min",
                                default: 1,
                                required: true,
                            },
                            max: {
                                type: "number",
                                label: "Max",
                                placeholder: "Max",
                                default: 10,
                                required: true,
                            },
                        },
                        output: {
                            type: "number",
                            label: "Random Number",
                        },
                    },
                } },
    { id: "math-round", category: "logic.math", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "math-round",
                    schema: {
                        id: "math-round",
                        name: "Round Number",
                        description: "Rounds a decimal number to the nearest integer",
                        template: "Round {number}",
                        icon: "exposure",
                        inputs: {
                            number: {
                                type: "number",
                                label: "Number",
                                placeholder: "Number",
                                required: true,
                            },
                        },
                        output: {
                            type: "number",
                            label: "Rounded Number",
                        },
                    },
                } },
    { id: "math-clamp", category: "logic.math", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "math-clamp",
                    schema: {
                        id: "math-clamp",
                        name: "Clamp Number",
                        description: "Constrains a number between a minimum and maximum",
                        template: "Clamp {value} between {min} and {max}",
                        icon: "unfold_less",
                        inputs: {
                            value: {
                                type: "number",
                                label: "Value",
                                placeholder: "Value",
                                required: true,
                            },
                            min: {
                                type: "number",
                                label: "Minimum",
                                placeholder: "Minimum",
                                required: true,
                            },
                            max: {
                                type: "number",
                                label: "Maximum",
                                placeholder: "Maximum",
                                required: true,
                            },
                        },
                        output: {
                            type: "number",
                            label: "Clamped Number",
                        },
                    },
                } },
    { id: "math-min", category: "logic.math", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "math-min",
                    schema: {
                        id: "math-min",
                        name: "Smaller Number",
                        description: "Returns the smaller of two numbers",
                        template: "Smaller of {a} and {b}",
                        icon: "arrow_downward",
                        inputs: {
                            a: {
                                type: "number",
                                label: "First",
                                placeholder: "First",
                                required: true,
                            },
                            b: {
                                type: "number",
                                label: "Second",
                                placeholder: "Second",
                                required: true,
                            },
                        },
                        output: {
                            type: "number",
                            label: "Smaller Number",
                        },
                    },
                } },
    { id: "math-max", category: "logic.math", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "math-max",
                    schema: {
                        id: "math-max",
                        name: "Larger Number",
                        description: "Returns the larger of two numbers",
                        template: "Larger of {a} and {b}",
                        icon: "arrow_upward",
                        inputs: {
                            a: {
                                type: "number",
                                label: "First",
                                placeholder: "First",
                                required: true,
                            },
                            b: {
                                type: "number",
                                label: "Second",
                                placeholder: "Second",
                                required: true,
                            },
                        },
                        output: {
                            type: "number",
                            label: "Larger Number",
                        },
                    },
                } },
    { id: "math-absolute", category: "logic.math", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "math-absolute",
                    schema: {
                        id: "math-absolute",
                        name: "Absolute Value",
                        description: "Returns the distance of a number from zero",
                        template: "Absolute value of {value}",
                        icon: "functions",
                        inputs: {
                            value: {
                                type: "number",
                                label: "Value",
                                placeholder: "Value",
                                required: true,
                            },
                        },
                        output: {
                            type: "number",
                            label: "Absolute Value",
                        },
                    },
                } },
    { id: "math-floor", category: "logic.math", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "math-floor",
                    schema: {
                        id: "math-floor",
                        name: "Round Down",
                        description: "Rounds a number down to the nearest integer",
                        template: "Round down {value}",
                        icon: "vertical_align_bottom",
                        inputs: {
                            value: {
                                type: "number",
                                label: "Value",
                                placeholder: "Value",
                                required: true,
                            },
                        },
                        output: {
                            type: "number",
                            label: "Rounded Down",
                        },
                    },
                } },
    { id: "math-ceiling", category: "logic.math", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "math-ceiling",
                    schema: {
                        id: "math-ceiling",
                        name: "Round Up",
                        description: "Rounds a number up to the nearest integer",
                        template: "Round up {value}",
                        icon: "vertical_align_top",
                        inputs: {
                            value: {
                                type: "number",
                                label: "Value",
                                placeholder: "Value",
                                required: true,
                            },
                        },
                        output: {
                            type: "number",
                            label: "Rounded Up",
                        },
                    },
                } },
    { id: "random-uuid", category: "logic.math", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "random-uuid",
                    schema: {
                        id: "random-uuid",
                        name: "Random ID",
                        description: "Generates a random unique identifier",
                        template: "Generate random ID",
                        writtenOut: "Generate random ID",
                        icon: "fingerprint",
                        inputs: {},
                        output: {
                            type: "string",
                            label: "Random ID",
                        },
                    },
                } },
];
