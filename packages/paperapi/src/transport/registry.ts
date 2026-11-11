export interface RegisteredAction {
    panelId: string;
    action: string;
    schema?: any;
}

export interface RegisteredProject {
    panelId: string;
    id: string;
    name: string;
    icon?: string;
    image?: string;
}

export type ActionHandler = (...args: any[]) => Promise<any> | any;

/**
 * Which daemon registry this mirrors: "actions" (v1, actions:* RPCs, entries
 * named by "action") or "blocks" (v2, blocks:* RPCs, entries named by
 * "entry"). Both replay the same way after a reconnect.
 */
export type RegistryPrefix = "actions" | "blocks";

export class TransportRegistry {
    constructor(private readonly prefix: RegistryPrefix = "actions") {}

    // handlers keyed by "panelId:action": every name is owned by its panel,
    // so two panels may register the same action name without colliding
    public readonly actionHandlers = new Map<string, ActionHandler>();
    public readonly registeredActions = new Map<string, RegisteredAction>();
    // projects keyed "panelId:projectId"; replayed before the actions in them
    public readonly registeredProjects = new Map<string, RegisteredProject>();

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

    public addProject(project: RegisteredProject): void {
        this.registeredProjects.set(`${project.panelId}:${project.id}`, project);
    }

    /** Forgets a project and every action registered into it. */
    public removeProject(panelId: string, projectId: string): void {
        this.registeredProjects.delete(`${panelId}:${projectId}`);
        const prefix = `${panelId}:${projectId}/`;
        for (const key of [...this.registeredActions.keys()]) {
            if (!key.startsWith(prefix)) continue;
            this.registeredActions.delete(key);
            this.actionHandlers.delete(key);
        }
    }

    // replay registrations after reconnect: projects first, since the daemon
    // refuses an action into a project it doesn't know
    public async resubscribe(
        call: (action: string, params: Record<string, unknown>) => Promise<any>,
        onError: (label: string, err: unknown) => void,
    ): Promise<void> {
        await Promise.all(
            [...this.registeredProjects.entries()].map(([key, p]) =>
                call(`${this.prefix}:project-define`, { panelId: p.panelId, project: p.id, name: p.name, icon: p.icon, image: p.image })
                    .catch((err) => onError(`${this.prefix}:project-define resubscribe ${key}`, err)),
            ),
        );
        for (const [key, entry] of this.registeredActions.entries()) {
            call(`${this.prefix}:register`, {
                panelId: entry.panelId,
                [this.prefix === "actions" ? "action" : "entry"]: entry.action,
                schema: entry.schema,
            }).catch((err) => onError(`${this.prefix}:register resubscribe ${key}`, err));
        }

    }
}
