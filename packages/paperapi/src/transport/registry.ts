export interface RegisteredAction {
    panelId: string;
    action: string;
    schema?: any;
}

export type ActionHandler = (...args: any[]) => Promise<any> | any;

export class TransportRegistry {
    // handlers keyed by "panelId:action": every name is owned by its panel,
    // so two panels may register the same action name without colliding
    public readonly actionHandlers = new Map<string, ActionHandler>();
    public readonly registeredActions = new Map<string, RegisteredAction>();

    public getHandler(action: string): ActionHandler | undefined {
        return this.actionHandlers.get(action);
    }

    public addAction(panelId: string, actionName: string, handler: ActionHandler, schema?: any): void {
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

    }
}
