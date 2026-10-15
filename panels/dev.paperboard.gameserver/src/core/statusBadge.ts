// How a server status reads on a badge: the panel's Overview and its Home
// widgets show the same words.
import type { PaperBadgeVariant } from "@mileniumhq/paperui";
import type { ServerStatus } from "./state";

export function getStatusBadge(status: ServerStatus): {
    label: string;
    variant: PaperBadgeVariant;
} {
    switch (status) {
        case "online":
            return { label: "Online", variant: "success" };
        case "starting":
            return { label: "Starting...", variant: "warning" };
        case "stopping":
            return { label: "Stopping...", variant: "danger" };
        case "restarting":
            return { label: "Restarting...", variant: "warning" };
        case "offline":
        default:
            return { label: "Offline", variant: "monochrome" };
    }
}
