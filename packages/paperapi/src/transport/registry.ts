export interface RegisteredAction {
    panelId: string;
    action: string;
    schema?: any;
}

export interface RegisteredTrigger {
    panelId: string;
    trigger: string;
    schema?: any;
}

export type ActionHandler = (...args: any[]) => Promise<any> | any;

import { warnOnce } from "../identity";

export class TransportRegistry {
    // handlers keyed by "panelId:action" (names are owned, no bare-string
    // collisions). registeredBare tracks the single-owner claim on the
    // deprecated bare-name read-through: a bare name belongs to exactly one
    // panel, and a second owner is refused at registration — never
    // overwritten. TODO(remove after v3.1): registeredBare and the bare keys
    // die together with the pre-namespaced read-through
    public readonly actionHandlers = new Map<string, ActionHandler>();
    public readonly registeredActions = new Map<string, RegisteredAction>();
    public readonly registeredTriggers = new Map<string, RegisteredTrigger>();
    private readonly registeredBare = new Map<string, string>();

    constructor(private readonly resolveDefaultPanelId: () => string) {}

    public getHandler(action: string): ActionHandler | undefined {
        return this.actionHandlers.get(action);
    }

    private compositeKey(panelId: string | undefined, actionName: string): string {
        return `${panelId || this.resolveDefaultPanelId()}:${actionName}`;
    }

    public setActionHandler(
        actionName: string,
        handler: ActionHandler,
        panelId?: string,
        schema?: any,
    ): void {
        const pid = panelId || this.resolveDefaultPanelId();
        // bare-name claim is single-owner: a second panel registering the
        // same name is a collision — refuse loudly instead of overwriting.
        const owner = this.registeredBare.get(actionName);
        if (owner !== undefined && owner !== pid) {
            throw new Error(
                `[paperapi] action '${actionName}' is already claimed by panel '${owner}'; cannot register it for panel '${pid}'`,
            );
        }
        this.registeredBare.set(actionName, pid);
        // the bare read-through is deprecated with the pre-namespaced
        // dispatch surface: the loud warning is part of the deprecation
        // (marker + deadline in the TODO below), same discipline as the
        // wildcard matching in actions.ts
        // (TODO(remove after v3.1): registeredBare and the bare keys die
        // together with the read-through)
        warnOnce(
            "paperapi:bare-action-readthrough",
            `[paperapi] action '${actionName}' registered as a bare name by panel '${pid}' — bare names are deprecated and will be refused after v3.1; the panel:action namespace is the supported form.`,
        );
        // composite key is always owned; the bare key is the read-through
        this.actionHandlers.set(this.compositeKey(panelId, actionName), handler);
        this.actionHandlers.set(actionName, handler);
        if (pid) {
            this.registeredActions.set(`${pid}:${actionName}`, {
                panelId: pid,
                action: actionName,
                schema,
            });
        }
    }

    // namespaced dispatch: resolve by exact `panelId:action` composite first
    // (unambiguous — each panel owns its key). Bare names resolve only when
    // exactly one panel claimed them (enforced at registration); a bare name
    // that no panel claimed falls back to composite-key scanning, where more
    // than one match is refused loudly as ambiguous instead of guessing.
    public resolveHandler(action: string): ActionHandler | undefined {
        const direct = this.actionHandlers.get(action);
        if (direct) return direct;
        const suffix = `:${action}`;
        let found: ActionHandler | undefined;
        let hits = 0;
        for (const [key, handler] of this.actionHandlers.entries()) {
            if (key.endsWith(suffix)) {
                found = handler;
                hits++;
            }
        }
        if (hits > 1) {
            console.error(
                `[paperapi] action '${action}' registered by ${hits} panels; refusing ambiguous dispatch`,
            );
            return undefined;
        }
        return found;
    }

    public addAction(panelId: string, actionName: string, handler: ActionHandler, schema?: any): void {
        // namespaced registration: composite key only, never the bare name —
        // the bare namespace is single-owner (see setActionHandler)
        this.actionHandlers.set(`${panelId}:${actionName}`, handler);
        this.registeredActions.set(`${panelId}:${actionName}`, {
            panelId,
            action: actionName,
            schema,
        });
    }

    public addActions(panelId: string, actionsMap: Record<string, ActionHandler>): string[] {
        const names = Object.keys(actionsMap);
        for (const name of names) {
            this.actionHandlers.set(`${panelId}:${name}`, actionsMap[name]);
            this.registeredActions.set(`${panelId}:${name}`, {
                panelId,
                action: name,
            });
        }
        return names;
    }

    public removeAction(panelId: string, actionName: string): void {
        this.actionHandlers.delete(`${panelId}:${actionName}`);
        this.registeredActions.delete(`${panelId}:${actionName}`);
        // release the bare-name claim when this panel owned it
        if (this.registeredBare.get(actionName) === panelId) {
            this.registeredBare.delete(actionName);
            this.actionHandlers.delete(actionName);
        }
    }

    public addTrigger(panelId: string, triggerName: string, schema?: any): void {
        this.registeredTriggers.set(`${panelId}:${triggerName}`, {
            panelId,
            trigger: triggerName,
            schema,
        });
    }

    public removeTrigger(panelId: string, triggerName: string): void {
        this.registeredTriggers.delete(`${panelId}:${triggerName}`);
    }

    // replay registrations after reconnect
    public async resubscribe(
        call: (action: string, params: Record<string, unknown>) => Promise<any>,
        onError: (label: string, err: unknown) => void,
    ): Promise<void> {
        for (const [key, entry] of this.registeredActions.entries()) {
            call("actions:register", {
                panelId: entry.panelId,
                action: entry.action,
                schema: entry.schema,
            }).catch((err) => onError(`actions:register resubscribe ${key}`, err));
        }

        // O(n) bookkeeping, not O(n²): a bare name only falls back when no
        // composite registration for that action name exists, so the set is
        // built once and each bare name does an O(1) membership check
        const compositeNames = new Set<string>();
        for (const entry of this.registeredActions.values()) {
            compositeNames.add(entry.action);
        }

        for (const [actionName] of this.actionHandlers.entries()) {
            // composite keys are registered via registeredActions below their
            // own entry; only bare names without one need the fallback
            if (actionName.includes(":")) continue;
            const owner = this.registeredBare.get(actionName);
            if (owner && !compositeNames.has(actionName)) {
                call("actions:register", { panelId: owner, action: actionName }).catch((err) =>
                    onError(`actions:register bare resubscribe ${actionName}`, err),
                );
            }
        }

        for (const [key, entry] of this.registeredTriggers.entries()) {
            call("triggers:register", {
                panelId: entry.panelId,
                trigger: entry.trigger,
                schema: entry.schema,
            }).catch((err) => onError(`triggers:register resubscribe ${key}`, err));
        }
    }
}
