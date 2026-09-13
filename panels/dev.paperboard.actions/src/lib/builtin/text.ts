import type { BuiltinDef } from "./types";

export const textBuiltins: BuiltinDef[] = [
    { id: "text", category: "logic.text", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "text",
                    schema: {
                        id: "text",
                        name: "Text",
                        description: "Multiline text value",
                        template: "Text {value}",
                        icon: "notes",
                        inputs: {
                            value: {
                                type: "string",
                                label: "Value",
                                placeholder: "Text",
                                multiline: true,
                                required: true,
                            },
                        },
                        output: {
                            type: "string",
                            label: "Text",
                        },
                    },
                } },
    { id: "text-join", category: "logic.text", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "text-join",
                    schema: {
                        id: "text-join",
                        name: "Join Text",
                        description: "Combines two text strings together",
                        template: "Join {text1} and {text2}",
                        icon: "join",
                        inputs: {
                            text1: {
                                type: "string",
                                label: "Text 1",
                                placeholder: "Text 1",
                                required: true,
                            },
                            text2: {
                                type: "string",
                                label: "Text 2",
                                placeholder: "Text 2",
                                required: true,
                            },
                        },
                        output: {
                            type: "string",
                            label: "Joined Text",
                        },
                    },
                } },
    { id: "text-length", category: "logic.text", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "text-length",
                    schema: {
                        id: "text-length",
                        name: "Text Length",
                        description: "Returns character length of a text string",
                        template: "Length of {text}",
                        icon: "straighten",
                        inputs: {
                            text: {
                                type: "string",
                                label: "Text",
                                placeholder: "Text",
                                required: true,
                            },
                        },
                        output: {
                            type: "number",
                            label: "Text Length",
                        },
                    },
                } },
    { id: "text-uppercase", category: "logic.text", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "text-uppercase",
                    schema: {
                        id: "text-uppercase",
                        name: "To Uppercase",
                        description: "Converts text to uppercase",
                        template: "Convert {text} to uppercase",
                        icon: "text_fields",
                        inputs: {
                            text: {
                                type: "string",
                                label: "Text",
                                placeholder: "Text",
                                required: true,
                            },
                        },
                        output: {
                            type: "string",
                            label: "Uppercase Text",
                        },
                    },
                } },
    { id: "text-lowercase", category: "logic.text", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "text-lowercase",
                    schema: {
                        id: "text-lowercase",
                        name: "To Lowercase",
                        description: "Converts text to lowercase",
                        template: "Convert {text} to lowercase",
                        icon: "text_format",
                        inputs: {
                            text: {
                                type: "string",
                                label: "Text",
                                placeholder: "Text",
                                required: true,
                            },
                        },
                        output: {
                            type: "string",
                            label: "Lowercase Text",
                        },
                    },
                } },
    { id: "text-replace", category: "logic.text", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "text-replace",
                    schema: {
                        id: "text-replace",
                        name: "Replace Text",
                        description: "Replaces every occurrence of one string with another",
                        template: "Replace {find} with {replacement} in {text}",
                        icon: "find_replace",
                        inputs: {
                            text: {
                                type: "string",
                                label: "Text",
                                placeholder: "Text",
                                required: true,
                            },
                            find: {
                                type: "string",
                                label: "Find",
                                placeholder: "Find",
                                required: true,
                            },
                            replacement: {
                                type: "string",
                                label: "Replacement",
                                placeholder: "Replacement",
                                required: true,
                            },
                        },
                        output: {
                            type: "string",
                            label: "Replaced Text",
                        },
                    },
                } },
    { id: "text-trim", category: "logic.text", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "text-trim",
                    schema: {
                        id: "text-trim",
                        name: "Trim Text",
                        description: "Removes whitespace from both ends of a string",
                        template: "Trim {text}",
                        icon: "format_clear",
                        inputs: {
                            text: {
                                type: "string",
                                label: "Text",
                                placeholder: "Text",
                                required: true,
                            },
                        },
                        output: {
                            type: "string",
                            label: "Trimmed Text",
                        },
                    },
                } },
    { id: "text-contains", category: "logic.text", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "text-contains",
                    schema: {
                        id: "text-contains",
                        name: "Text Contains",
                        description: "Checks whether text contains a substring",
                        template: "Check if {text} contains {substring}",
                        icon: "search",
                        inputs: {
                            text: {
                                type: "string",
                                label: "Text",
                                placeholder: "Text",
                                required: true,
                            },
                            substring: {
                                type: "string",
                                label: "Substring",
                                placeholder: "Substring",
                                required: true,
                            },
                        },
                        output: {
                            type: "boolean",
                            label: "Contains",
                        },
                    },
                } },
    { id: "text-starts-with", category: "logic.text", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "text-starts-with",
                    schema: {
                        id: "text-starts-with",
                        name: "Text Starts With",
                        description: "Checks whether text starts with a prefix",
                        template: "Check if {text} starts with {prefix}",
                        icon: "arrow_forward",
                        inputs: {
                            text: {
                                type: "string",
                                label: "Text",
                                placeholder: "Text",
                                required: true,
                            },
                            prefix: {
                                type: "string",
                                label: "Prefix",
                                placeholder: "Prefix",
                                required: true,
                            },
                        },
                        output: {
                            type: "boolean",
                            label: "Starts With",
                        },
                    },
                } },
    { id: "text-ends-with", category: "logic.text", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "text-ends-with",
                    schema: {
                        id: "text-ends-with",
                        name: "Text Ends With",
                        description: "Checks whether text ends with a suffix",
                        template: "Check if {text} ends with {suffix}",
                        icon: "arrow_back",
                        inputs: {
                            text: {
                                type: "string",
                                label: "Text",
                                placeholder: "Text",
                                required: true,
                            },
                            suffix: {
                                type: "string",
                                label: "Suffix",
                                placeholder: "Suffix",
                                required: true,
                            },
                        },
                        output: {
                            type: "boolean",
                            label: "Ends With",
                        },
                    },
                } },
    { id: "text-slice", category: "logic.text", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "text-slice",
                    schema: {
                        id: "text-slice",
                        name: "Slice Text",
                        description: "Extracts a section of a string by position",
                        template: "Slice {text} from {start}",
                        icon: "content_cut",
                        inputs: {
                            text: {
                                type: "string",
                                label: "Text",
                                placeholder: "Text",
                                required: true,
                            },
                            start: {
                                type: "number",
                                label: "Start",
                                placeholder: "Start",
                                required: true,
                            },
                            end: {
                                type: "number",
                                label: "End",
                                placeholder: "End",
                            },
                        },
                        output: {
                            type: "string",
                            label: "Sliced Text",
                        },
                    },
                } },
];
