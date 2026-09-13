import { expect, test } from "bun:test";
import { ACTION_IDS, TRIGGER_IDS } from "../src/service/contract";
import { panelActions, panelTriggers } from "../src/service/actions";

test("every defined action id lives in the contract", () => {
    const contractIds = new Set<string>(Object.values(ACTION_IDS));
    for (const action of panelActions) {
        expect(contractIds.has(action.id)).toBe(true);
    }
});

test("every defined trigger id lives in the contract", () => {
    const contractIds = new Set<string>(Object.values(TRIGGER_IDS));
    for (const trigger of panelTriggers) {
        expect(contractIds.has(trigger.id)).toBe(true);
    }
});

test("contract has no orphan ids the panel never defines", () => {
    const actionIds = new Set(panelActions.map((a) => a.id));
    const triggerIds = new Set(panelTriggers.map((t) => t.id));
    for (const id of Object.values(ACTION_IDS)) {
        expect(actionIds.has(id)).toBe(true);
    }
    for (const id of Object.values(TRIGGER_IDS)) {
        expect(triggerIds.has(id)).toBe(true);
    }
});
