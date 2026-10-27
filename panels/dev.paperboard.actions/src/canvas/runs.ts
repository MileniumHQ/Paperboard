// Running flows from the editor: test runs, Play, and which blocks are
// running right now, as the service reports its flow steps.
import { createSignal, onCleanup, onMount } from "solid-js";
import { actions as actionsApi } from "@mileniumhq/paperapi";
import { ACTIONS_PANEL_ID } from "../panelId";
import type { CanvasBlock } from "../lib/tree";
import type { CanvasDocumentState } from "./document";
import type { ConsoleLog } from "./Console";

export function createFlowRuns(doc: CanvasDocumentState, log: ConsoleLog) {
    const [runningBlockIds, setRunningBlockIds] = createSignal<Set<string>>(new Set());

    const setBlockRunning = (id: string, isRunning: boolean) => {
        setRunningBlockIds((prev) => {
            const next = new Set(prev);
            if (isRunning) next.add(id);
            else next.delete(id);
            return next;
        });
    };

    const testRun = async (triggerBlock: CanvasBlock, payload: any) => {
        try {
            const synced = await doc.flush();
            if (!synced.ok) throw new Error(synced.message);
            const result = await actionsApi.call<any>(
                ACTIONS_PANEL_ID,
                "test-run-flow",
                { triggerBlockId: triggerBlock.id, payload: payload || {} },
            );
            // only failures reach the console; a clean run shows nothing and
            // the flow's own Log to Console actions speak for themselves.
            // An error status with no message still announces itself: a
            // failed run that logs nothing is silent success.
            if (result?.status === "error") {
                log.error(result.message || `Flow failed (status: ${result.status})`);
            }
        } catch (err: any) {
            log.error(err?.message || String(err ?? "Flow run failed"));
        }
    };

    const playAll = () => {
        // only on-play triggers run here — silently running OTHER triggers
        // as a stand-in would be a surprising side effect, not a fallback
        const onPlay = doc.blocks.filter((b) => b.isTrigger && b.action?.id === "on-play");
        if (onPlay.length === 0) {
            log.append({
                time: new Date().toLocaleTimeString(),
                message: "No on-play flows on the canvas. Nothing ran (play button only runs on-play triggers).",
            });
            return;
        }
        for (const b of onPlay) {
            void testRun(b, {});
        }
    };

    onMount(() => {
        // internal flow-state triggers belong to THIS panel: explicit
        // two-arg subscriptions (each filters its own trigger name) —
        // no wildcard; cross-panel flows live in the service's trigger
        // subscriptions instead
        const handler = (output: any, data: any) => {
            if (!data) return;
            if (data.trigger === "flow-step" && output?.blockId) {
                setBlockRunning(output.blockId, output.status === "start");
                return;
            }
            if (data.trigger === "flow-start" && output?.triggerBlockId) {
                setBlockRunning(output.triggerBlockId, true);
                return;
            }
            if (data.trigger === "flow-end" && output?.triggerBlockId) {
                setBlockRunning(output.triggerBlockId, false);
                return;
            }
            if (data.trigger === "flow-log" && output) {
                log.append({
                    time: output.time || new Date().toLocaleTimeString(),
                    message: String(output.message ?? ""),
                    level: output.status === "error" ? "error" : undefined,
                });
            }
        };
        const unsubs = (["flow-step", "flow-start", "flow-end", "flow-log"] as const).map(
            (trigger) => actionsApi.onTrigger(trigger, handler),
        );
        onCleanup(() => {
            for (const unsub of unsubs) unsub();
        });
    });

    return { runningBlockIds, testRun, playAll };
}
