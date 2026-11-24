import { errorCode } from "../errors";

type Call = (action: string, params: Record<string, unknown>) => Promise<unknown>;

/**
 * Registers a set of one panel's blocks in one call. A Paperboard Server from
 * before blocks:register-set answers NOT_FOUND, so each block goes on its own
 * then; the fallback goes at the next protocol version.
 */
export async function registerSet(call: Call, panelId: string, entries: { entry: string; schema: unknown }[]): Promise<void> {
    try {
        await call("blocks:register-set", { panelId, entries });
    } catch (err) {
        if (errorCode(err) !== "NOT_FOUND") throw err;
        for (const { entry, schema } of entries) await call("blocks:register", { panelId, entry, schema });
    }
}

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

    /**
     * Registers a panel's blocks through `register`: their handlers are in
     * place before it is called, since a call can arrive as soon as the
     * daemon has them, and are put back as they were if it refuses. Only a
     * set the daemon accepted is kept to replay.
     */
    public async addActions(
        panelId: string,
        blocks: { entry: string; handler: ActionHandler; schema: unknown }[],
        register: () => Promise<void>,
    ): Promise<void> {
        const before = blocks.map(({ entry }) => this.actionHandlers.get(`${panelId}:${entry}`));
        blocks.forEach(({ entry, handler }) => this.actionHandlers.set(`${panelId}:${entry}`, handler));
        try {
            await register();
        } catch (err) {
            blocks.forEach(({ entry }, i) => {
                const key = `${panelId}:${entry}`;
                const was = before[i];
                if (was) this.actionHandlers.set(key, was);
                else this.actionHandlers.delete(key);
            });
            throw err;
        }
        for (const { entry, schema } of blocks) this.registeredActions.set(`${panelId}:${entry}`, { panelId, action: entry, schema });
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
        // one set per panel and project, as each pass registers them; a set
        // the daemon refuses now doesn't hold back the others
        const sets = new Map<string, { panelId: string; entries: { entry: string; schema: unknown }[] }>();
        for (const { panelId, action, schema } of this.registeredActions.values()) {
            const slash = action.indexOf("/");
            const key = `${panelId}:${slash === -1 ? "" : action.slice(0, slash)}`;
            const set = sets.get(key) ?? { panelId, entries: [] };
            set.entries.push({ entry: action, schema });
            sets.set(key, set);
        }
        await Promise.all(
            [...sets.entries()].map(([key, { panelId, entries }]) =>
                registerSet(call, panelId, entries).catch((err) => onError(`blocks:register-set resubscribe ${key}`, err)),
            ),
        );
    }
}
