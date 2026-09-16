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
                } },    { id: "text-split", category: "logic.text", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "text-split",
                    schema: {
                        id: "text-split",
                        name: "Split Text",
                        description: "Splits text into a list on a separator (every character when empty)",
                        template: "Split {text} on {separator}",
                        icon: "call_split",
                        inputs: {
                            text: { type: "string", label: "Text", placeholder: "Text", required: true },
                            separator: { type: "string", label: "Separator", placeholder: "Separator" },
                        },
                        output: { type: "array", label: "Items" },
                    },
                } },
    { id: "text-regex-match", category: "logic.text", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "text-regex-match",
                    schema: {
                        id: "text-regex-match",
                        name: "Regex Match",
                        description: "True when the text matches a regular expression",
                        template: "Does {text} match {pattern}",
                        icon: "regular_expression",
                        inputs: {
                            text: { type: "string", label: "Text", placeholder: "Text", required: true },
                            pattern: { type: "string", label: "Pattern", placeholder: "Pattern", required: true },
                        },
                        output: { type: "boolean", label: "Matches" },
                    },
                } },
    { id: "text-regex-extract", category: "logic.text", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "text-regex-extract",
                    schema: {
                        id: "text-regex-extract",
                        name: "Regex Extract",
                        description: "First regex match, or a capture group when Group is set",
                        template: "Extract {pattern} from {text}",
                        icon: "regular_expression",
                        inputs: {
                            text: { type: "string", label: "Text", placeholder: "Text", required: true },
                            pattern: { type: "string", label: "Pattern", placeholder: "Pattern", required: true },
                            group: { type: "number", label: "Capture Group", placeholder: "Capture Group", default: 0 },
                        },
                        output: { type: "string", label: "Match" },
                    },
                } },
    { id: "text-truncate", category: "logic.text", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "text-truncate",
                    schema: {
                        id: "text-truncate",
                        name: "Truncate Text",
                        description: "Shortens text to a length, adding an ellipsis when cut",
                        template: "Truncate {text} to {length}",
                        icon: "content_cut",
                        inputs: {
                            text: { type: "string", label: "Text", placeholder: "Text", required: true },
                            length: { type: "number", label: "Length", placeholder: "Length", default: 80, required: true },
                            ellipsis: { type: "string", label: "Ending", placeholder: "Ending", default: "…" },
                        },
                        output: { type: "string", label: "Text" },
                    },
                } },
    { id: "text-pad", category: "logic.text", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "text-pad",
                    schema: {
                        id: "text-pad",
                        name: "Pad Text",
                        description: "Pads text to a length with a filler character",
                        template: "Pad {text} to {length}",
                        icon: "format_align_left",
                        inputs: {
                            text: { type: "string", label: "Text", placeholder: "Text", required: true },
                            length: { type: "number", label: "Length", placeholder: "Length", default: 8, required: true },
                            side: {
                                type: "select",
                                label: "Side",
                                default: "end",
                                options: [
                                    { label: "End", value: "end" },
                                    { label: "Start", value: "start" },
                                ],
                            },
                            fill: { type: "string", label: "Fill", placeholder: "Fill", default: " " },
                        },
                        output: { type: "string", label: "Text" },
                    },
                } },
    { id: "text-to-number", category: "logic.text", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "text-to-number",
                    schema: {
                        id: "text-to-number",
                        name: "To Number",
                        description: "Reads the first number out of text; refuses when there is none",
                        template: "Number from {text}",
                        icon: "numbers",
                        inputs: {
                            text: { type: "string", label: "Text", placeholder: "Text", required: true },
                        },
                        output: { type: "number", label: "Number" },
                    },
                } },
    { id: "text-base64-encode", category: "logic.text", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "text-base64-encode",
                    schema: {
                        id: "text-base64-encode",
                        name: "Base64 Encode",
                        description: "Encodes text as base64 (UTF-8 safe)",
                        template: "Base64 encode {text}",
                        icon: "lock",
                        inputs: {
                            text: { type: "string", label: "Text", placeholder: "Text", required: true },
                        },
                        output: { type: "string", label: "Base64" },
                    },
                } },
    { id: "text-base64-decode", category: "logic.text", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "text-base64-decode",
                    schema: {
                        id: "text-base64-decode",
                        name: "Base64 Decode",
                        description: "Decodes base64 text back to UTF-8 text",
                        template: "Base64 decode {text}",
                        icon: "lock_open",
                        inputs: {
                            text: { type: "string", label: "Base64", placeholder: "Base64", required: true },
                        },
                        output: { type: "string", label: "Text" },
                    },
                } },
];