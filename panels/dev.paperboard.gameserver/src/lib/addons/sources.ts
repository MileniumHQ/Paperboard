import { getProject, type ModrinthHit } from "../modrinth";
import { formatCount } from "./presentation";
import type { AddonHit, AddonProject, AddonSource } from "./kind";

// Modrinth as an add-on source: the catalog the Minecraft tabs search.

function formatDate(iso: string): string {
    const date = new Date(iso);
    if (!iso || Number.isNaN(date.getTime())) return "Unknown";
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export const modrinthHits = (hits: ModrinthHit[]): AddonHit[] =>
    hits.map((hit) => ({ ...hit, stat: `${formatCount(hit.downloads)} downloads` }));

/** `path` is Modrinth's address segment for the type: modrinth.com/<path>/<slug> */
export function modrinthSource(path: string, browseUrl: string): AddonSource {
    return {
        name: "Modrinth",
        url: browseUrl,
        pageLabel: "Open at Modrinth.com",
        pageUrl: (target) => `https://modrinth.com/${path}/${target.slug}`,
        async project(target): Promise<AddonProject> {
            const project = await getProject(target.projectId);
            return {
                title: project.title,
                description: project.description,
                iconUrl: project.iconUrl,
                body: project.body,
                // Modrinth bodies are reviewed, host-scoped by the panel manifest and CSP-enforced
                allowImages: true,
                info: [
                    { label: "Downloads", value: formatCount(project.downloads) },
                    { label: "Follows", value: formatCount(project.follows) },
                    { label: "Last Updated", value: formatDate(project.dateModified) },
                    { label: "License", value: project.license },
                    {
                        label: "Loaders",
                        value: project.loaders.length ? project.loaders.map((l) => l.charAt(0).toUpperCase() + l.slice(1)).join(", ") : "Unknown",
                    },
                ],
            };
        },
    };
}
