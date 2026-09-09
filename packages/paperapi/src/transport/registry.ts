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

export class TransportRegistry {
    public readonly actionHandlers = new Map<string, ActionHandler>();
    public readonly registeredActions = new Map<string, RegisteredAction>();
    public readonly registeredTriggers = new Map<string, RegisteredTrigger>();

    constructor(private readonly resolveDefaultPanelId: () => string) {}

    public getHandler(action: string): ActionHandler | undefined {
        return this.actionHandlers.get(action);
    }

    public setActionHandler(
        actionName: string,
        handler: ActionHandler,
        panelId?: string,
        schema?: any,
    ): void {
        this.actionHandlers.set(actionName, handler);
        const pid = panelId || this.resolveDefaultPanelId();
        if (pid) {
            this.registeredActions.set(`${pid}:${actionName}`, {
                panelId: pid,
                action: actionName,
                schema,
            });
        }
    }

    public addAction(panelId: string, actionName: string, handler: ActionHandler, schema?: any): void {
        this.actionHandlers.set(actionName, handler);
        this.registeredActions.set(`${panelId}:${actionName}`, {
            panelId,
            action: actionName,
            schema,
        });
    }

    public addActions(panelId: string, actionsMap: Record<string, ActionHandler>): string[] {
        const names = Object.keys(actionsMap);
        for (const name of names) {
            this.actionHandlers.set(name, actionsMap[name]);
            this.registeredActions.set(`${panelId}:${name}`, {
                panelId,
                action: name,
            });
        }
        return names;
    }

    public removeAction(panelId: string, actionName: string): void {
        this.actionHandlers.delete(actionName);
        this.registeredActions.delete(`${panelId}:${actionName}`);
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

        for (const [actionName] of this.actionHandlers.entries()) {
            const hasEntry = Array.from(this.registeredActions.values()).some(
                (a) => a.action === actionName,
            );
            if (!hasEntry) {
                const pid = this.resolveDefaultPanelId();
                if (pid) {
                    call("actions:register", { panelId: pid, action: actionName }).catch((err) =>
                        onError(`actions:register fallback resubscribe ${actionName}`, err),
                    );
                }
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
