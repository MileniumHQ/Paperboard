import type { BuiltinDef } from "./types";

export const dataBuiltins: BuiltinDef[] = [
    { id: "json-parse", category: "logic.data", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "json-parse",
                    schema: {
                        id: "json-parse",
                        name: "Parse JSON",
                        description: "Turns JSON text into a value other steps can read",
                        template: "Parse JSON {text}",
                        icon: "data_object",
                        inputs: {
                            text: {
                                type: "string",
                                label: "JSON",
                                placeholder: "JSON",
                                required: true,
                            },
                        },
                        output: {
                            type: "object",
                            label: "Value",
                        },
                    },
                } },
    { id: "json-stringify", category: "logic.data", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "json-stringify",
                    schema: {
                        id: "json-stringify",
                        name: "Stringify JSON",
                        description: "Turns a value into JSON text",
                        template: "Stringify JSON {value}",
                        icon: "code_blocks",
                        inputs: {
                            value: {
                                type: "any",
                                label: "Value",
                                placeholder: "Value",
                                required: true,
                            },
                            pretty: {
                                type: "boolean",
                                label: "Pretty Print",
                                default: true,
                            },
                        },
                        output: {
                            type: "string",
                            label: "JSON",
                        },
                    },
                } },
    { id: "get-field", category: "logic.data", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "get-field",
                    schema: {
                        id: "get-field",
                        name: "Get Field",
                        description: "Reads one field by path (a.b.0.c) from an object or list",
                        template: "Get field {path} of {value}",
                        icon: "label",
                        inputs: {
                            value: {
                                type: "any",
                                label: "Value",
                                placeholder: "Value",
                                required: true,
                            },
                            path: {
                                type: "string",
                                label: "Field Path",
                                placeholder: "Field Path",
                                required: true,
                            },
                        },
                        output: {
                            type: "any",
                            label: "Field",
                        },
                    },
                } },
    { id: "list-length", category: "logic.data", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "list-length",
                    schema: {
                        id: "list-length",
                        name: "List Length",
                        description: "Number of items in a list, characters in text, or keys in an object",
                        template: "Length of {list}",
                        icon: "format_list_numbered",
                        inputs: {
                            list: {
                                type: "array",
                                label: "List",
                                placeholder: "List",
                                required: true,
                            },
                        },
                        output: {
                            type: "number",
                            label: "Length",
                        },
                    },
                } },
    { id: "pick-from-list", category: "logic.data", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "pick-from-list",
                    schema: {
                        id: "pick-from-list",
                        name: "Pick from List",
                        description: "Item at an index; negative indexes count from the end",
                        template: "Pick item {index} from {list}",
                        icon: "format_list_bulleted",
                        inputs: {
                            list: {
                                type: "array",
                                label: "List",
                                placeholder: "List",
                                required: true,
                            },
                            index: {
                                type: "number",
                                label: "Index",
                                placeholder: "Index",
                                default: 0,
                                required: true,
                            },
                        },
                        output: {
                            type: "any",
                            label: "Item",
                        },
                    },
                } },
];
