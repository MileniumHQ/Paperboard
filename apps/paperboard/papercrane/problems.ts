// Each panel's problems: failures its service or page had no button to show
// under, kept until the panel clears them or the person dismisses them.
// In memory: they outlive a service restart, so a crash doesn't take away
// what led to it, but not the daemon's, whose services start over and say
// again what is still wrong. An uninstall takes the panel's away.
import {
    PROBLEMS_PER_PANEL,
    type PanelProblem,
} from "@mileniumhq/paperapi/problemShape";

export class PanelProblems {
    // by panel, then key; a Map keeps the order they were last reported in
    private byPanel = new Map<string, Map<string, PanelProblem>>();
    private listeners = new Set<(panelId: string, problems: PanelProblem[]) => void>();

    list(panelId: string): PanelProblem[] {
        return [...(this.byPanel.get(panelId)?.values() ?? [])];
    }

    every(): Record<string, PanelProblem[]> {
        return Object.fromEntries([...this.byPanel.keys()].map((panelId) => [panelId, this.list(panelId)]));
    }

    /** a report with a key the panel has replaces it, and counts as the newest */
    report(panelId: string, problem: Omit<PanelProblem, "at">): void {
        let problems = this.byPanel.get(panelId);
        if (!problems) this.byPanel.set(panelId, (problems = new Map()));
        problems.delete(problem.key);
        problems.set(problem.key, { ...problem, at: Date.now() });
        if (problems.size > PROBLEMS_PER_PANEL) problems.delete(problems.keys().next().value!);
        this.changed(panelId);
    }

    /** without a key, all the panel's problems go */
    clear(panelId: string, key?: string): void {
        const problems = this.byPanel.get(panelId);
        if (!problems) return;
        if (key === undefined) problems.clear();
        else if (!problems.delete(key)) return;
        if (problems.size === 0) this.byPanel.delete(panelId);
        this.changed(panelId);
    }

    onChange(listener: (panelId: string, problems: PanelProblem[]) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private changed(panelId: string): void {
        const problems = this.list(panelId);
        for (const listener of [...this.listeners]) listener(panelId, problems);
    }
}
