import { expect, test } from "bun:test";
import { ACTION_IDS, TRIGGER_IDS } from "../src/service/contract";
import {
    gameruleNameOptions,
    panelActions,
    panelEventActions,
    setActiveWorldAction,
    setGameruleAction,
} from "../src/service/actions";

// set-active-world and set-game-rule are registered by
// republishDynamicActions: their dropdown options come from live state
// (worlds on disk, the installed version), not from the static list
const DYNAMIC_ACTION_IDS = new Set<string>([
    ACTION_IDS.setActiveWorld,
    ACTION_IDS.setGamerule,
]);

test("every defined action id lives in the contract", () => {
    const contractIds = new Set<string>(Object.values(ACTION_IDS));
    for (const action of panelActions) {
        expect(contractIds.has(action.id)).toBe(true);
    }
});

test("every defined event action id lives in the contract", () => {
    const contractIds = new Set<string>(Object.values(TRIGGER_IDS));
    for (const eventAction of panelEventActions) {
        expect(contractIds.has(eventAction.id)).toBe(true);
    }
});

test("contract has no orphan ids the panel never defines", () => {
    const actionIds = new Set(panelActions.map((a) => a.id));
    const eventActionIds = new Set(panelEventActions.map((t) => t.id));
    for (const id of Object.values(ACTION_IDS)) {
        expect(actionIds.has(id) || DYNAMIC_ACTION_IDS.has(id)).toBe(true);
    }
    for (const id of Object.values(TRIGGER_IDS)) {
        expect(eventActionIds.has(id)).toBe(true);
    }
});

test("every action and event action declares a library category", () => {
    // an uncategorized definition silently lands in the General bucket,
    // which reads as a missing tab rather than a missing category
    for (const item of [...panelActions, ...panelEventActions]) {
        expect(typeof (item as any).category).toBe("string");
        expect(String((item as any).category).length).toBeGreaterThan(0);
    }
});

test("world and gamerule actions carry their live dropdown options", () => {
    const worldAction = setActiveWorldAction(["world", "creative"]);
    expect(worldAction.id).toBe(ACTION_IDS.setActiveWorld);
    expect(
        worldAction.inputs?.levelName?.options?.map((o: any) => o.value),
    ).toEqual(["world", "creative"]);

    const ruleAction = setGameruleAction(["keepInventory", "mobGriefing"]);
    expect(ruleAction.id).toBe(ACTION_IDS.setGamerule);
    expect(
        ruleAction.inputs?.name?.options?.map((o: any) => o.value),
    ).toEqual(["keepInventory", "mobGriefing"]);
});

test("gamerule options are filtered to the installed version", () => {
    const modern = gameruleNameOptions("1.21.11").map((o) => o.value);
    const floor = gameruleNameOptions("1.12.2").map((o) => o.value);
    expect(modern.length).toBeGreaterThan(floor.length);
    expect(floor.length).toBeGreaterThan(0);
    expect(floor.every((name) => modern.includes(name))).toBe(true);
});
