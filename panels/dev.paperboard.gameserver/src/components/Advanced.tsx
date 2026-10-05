import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
    PaperFlex,
    PaperInput,
    PaperQuote,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperSettingItem,
    PaperSettingList,
    PaperText,
    PaperCard,
} from "@mileniumhq/paperui";
import { FieldControl } from "./PropertyFieldControl";
import { PaperPageHeader } from "@mileniumhq/paperui";
import { supports } from "../lib/capabilities";
import {
    MAX_RAM_GB,
    MIN_RAM_GB,
    ramAllocation,
    setRamAllocation,
    updatePanelConfig,
} from "../lib/server";
import {
    readServerProperties,
    writeServerProperties,
} from "../lib/properties";
import type { PropertyField } from "../lib/properties";

const SAVE_DEBOUNCE_MS = 400;

const RAM_CHOICES = Array.from(
    { length: MAX_RAM_GB - MIN_RAM_GB + 1 },
    (_, i) => MIN_RAM_GB + i,
);

// server.properties entries not exposed in the Options, Worlds or Game Rules tabs
const ADVANCED_PROPERTY_FIELDS: PropertyField[] = [
    {
        key: "motd",
        title: "MOTD",
        description: "Message shown in the server list. Color codes allowed.",
        control: "text",
        defaultValue: "A Minecraft Server",
    },
    {
        key: "online-mode",
        title: "Online Mode",
        description: "Verify players against Mojang accounts. Disabling allows cracked clients.",
        control: "toggle",
        defaultValue: "true",
    },
    {
        key: "white-list",
        title: "Whitelist",
        description: "Only whitelisted players may join (manage them in Players).",
        control: "toggle",
        defaultValue: "false",
    },
    {
        key: "enable-command-block",
        title: "Command Blocks",
        control: "toggle",
        defaultValue: "false",
        capability: "propertyEnableCommandBlock",
    },
    {
        key: "function-permission-level",
        title: "Function Permission Level",
        description: "Permission level functions and command blocks run at.",
        control: "number",
        defaultValue: "2",
        min: 1,
        max: 4,
        capability: "functionPermissionLevel",
    },
    {
        key: "enforce-secure-profile",
        title: "Enforce Secure Profile",
        description: "Require players to have signed chat profiles.",
        control: "toggle",
        defaultValue: "true",
        capability: "enforceSecureProfile",
    },
    {
        key: "allow-flight",
        title: "Allow Flight",
        description: "Survival players may fly. Disabling only kicks flying players.",
        control: "toggle",
        defaultValue: "false",
    },
    {
        key: "op-permission-level",
        title: "OP Permission Level",
        description: "Permission level granted to operators (4 = full control).",
        control: "number",
        defaultValue: "4",
        min: 0,
        max: 4,
    },
    {
        key: "sync-chunk-writes",
        title: "Sync Chunk Writes",
        description: "Write chunk data to disk immediately. Disable for better performance at some data-loss risk.",
        control: "toggle",
        defaultValue: "true",
        capability: "syncChunkWrites",
    },
    {
        key: "entity-broadcast-range-percentage",
        title: "Entity Broadcast Range",
        description: "Percentage of view distance used for entity tracking. Lower saves bandwidth.",
        control: "number",
        defaultValue: "100",
        min: 10,
        max: 500,
        capability: "entityBroadcastRange",
    },
    {
        key: "network-compression-threshold",
        title: "Network Compression Threshold",
        description: "Compress packets larger than this many bytes. -1 disables compression.",
        control: "number",
        defaultValue: "256",
        min: -1,
        max: 1024,
    },
    {
        key: "rate-limit",
        title: "Rate Limit",
        description: "Milliseconds a player may stay silent before being kicked for spamming. 0 disables.",
        control: "number",
        defaultValue: "0",
        min: 0,
        capability: "rateLimit",
    },
    {
        key: "enable-status",
        title: "Server List Ping",
        description: "Respond to queries from the multiplayer server list.",
        control: "toggle",
        defaultValue: "true",
        capability: "enableStatus",
    },
    {
        key: "hide-online-players",
        title: "Hide Online Players",
        description: "Don't report the player count in the server list.",
        control: "toggle",
        defaultValue: "false",
        capability: "hideOnlinePlayers",
    },
    {
        key: "accepts-transfers",
        title: "Accept Transfers",
        description: "Allow the server to transfer players to other servers.",
        control: "toggle",
        defaultValue: "false",
        capability: "acceptsTransfers",
    },
    {
        key: "log-ips",
        title: "Log Player IPs",
        description: "Include player IP addresses in the server log.",
        control: "toggle",
        defaultValue: "true",
        capability: "logIps",
    },
    {
        key: "require-resource-pack",
        title: "Require Resource Pack",
        description: "Players must accept the server's resource pack to join.",
        control: "toggle",
        defaultValue: "false",
        capability: "requireResourcePack",
    },
    {
        key: "resource-pack",
        title: "Resource Pack URL",
        description: "Direct download URL for the resource pack.",
        control: "text",
        defaultValue: "",
        capability: "requireResourcePack",
        dependsOn: { key: "require-resource-pack", equals: "true" },
    },
];

// a field whose capability this Minecraft version lacks is hidden, not
// shown with an apology; a dependent field also needs its gate value set
function visibleAdvancedFields(
    values?: Record<string, string>,
): PropertyField[] {
    return ADVANCED_PROPERTY_FIELDS.filter((field) => {
        if (field.capability && !supports(field.capability)) return false;
        if (
            field.dependsOn &&
            values?.[field.dependsOn.key] !== field.dependsOn.equals
        ) {
            return false;
        }
        return true;
    });
}

