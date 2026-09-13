import type { ActionInfo, TriggerInfo } from "@paperboard-dev/paperapi";


// reserved synthetic panel id for core-provided actions
const BUILTIN_PANEL_ID = "builtin.computer";

export interface BuiltinCategory {
    id: string;
    domain: "logic" | "computer";
    name: string;
    icon: string;
    iconUrl?: string;
    description: string;
    items: (ActionInfo | TriggerInfo)[];
}

export interface BuiltinDef {
    /** Stable builtin id (action id or trigger id). */
    id: string;
    /** Owning category id (e.g. "logic.text", "computer.system"). */
    category: string;
    /** Panel that serves this builtin. */
    panelId: string;
    /** Registry item as consumed by the library UI. */
    item: ActionInfo | TriggerInfo;
}

export const BUILTIN_CATEGORY_META: Omit<BuiltinCategory, "items">[] = [
    { id: "logic.timing", domain: "logic", name: "Timing", icon: "timer", description: "Delays, pauses, and flow control" },
    { id: "logic.control", domain: "logic", name: "Control", icon: "alt_route", description: "Conditional branching and iteration" },
    { id: "logic.variables", domain: "logic", name: "Variables", icon: "data_object", description: "Store, update, and manage state across steps" },
    { id: "logic.math", domain: "logic", name: "Operators", icon: "calculate", description: "Math and numeric calculations" },
    { id: "logic.condition", domain: "logic", name: "Condition", icon: "rule", description: "Boolean checks and fallbacks" },
    { id: "logic.datetime", domain: "logic", name: "Date & Time", icon: "schedule", description: "Timestamps, formatting, and date math" },
    { id: "logic.web", domain: "logic", name: "Web", icon: "language", description: "HTTP requests and web content" },
    { id: "logic.text", domain: "logic", name: "Text", icon: "format_quote", description: "Text operations and string formatting" },
    { id: "logic.utility", domain: "logic", name: "Utility", icon: "build", description: "Logging and utility operations" },
    { id: "computer.display", domain: "computer", name: "Display", icon: "desktop_windows", description: "Screen capture controls" },
    { id: "computer.audio", domain: "computer", name: "Audio", icon: "volume_up", description: "System volume and muting controls" },
    { id: "computer.system", domain: "computer", name: "System", icon: "settings_suggest", description: "Notifications and system controls" },
];

/** Single source of truth for every builtin trigger/action. */
export const BUILTIN_DEFS: BuiltinDef[] = [
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
                } },
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
                } },
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
                                label: "Variable Name",
                                placeholder: "Variable Name",
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
                        icon: "add_circle_outline",
                        inputs: {
                            key: {
                                type: "string",
                                label: "Variable Name",
                                placeholder: "Variable Name",
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
                                label: "Variable Name",
                                placeholder: "Variable Name",
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
                                label: "Variable Name",
                                placeholder: "Variable Name",
                                required: true,
                            },
                        },
                        output: {
                            type: "string",
                            label: "Variable Value",
                        },
                    },
                } },
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
                        icon: "plus_one",
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
                } },
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
    { id: "log-console", category: "logic.utility", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "log-console",
                    schema: {
                        id: "log-console",
                        name: "Log Message",
                        description: "Outputs a message to the actions execution console",
                        template: "Log {message} to console",
                        icon: "terminal",
                        inputs: {
                            message: {
                                type: "string",
                                label: "Message",
                                placeholder: "Message",
                                required: true,
                            },
                        },
                        output: {
                            type: "string",
                            label: "Logged Message",
                        },
                    },
                } },
    { id: "play-beep", category: "logic.utility", panelId: "builtin.logic", item: {
                    panelId: "builtin.logic",
                    action: "play-beep",
                    schema: {
                        id: "play-beep",
                        name: "Play Alert Beep",
                        description: "Plays an OS chime on the host computer",
                        template: "Play alert sound",
                        icon: "notifications",
                    },
                } },
    { id: "take-screenshot", category: "computer.display", panelId: BUILTIN_PANEL_ID, item: {
                    panelId: BUILTIN_PANEL_ID,
                    action: "take-screenshot",
                    schema: {
                        id: "take-screenshot",
                        name: "Take Screenshot",
                        description: "Captures the screen to an image file",
                        template: "Take screenshot to {savePath}",
                        icon: "screenshot_monitor",
                        inputs: {
                            savePath: {
                                type: "string",
                                label: "File Path",
                                placeholder: "File Path",
                                default: "screenshot.png",
                                required: true,
                            },
                        },
                        output: {
                            type: "string",
                            label: "Image File Path",
                        },
                    },
                } },
    { id: "set-volume", category: "computer.audio", panelId: BUILTIN_PANEL_ID, item: {
                    panelId: BUILTIN_PANEL_ID,
                    action: "set-volume",
                    schema: {
                        id: "set-volume",
                        name: "Set Volume",
                        description: "Adjusts system master volume (0 - 100%)",
                        template: "Set volume to {volume}%",
                        icon: "volume_up",
                        inputs: {
                            volume: {
                                type: "number",
                                label: "Percent",
                                placeholder: "Percent",
                                default: 50,
                                required: true,
                            },
                        },
                    },
                } },
    { id: "mute-audio", category: "computer.audio", panelId: BUILTIN_PANEL_ID, item: {
                    panelId: BUILTIN_PANEL_ID,
                    action: "mute-audio",
                    schema: {
                        id: "mute-audio",
                        name: "Mute Audio",
                        description: "Sets audio mute state",
                        template: "Mute system audio: {muted}",
                        icon: "volume_off",
                        inputs: {
                            muted: {
                                type: "boolean",
                                label: "Mute",
                                default: true,
                            },
                        },
                    },
                } },
    { id: "send-notification", category: "computer.system", panelId: BUILTIN_PANEL_ID, item: {
                    panelId: BUILTIN_PANEL_ID,
                    action: "send-notification",
                    schema: {
                        id: "send-notification",
                        name: "Send Notification",
                        description: "Displays a desktop notification with title and message",
                        template: "Show notification {title}: {message}",
                        icon: "notifications_active",
                        inputs: {
                            title: {
                                type: "string",
                                label: "Title",
                                placeholder: "Title",
                                default: "Paperboard",
                                required: true,
                            },
                            message: {
                                type: "string",
                                label: "Message",
                                placeholder: "Message",
                                required: true,
                            },
                        },
                    },
                } },
    { id: "lock-screen", category: "computer.system", panelId: BUILTIN_PANEL_ID, item: {
                    panelId: BUILTIN_PANEL_ID,
                    action: "lock-screen",
                    schema: {
                        id: "lock-screen",
                        name: "Lock Screen",
                        description: "Immediately locks the user session",
                        template: "Lock computer screen",
                        icon: "lock",
                    },
                } },

    {
        id: "run-command",
        category: "computer.system",
        panelId: BUILTIN_PANEL_ID,
        item: {
            panelId: BUILTIN_PANEL_ID,
            action: "run-command",
            schema: {
                id: "run-command",
                name: "Run Command",
                description: "Runs a shell command on the host computer",
                template: "Run command {command}",
                icon: "terminal",
                inputs: {
                    command: {
                        type: "string",
                        label: "Command",
                        placeholder: "Command",
                        required: true,
                    },
                },
                output: {
                    type: "string",
                    label: "Command Output",
                },
            },
        },
    },
];

export const BUILTIN_CATEGORIES: BuiltinCategory[] = BUILTIN_CATEGORY_META.map((meta) => ({
    ...meta,
    items: BUILTIN_DEFS.filter((d) => d.category === meta.id).map((d) => d.item),
}));
