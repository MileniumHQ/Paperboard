import { ACTION_IDS as A } from "../service/contract";
import type { GameTab } from "./types";

/** Every game's Automation tab: restart after a crash and the daily restart. */
export const AUTOMATION_TAB: GameTab = { id: "automation", label: "Automation", icon: "schedule", group: "Server", owner: "shared" };
export const AUTOMATION_ACTIONS: readonly string[] = [A.readAutomation, A.writeAutomation];