export default function Advanced() {
    const [values, setValues] = createSignal<Record<string, string> | null>(null);
    const [saveError, setSaveError] = createSignal(false);
    const [search, setSearch] = createSignal("");

    const [ramError, setRamError] = createSignal(false);
    const [ramSaved, setRamSaved] = createSignal(false);

    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let ramSavedTimer: ReturnType<typeof setTimeout> | null = null;

    onMount(async () => {
        const props = await readServerProperties();
        const next: Record<string, string> = {};
        for (const field of visibleAdvancedFields(props)) {
            next[field.key] = props[field.key] ?? field.defaultValue;
        }
        setValues(next);
    });

    onCleanup(() => {
        if (saveTimer) clearTimeout(saveTimer);
        if (ramSavedTimer) clearTimeout(ramSavedTimer);
    });

    const changeRam = async (value: string) => {
        const gb = Number(value);
        if (!Number.isInteger(gb) || gb < MIN_RAM_GB || gb > MAX_RAM_GB) return;
        const previous = ramAllocation();
        setRamAllocation(gb);
        try {
            await updatePanelConfig({ ramGB: gb });
            setRamError(false);
            setRamSaved(true);
            if (ramSavedTimer) clearTimeout(ramSavedTimer);
            ramSavedTimer = setTimeout(() => setRamSaved(false), 3000);
        } catch (err) {
            console.error("[Advanced] Failed to persist memory allocation:", err);
            setRamAllocation(previous);
            setRamError(true);
        }
    };

    const currentValue = (field: PropertyField) =>
        values()?.[field.key] ?? field.defaultValue;

    const updateValue = (field: PropertyField, value: string) => {
        if (field.control === "number") {
            if (value.trim() === "") return;
            const num = Number(value);
            if (!Number.isFinite(num)) return;
            if (field.min !== undefined && num < field.min) return;
            if (field.max !== undefined && num > field.max) return;
        }
        setValues((prev) => ({ ...(prev ?? {}), [field.key]: value }));
        scheduleSave();
    };

    const scheduleSave = () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => void persistChanges(), SAVE_DEBOUNCE_MS);
    };

    const persistChanges = async () => {
        const snapshot = values();
        if (!snapshot) return;
        try {
            await writeServerProperties(snapshot);
            setSaveError(false);
        } catch (err) {
            console.debug("[advanced] server.properties save failed:", String(err));
            setSaveError(true);
        }
    };

    const renderControl = (field: PropertyField) => (
        <FieldControl
            field={field}
            value={() => currentValue(field)}
            onUpdate={(value) => updateValue(field, value)}
        />
    );

    const visibleFields = () => {
        const query = search().toLowerCase().trim();
        const fields = visibleAdvancedFields(values() ?? undefined);
        if (!query) return fields;
        return fields.filter(
            (field) =>
                field.title.toLowerCase().includes(query) ||
                (field.description ?? "").toLowerCase().includes(query) ||
                field.key.toLowerCase().includes(query),
        );
    };

    return (
        <>
                    <PaperPageHeader icon="settings" title="Advanced" />
                    <PaperCard>
                        <PaperFlex padding="full">
                            <PaperInput
                                fullWidth
                                icon="search"
                                placeholder="Search advanced settings..."
                                value={search()}
                                onInput={(e) => setSearch(e.currentTarget.value)}
                            />
                        </PaperFlex>
                    </PaperCard>
                        <PaperSettingList autoHeight>
                            <PaperFlex direction="column" gap="half" padding="full">
                                <Show when={ramSaved()}>
                                    <PaperQuote variant="success" icon="check" title="Saved">
                                        Memory allocation saved. It applies the next time the server starts.
                                    </PaperQuote>
                                </Show>
                                <Show
                                    when={ramError() || saveError()}
                                    fallback={
                                        <PaperQuote variant="warning" icon="info" title="Note">
                                            Changes won't be applied until the server is restarted.
                                        </PaperQuote>
                                    }
                                >
                                    <PaperQuote variant="danger" icon="warning" title="Error">
                                        {ramError()
                                            ? "Failed to save the memory allocation. Check the console for details."
                                            : "Failed to save changes. Check the console for details."}
                                    </PaperQuote>
                                </Show>
                            </PaperFlex>
                            <PaperSettingItem
                                title="Memory Allocation"
                                description={`Java heap size (-Xmx/-Xms) for the server process, from ${MIN_RAM_GB} GB to ${MAX_RAM_GB} GB.`}
                            >
                                <PaperSelectMenu
                                    name="ramAllocation"
                                    value={String(ramAllocation())}
                                    onValueChange={(val) => void changeRam(String(val))}
                                >
                                    <For each={RAM_CHOICES}>
                                        {(gb) => (
                                            <PaperSelectMenuItem value={String(gb)}>
                                                {gb} GB
                                            </PaperSelectMenuItem>
                                        )}
                                    </For>
                                </PaperSelectMenu>
                            </PaperSettingItem>

                            <Show when={values()}>
                                <For each={visibleFields()}>
                                    {(field) => (
                                        <PaperSettingItem
                                            title={field.title}
                                            description={field.description}
                                        >
                                            {renderControl(field)}
                                        </PaperSettingItem>
                                    )}
                                </For>
                            </Show>
                        </PaperSettingList>
        </>
    );
}
