import type { BuiltinDef } from "./types";

export const datetimeBuiltins: BuiltinDef[] = [
    { id: "now-timestamp", category: "logic.datetime", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "now-timestamp",
                    schema: {
                        id: "now-timestamp",
                        name: "Current Time",
                        description: "Returns the current time in milliseconds",
                        template: "Current timestamp",
                        writtenOut: "Current timestamp",
                        icon: "schedule",
                        inputs: {},
                        output: {
                            type: "number",
                            label: "Timestamp",
                        },
                    },
                } },
    { id: "format-date", category: "logic.datetime", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "format-date",
                    schema: {
                        id: "format-date",
                        name: "Format Date",
                        description: "Formats a timestamp as readable text",
                        template: "Format date {timestamp}",
                        icon: "event",
                        inputs: {
                            timestamp: {
                                type: "number",
                                label: "Timestamp",
                                placeholder: "Timestamp",
                                required: true,
                            },
                        },
                        output: {
                            type: "string",
                            label: "Formatted Date",
                        },
                    },
                } },
    { id: "day-of-week", category: "logic.datetime", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "day-of-week",
                    schema: {
                        id: "day-of-week",
                        name: "Day of Week",
                        description: "Returns the weekday name for a timestamp",
                        template: "Weekday of {timestamp}",
                        icon: "calendar_today",
                        inputs: {
                            timestamp: {
                                type: "number",
                                label: "Timestamp",
                                placeholder: "Timestamp",
                                required: true,
                            },
                        },
                        output: {
                            type: "string",
                            label: "Weekday",
                        },
                    },
                } },
    { id: "add-time", category: "logic.datetime", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "add-time",
                    schema: {
                        id: "add-time",
                        name: "Add Time",
                        description: "Adds an amount of time to a timestamp",
                        template: "Add {amount} {unit} to {timestamp}",
                        icon: "more_time",
                        inputs: {
                            timestamp: {
                                type: "number",
                                label: "Timestamp",
                                placeholder: "Timestamp",
                                required: true,
                            },
                            amount: {
                                type: "number",
                                label: "Amount",
                                placeholder: "Amount",
                                required: true,
                            },
                            unit: {
                                type: "select",
                                label: "Unit",
                                default: "minutes",
                                options: [
                                    { label: "Seconds", value: "seconds" },
                                    { label: "Minutes", value: "minutes" },
                                    { label: "Hours", value: "hours" },
                                    { label: "Days", value: "days" },
                                ],
                            },
                        },
                        output: {
                            type: "number",
                            label: "New Timestamp",
                        },
                    },
                } },
];
