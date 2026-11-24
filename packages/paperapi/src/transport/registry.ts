export interface RegisteredAction {
    panelId: string;
    action: string;
    schema?: unknown;
}

export interface RegisteredProject {
    panelId: string;
    id: string;
    name: string;
    icon?: string;
    image?: string;
}

/** A registered handler: called with the args a call carries, which it reads itself. */
export type ActionHandler = (...args: unknown[]) => unknown;

export class TransportRegistry {
    // handlers keyed by "panelId:entry": every name is owned by its panel,
    // so two panels may register the same name without colliding
    public readonly actionHandlers = new Map<string, ActionHandler>();
    public readonly registeredActions = new Map<string, RegisteredAction>();
    // projects keyed "panelId:projectId"; replayed before the blocks in them
    public readonly registeredProjects = new Map<string, RegisteredProject>();

    public getHandler(action: string): ActionHandler | undefined {
        return this.actionHandlers.get(action);
    }

    public addAction(panelId: string, actionName: string, handler: ActionHandler, schema?: unknown): void {
        this.actionHandlers.set(`${panelId}:${actionName}`, handler);
        this.registeredActions.set(`${panelId}:${actionName}`, {
            panelId,
            action: actionName,
            schema,
        });
    }

    public removeAction(panelId: string, actionName: string): void {
        this.actionHandlers.delete(`${panelId}:${actionName}`);
        this.registeredActions.delete(`${panelId}:${actionName}`);
    }

    public addProject(project: RegisteredProject): void {
        this.registeredProjects.set(`${project.panelId}:${project.id}`, project);
    }

    /** Forgets a project and every block registered into it. */
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
    // refuses a block into a project it doesn't know
    public async resubscribe(
        call: (action: string, params: Record<string, unknown>) => Promise<unknown>,
        onError: (label: string, err: unknown) => void,
    ): Promise<void> {
        await Promise.all(
            [...this.registeredProjects.entries()].map(([key, p]) =>
                call("blocks:project-define", { panelId: p.panelId, project: p.id, name: p.name, icon: p.icon, image: p.image })
                    .catch((err) => onError(`blocks:project-define resubscribe ${key}`, err)),
            ),
        );
        // one call per panel, as each panel registers its blocks
        const byPanel = new Map<string, { entry: string; schema: unknown }[]>();
        for (const { panelId, action, schema } of this.registeredActions.values()) {
            const entries = byPanel.get(panelId) ?? [];
            entries.push({ entry: action, schema });
            byPanel.set(panelId, entries);
        }
        for (const [panelId, entries] of byPanel) {
            call("blocks:register-set", { panelId, entries })
                .catch((err) => onError(`blocks:register-set resubscribe ${panelId}`, err));
        }
    }
}
