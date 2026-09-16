import type { BuiltinDef } from "./types";

export const webBuiltins: BuiltinDef[] = [
    { id: "http-get", category: "logic.web", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "http-get",
                    schema: {
                        id: "http-get",
                        name: "Get URL Content",
                        description: "Fetches text content from a web address",
                        template: "Get content of {url}",
                        icon: "download",
                        inputs: {
                            url: {
                                type: "url",
                                label: "URL",
                                placeholder: "URL",
                                required: true,
                            },
                        },
                        output: {
                            type: "string",
                            label: "Response",
                        },
                    },
                } },
    { id: "http-post", category: "logic.web", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "http-post",
                    schema: {
                        id: "http-post",
                        name: "Post to URL",
                        description: "Sends content to a web address and returns the response",
                        template: "Post {body} to {url}",
                        icon: "upload",
                        inputs: {
                            url: {
                                type: "url",
                                label: "URL",
                                placeholder: "URL",
                                required: true,
                            },
                            body: {
                                type: "string",
                                label: "Body",
                                placeholder: "Body",
                                required: true,
                            },
                            contentType: {
                                type: "string",
                                label: "Content Type",
                                placeholder: "Content Type",
                                default: "application/json",
                            },
                        },
                        output: {
                            type: "string",
                            label: "Response",
                        },
                    },
                } },    { id: "get-url-json", category: "logic.web", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "get-url-json",
                    schema: {
                        id: "get-url-json",
                        name: "Get URL JSON",
                        description: "Fetches a web address and parses the response as JSON",
                        template: "Get JSON from {url}",
                        icon: "data_object",
                        inputs: {
                            url: {
                                type: "url",
                                label: "URL",
                                placeholder: "URL",
                                required: true,
                            },
                        },
                        output: {
                            type: "object",
                            label: "JSON",
                        },
                    },
                } },
];