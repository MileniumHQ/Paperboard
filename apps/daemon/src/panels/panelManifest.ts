// Panel manifest validation: only known, bounded fields leave here.
import * as path from "path";
import { requirePanelId } from "@mileniumhq/paperapi/panelIdentity";
import { validateWidgetDeclarations } from "@mileniumhq/paperapi/widgetManifest";
import { errorMessage } from "@mileniumhq/paperapi/errors";

export interface PanelManifestLike {
    id: string;
    name: string;
    description?: string;
    version?: string;
    publisher?: string;
    icon?: string;
    base?: string;
    [key: string]: unknown;
}

function str(v: unknown, maxLen = 512): string | undefined {
    if (typeof v !== "string") return undefined;
    return v.slice(0, maxLen);
}

// Validates a panel manifest, returning only known-safe bounded fields
export function validatePanelManifest(
    raw: unknown,
    fallbackId: string,
): PanelManifestLike {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Invalid panel manifest: expected object");
    }
    const record = raw as Record<string, unknown>;

    const id = requirePanelId(fallbackId);
    if (record.id !== undefined && requirePanelId(record.id) !== id) {
        throw new Error(`Manifest id "${record.id}" does not match requested panel id "${id}"`);
    }

    const name =
        str(record.name, 128) ||
        str(record.title, 128) ||
        fallbackId;

    const manifest: PanelManifestLike = { id, name };

    const description = str(record.description, 2048);
    if (description) manifest.description = description;

    const version = str(record.version, 32);
    if (version) manifest.version = version;

    const publisher =
        str(record.publisher, 128) || str(record.author, 128);
    if (publisher) manifest.publisher = publisher;

    const icon = str(record.icon, 256);
    if (icon) manifest.icon = icon;

    // `base` must stay relative, never an absolute or parent escape
    const base = str(record.base, 256);
    if (base) {
        if (path.isAbsolute(base) || base.split(/[\\/]/).includes("..")) {
            throw new Error(`Invalid base path in manifest for ${id}`);
        }
        manifest.base = base;
    }

    const service = str(record.service, 256);
    if (service) {
        if (path.isAbsolute(service) || service.split(/[\\/]/).includes("..")) {
            throw new Error(`Invalid service path in manifest for ${id}`);
        }
        manifest.service = service;
    }

    if (typeof record.autostart === "boolean") {
        manifest.autostart = record.autostart;
    }

    // one rule shared with the packer; a broken declaration refuses the
    // manifest rather than listing a panel with half its widgets
    try {
        const widgets = validateWidgetDeclarations(record.widgets);
        if (widgets.length > 0) manifest.widgets = widgets;
    } catch (err) {
        throw new Error(`Invalid widgets in manifest for ${id}: ${errorMessage(err)}`);
    }

    // unknown manifest fields are dropped
    return manifest;
}
