import type { GameTab } from "./types";
import type { CallName } from "../service/contract";

/** Every game's Automation tab: restart after a crash and the daily restart. */
export const AUTOMATION_TAB: GameTab = { id: "automation", label: "Automation", icon: "schedule", group: "Server", owner: "shared" };
export const AUTOMATION_CALLS: readonly CallName[] = ["readAutomation", "writeAutomation"];
