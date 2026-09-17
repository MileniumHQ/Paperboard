import type { ActionInfo } from "@paperboard-dev/paperapi";

// reserved synthetic panel id for core-provided actions
export const BUILTIN_PANEL_ID = "builtin.computer";

export interface BuiltinCategory {
    id: string;
    domain: "logic" | "computer";
    name: string;
    icon: string;
    iconUrl?: string;
    description: string;
    items: ActionInfo[];
}

export interface BuiltinDef {
    /** Stable builtin id (action id or event action id). */
    id: string;
    /** Owning category id (e.g. "logic.text", "computer.system"). */
    category: string;
    /** Panel that serves this builtin. */
    panelId: string;
    /** Registry item as consumed by the library UI. */
    item: ActionInfo;
}

export const BUILTIN_CATEGORY_META: Omit<BuiltinCategory, "items">[] = [
    { id: "logic.timing", domain: "logic", name: "Timing", icon: "timer", description: "Delays, pauses, and flow control" },
    { id: "logic.control", domain: "logic", name: "Control", icon: "alt_route", description: "Conditional branching and iteration" },
    { id: "logic.variables", domain: "logic", name: "Variables", icon: "data_object", description: "Store, update, and manage state across steps" },
    { id: "logic.data", domain: "logic", name: "Data", icon: "database", description: "JSON, fields, and list operations" },
    { id: "logic.math", domain: "logic", name: "Operators", icon: "calculate", description: "Math and numeric calculations" },
    { id: "logic.condition", domain: "logic", name: "Condition", icon: "rule", description: "Boolean checks and fallbacks" },
    { id: "logic.datetime", domain: "logic", name: "Date & Time", icon: "schedule", description: "Timestamps, formatting, and date math" },
    { id: "logic.web", domain: "logic", name: "Web", icon: "language", description: "HTTP requests and web content" },
    { id: "logic.text", domain: "logic", name: "Text", icon: "format_quote", description: "Text operations and string formatting" },
    { id: "logic.utility", domain: "logic", name: "Utility", icon: "build", description: "Logging and utility operations" },
];

// Display, Audio, and System are retired from the library for now. Stored
// flows with those blocks still execute: their runtime handlers in
// lib/runtime.ts are kept until the categories come back.
