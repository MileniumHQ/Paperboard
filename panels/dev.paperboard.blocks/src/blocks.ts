// The Blocks panel's own blocks, so a flow can drive the projects beside it:
// list them, switch their flows on and off, run and stop them, and hear when
// one of their flows fails. The service hands in what each block does.
import type { BlockSet, BlocksHandle } from "@mileniumhq/paperapi";
import type { ProjectSummary } from "./lib/projects";

/** What the blocks do, as the service does it. */
export interface BlocksPanelHost {
    /** the kept projects' ids, the most recently edited first (drafts aren't kept yet) */
    projects(): string[];
    /** throws for a project that doesn't exist */
    project(id: string): ProjectSummary;
    /** how many of the project's flows are running now */
    runningCount(id: string): number;
    setEnabled(id: string, enabled: boolean): Promise<void>;
    /** starts the project's "When Run is clicked" flows; how many started */
    run(id: string): number;
    /** stops the project's runs; how many were stopped */
    stop(id: string): number;
}

export const FLOW_FAILED_EVENT = "flow-failed";
const CATEGORY = "Projects";

export function blocksPanelBlocks(host: BlocksPanelHost): BlockSet {
    return {
        types: [
            {
                id: "project",
                name: "Project",
                icon: "extension",
                description: "A Blocks project, and the flows in it",
                base: "text",
                fields: {
                    name: { type: "text", name: "Name", resolve: (id: string) => host.project(id).name },
                    on: { type: "boolean", name: "Flows On", description: "Its flows start when their events happen", resolve: (id: string) => host.project(id).enabled },
                    running: { type: "boolean", name: "Running", description: "One of its flows is running now", resolve: (id: string) => host.runningCount(host.project(id).id) > 0 },
                    flows: { type: "number", name: "Flows", description: "How many flows it has", resolve: (id: string) => host.project(id).flowCount },
                },
            },
        ],
        values: [
            {
                id: "projects",
                name: "Projects",
                category: CATEGORY,
                icon: "extension",
                description: "Every Blocks project, the most recently edited first",
                type: "list<project>",
                changes: true,
                read: () => host.projects(),
            },
        ],
        commands: [
            {
                id: "turn-on-project",
                name: "Turn On Project",
                category: CATEGORY,
                icon: "toggle_on",
                description: "Its flows start when their events happen, as the switch on its card does",
                text: "turn on {project}",
                inputs: { project: { type: "project", name: "Project" } },
                run: ({ project }: { project: string }) => host.setEnabled(project, true),
            },
            {
                id: "turn-off-project",
                name: "Turn Off Project",
                category: CATEGORY,
                icon: "toggle_off",
                description: "Its flows stop listening for events; runs already going carry on",
                text: "turn off {project}",
                inputs: { project: { type: "project", name: "Project" } },
                run: ({ project }: { project: string }) => host.setEnabled(project, false),
            },
            {
                id: "run-project",
                name: "Run Project",
                category: CATEGORY,
                icon: "play_arrow",
                description: 'Starts its "When Run is clicked" flows, as its Run button does, and gives how many started',
                text: "run {project}",
                inputs: { project: { type: "project", name: "Project" } },
                output: "number",
                run: ({ project }: { project: string }) => host.run(project),
            },
            {
                id: "stop-project",
                name: "Stop Project",
                category: CATEGORY,
                icon: "stop",
                description: "Stops every run of its flows, and gives how many were stopped",
                text: "stop {project}",
                inputs: { project: { type: "project", name: "Project" } },
                output: "number",
                run: ({ project }: { project: string }) => host.stop(project),
            },
        ],
        events: [
            {
                id: FLOW_FAILED_EVENT,
                name: "When a Flow Fails",
                category: CATEGORY,
                icon: "error",
                description: "Fires when a flow stops on an error. A flow started from this block that fails doesn't fire it again",
                text: "when a flow in {project} fails",
                inputs: { project: { type: "project", name: "Project", optional: true } },
                filters: { project: "project" },
                values: {
                    project: { type: "project", name: "Project" },
                    error: { type: "text", name: "Error", description: "What went wrong, as the console says it" },
                },
            },
        ],
    };
}

/**
 * Tells the registry what happened, once the blocks are registered: the
 * project list only when its ids changed, and every failure is reported.
 */
export class BlocksAnnouncer {
    private registered = false;
    private last = "";

    constructor(private readonly handle: BlocksHandle) {}

    async register(set: BlockSet, projects: string[]): Promise<void> {
        await this.handle.register(set);
        this.last = JSON.stringify(projects);
        this.registered = true;
    }

    projects(ids: string[]): void {
        if (!this.registered) return;
        const key = JSON.stringify(ids);
        if (key === this.last) return;
        this.last = key;
        this.handle.changed("projects").catch((err) => console.error("[dev.paperboard.blocks] the change to Projects did not reach the registry:", err));
    }

    failed(project: string, error: string): void {
        if (!this.registered) return;
        this.handle.fire(FLOW_FAILED_EVENT, { project, error }).catch((err) => console.error("[dev.paperboard.blocks] When a Flow Fails did not reach the registry:", err));
    }
}
