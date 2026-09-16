import { createSignal, onMount, Show, For, Index } from "solid-js";
import {
    PaperFlex,
    PaperText,
    PaperQuote,
    PaperButton,
    PaperIcon,
    PaperBadge,
    PaperCard,
    PaperInput,
    PaperModal,
    PaperEffect,
    PaperPageHeader,
    PaperSettingList,
    PaperSettingItem,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperCheckbox, getVarCss } from "@paperboard-dev/paperui";
import { actionsApi, config } from "@paperboard-dev/paperapi";
import {
    GLOBAL_SCOPE,
    COMMAND_DESCRIPTION_MAX_LENGTH,
    COMMAND_OPTION_TYPES,
    COMMAND_OPTION_TYPE_ICONS,
    COMMAND_OPTION_TYPE_LABELS,
    describeCommandOptionProblem,
    describeCommandProblem,
    errorToMessage,
    hasDuplicateOptionName,
    isCommandDescriptionValid,
    isCommandNameValid,
    isOptionOrderValid,
    normalizeCommandDefinitions,
    normalizeCommandName,
    type CommandMutationResult,
    type CommandOptionType,
    type GuildSummary,
    type Health,
    type SlashCommandDefinition,
    type SlashCommandOption,
} from "../types";

const PANEL_ID = "dev.paperboard.botcreator";

// local-only ids for builder rows; never sent to Discord
let nextOptionId = 1;
function newOptionId(): string {
    return `opt-${Date.now().toString(36)}-${nextOptionId++}`;
}

export default function Commands() {
    const [commands, setCommands] = createSignal<SlashCommandDefinition[]>([]);
    const [guilds, setGuilds] = createSignal<GuildSummary[]>([]);
    const [connected, setConnected] = createSignal(false);
    const [loadError, setLoadError] = createSignal("");
    const [actionError, setActionError] = createSignal("");

    const [createOpen, setCreateOpen] = createSignal(false);
    const [name, setName] = createSignal("");
    const [description, setDescription] = createSignal("");
    const [scope, setScope] = createSignal(GLOBAL_SCOPE);
    const [options, setOptions] = createSignal<SlashCommandOption[]>([]);
    const [busy, setBusy] = createSignal(false);
    const [formError, setFormError] = createSignal("");

    const [deleteTarget, setDeleteTarget] = createSignal<SlashCommandDefinition | null>(
        null,
    );

    const load = async () => {
        setLoadError("");
        try {
            const saved = await config.get<any>(PANEL_ID);
            setCommands(normalizeCommandDefinitions(saved?.commands));
        } catch (err) {
            console.error("[Commands] saved commands read failed:", err);
            setLoadError(errorToMessage(err));
        }

        try {
            const list = await actionsApi.call<GuildSummary[]>(PANEL_ID, "list-guilds");
            setGuilds(Array.isArray(list) ? list : []);
        } catch (err) {
            console.error("[Commands] guild list read failed:", err);
        }

        try {
            const health = await actionsApi.call<Health>(PANEL_ID, "get-health");
            if (health) {
                setConnected(Boolean(health.connected));
                if (health.commandSyncError) setActionError(health.commandSyncError);
            }
        } catch (err) {
            console.error("[Commands] health read failed:", err);
        }
    };

    onMount(() => {
        void load();
    });

    const scopeLabel = (value: string) => {
        if (value === GLOBAL_SCOPE) return "Global";
        return guilds().find((g) => g.id === value)?.name ?? value;
    };

    const openCreate = () => {
        setName("");
        setDescription("");
        // if the bot is only in one server, scope the command there by
        // default: guild commands register instantly, global ones can take
        // up to an hour to appear
        setScope(guilds().length === 1 ? guilds()[0].id : GLOBAL_SCOPE);
        setOptions([]);
        setFormError("");
        setCreateOpen(true);
    };

    const isDuplicate = () => {
        const candidate = normalizeCommandName(name());
        if (!candidate) return false;
        return commands().some(
            (c) => c.scope === scope() && c.name === candidate,
        );
    };

    const optionProblems = () =>
        options().map((option, index) =>
            describeCommandOptionProblem(option, options(), index),
        );

    // the same predicates the service rejects with, applied to the inputs
    // PaperInput already knows how to render as invalid
    const optionNameInvalid = (index: number) => {
        const option = options()[index];
        if (!option) return false;
        return (
            !isCommandNameValid(option.name) ||
            hasDuplicateOptionName(options(), option.name)
        );
    };

    const optionDescriptionInvalid = (index: number) => {
        const option = options()[index];
        return option ? !isCommandDescriptionValid(option.description) : false;
    };

    const formProblem = () => {
        const problem = describeCommandProblem({
            name: name(),
            description: description(),
        });
        if (problem) return problem;
        if (isDuplicate()) return "A command with this name already exists in this scope.";
        const optionProblem = optionProblems().find((p) => Boolean(p));
        if (optionProblem) return optionProblem;
        return "";
    };

    const addOption = () => {
        setOptions((prev) => [
            ...prev,
            {
                id: newOptionId(),
                name: "",
                description: "",
                type: "string",
                required: false,
            },
        ]);
    };

    const updateOption = (id: string, patch: Partial<SlashCommandOption>) => {
        setOptions((prev) =>
            prev.map((option) => (option.id === id ? { ...option, ...patch } : option)),
        );
    };

    const removeOption = (id: string) => {
        setOptions((prev) => prev.filter((option) => option.id !== id));
    };

    const moveOption = (index: number, delta: number) => {
        setOptions((prev) => {
            const target = index + delta;
            if (target < 0 || target >= prev.length) return prev;
            const next = [...prev];
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
    };

    const submitCreate = async () => {
        const problem = formProblem();
        if (problem) {
            setFormError(problem);
            return;
        }
        setBusy(true);
        setFormError("");
        setActionError("");
        try {
            const result = await actionsApi.call<CommandMutationResult>(
                PANEL_ID,
                "create-command",
                {
                    name: name(),
                    description: description(),
                    scope: scope(),
                    options: options(),
                },
            );
            setCommands((prev) => [...prev, result.command]);
            setCreateOpen(false);
            if (result.triggerError) setActionError(result.triggerError);
            else if (result.syncError) setActionError(result.syncError);
        } catch (err) {
            console.error("[Commands] create-command failed:", err);
            setFormError(errorToMessage(err));
        } finally {
            setBusy(false);
        }
    };

    const confirmDelete = async () => {
        const target = deleteTarget();
        setDeleteTarget(null);
        if (!target) return;
        setBusy(true);
        setActionError("");
        try {
            const result = await actionsApi.call<CommandMutationResult>(
                PANEL_ID,
                "delete-command",
                { id: target.id },
            );
            setCommands((prev) => prev.filter((c) => c.id !== target.id));
            if (result.triggerError) setActionError(result.triggerError);
            else if (result.syncError) setActionError(result.syncError);
        } catch (err) {
            console.error("[Commands] delete-command failed:", err);
            setActionError(errorToMessage(err));
        } finally {
            setBusy(false);
        }
    };

    const copyCommand = async (command: SlashCommandDefinition) => {
        try {
            await navigator.clipboard.writeText(`/${command.name}`);
        } catch (err) {
            console.error("[Commands] clipboard copy failed:", err);
            setActionError(errorToMessage(err));
        }
    };

    return (
        <>
            <PaperPageHeader
                        icon="terminal"
                        title="Commands"
                        subtitle="Slash commands this bot registers with Discord"
                    >
                        <PaperEffect>
                            <PaperButton onClick={openCreate}>
                                <PaperIcon>add</PaperIcon>
                                Create command
                            </PaperButton>
                        </PaperEffect>
                    </PaperPageHeader>

                    <Show when={!connected()}>
                        <PaperQuote variant="warning" icon="cloud_off" title="Bot offline">
                            Commands are stored here and register the next time the bot
                            connects.
                        </PaperQuote>
                    </Show>

                    <Show when={loadError()}>
                        <PaperQuote variant="danger" icon="warning" title="Stored commands unreadable">
                            {loadError()}
                        </PaperQuote>
                    </Show>

                    <Show when={actionError()}>
                        <PaperQuote variant="danger" icon="warning" title="Command problem">
                            {actionError()}
                        </PaperQuote>
                    </Show>

                    <Show
                        when={commands().length > 0}
                        fallback={
                            <PaperCard>
                                <PaperFlex padding="double" center direction="column" gap="half">
                                    <PaperText size={4} weight={600}>
                                        No slash commands yet
                                    </PaperText>
                                    <PaperText size={2} color="text-subtle">
                                        Create one, then build a flow on its trigger to
                                        answer it.
                                    </PaperText>
                                </PaperFlex>
                            </PaperCard>
                        }
                    >
                        <PaperSettingList autoHeight>
                            <For each={commands()}>
                                    {(command) => (
                                        <PaperSettingItem
                                            title={
                                                <PaperText family="code">
                                                    /{command.name}
                                                </PaperText>
                                            }
                                            description={command.description}
                                        >
                                            <PaperFlex direction="row" gap="half" align="center">
                                                <Show when={command.options.length > 0}>
                                                    <PaperBadge>
                                                        {command.options.length} parameter
                                                        {command.options.length === 1 ? "" : "s"}
                                                    </PaperBadge>
                                                </Show>
                                                <PaperBadge
                                                    variant={
                                                        command.scope === GLOBAL_SCOPE
                                                            ? "monochrome"
                                                            : "primary"
                                                    }
                                                >
                                                    {scopeLabel(command.scope)}
                                                </PaperBadge>
                                                <PaperButton size="tiny"
                                                    icon
                                                    title="Copy command"
                                                    onClick={() => void copyCommand(command)}>
                                                    <PaperIcon>content_copy</PaperIcon>
                                                </PaperButton>
                                                <PaperButton size="tiny"
                                                    icon
                                                    variant="danger"
                                                    title="Delete command"
                                                    disabled={busy()}
                                                    onClick={() => setDeleteTarget(command)}>
                                                    <PaperIcon>delete</PaperIcon>
                                                </PaperButton>
                                            </PaperFlex>
                                        </PaperSettingItem>
                                    )}
                                </For>
                        </PaperSettingList>
                    </Show>

            <PaperModal
                open={createOpen()}
                onClose={() => setCreateOpen(false)}
                title="Create Slash Command"
                size="large"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton onClick={() => setCreateOpen(false)}>
                            Cancel
                        </PaperButton>
                        <PaperButton
                            variant="success"
                            disabled={busy() || Boolean(formProblem())}
                            onClick={() => void submitCreate()}>
                            <PaperIcon>{busy() ? "hourglass_top" : "add"}</PaperIcon>
                            {busy() ? "Creating…" : "Create"}
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperFlex direction="column" gap="full">
                    <PaperFlex direction="column" gap="half">
                        <PaperInput
                            fullWidth
                            placeholder="Command"
                            // one extra char so the optional leading slash fits
                            maxLength={33}
                            value={name()}
                            invalid={!isCommandNameValid(name()) || isDuplicate()}
                            // case is validated, never silently rewritten:
                            // typing "Ping" shows the requirement instead of
                            // turning into "ping" under the author's hands
                            onInput={(e) => setName(e.currentTarget.value)}
                        />
                        <PaperInput
                            fullWidth
                            placeholder="Command Description"
                            maxLength={COMMAND_DESCRIPTION_MAX_LENGTH}
                            value={description()}
                            invalid={!isCommandDescriptionValid(description())}
                            onInput={(e) => setDescription(e.currentTarget.value)}
                        />

                        <PaperSelectMenu
                            name="commandScope"
                            fullWidth
                            value={scope()}
                            onValueChange={(val) => setScope(String(val))}
                        >
                            <PaperSelectMenuItem value={GLOBAL_SCOPE} icon="public">
                                Global (every server)
                            </PaperSelectMenuItem>
                            <For each={guilds()}>
                                {(guild) => (
                                    <PaperSelectMenuItem value={guild.id} icon="dns">
                                        {guild.name} (this server only)
                                    </PaperSelectMenuItem>
                                )}
                            </For>
                        </PaperSelectMenu>

                        <Show when={scope() === GLOBAL_SCOPE}>
                            <PaperQuote variant="warning" icon="schedule" title="Propagation">
                                Global commands can take up to an hour to appear. Pick a
                                server while testing to register instantly.
                            </PaperQuote>
                        </Show>
                    </PaperFlex>

                    <PaperFlex direction="column" gap="half">
                        <PaperFlex direction="row" justify="space-between" align="center">
                            <PaperText size={3} weight={700}>
                                Parameters
                            </PaperText>
                            <PaperButton onClick={addOption}>
                                <PaperIcon>add</PaperIcon>
                                Add parameter
                            </PaperButton>
                        </PaperFlex>

                        <Show when={options().length === 0}>
                            <PaperText size={2} color="text-subtle">
                                No parameters. Discord shows this command with no
                                arguments.
                            </PaperText>
                        </Show>

                        <Index each={options()}>
                            {(option, index) => {
                                const orderProblem = () =>
                                    !isOptionOrderValid(options(), index);
                                return (
                                    <PaperCard padding="full" gap="half">
                                            <PaperFlex direction="row" gap="half" align="center" wrap>
                                                <div style={{ width: `${getVarCss("size-field")}` }}>
                                                    <PaperSelectMenu
                                                        name={`optionType-${option().id}`}
                                                        value={option().type}
                                                        onValueChange={(val) =>
                                                            updateOption(option().id, {
                                                                type: String(val) as CommandOptionType,
                                                            })
                                                        }
                                                    >
                                                        <For each={COMMAND_OPTION_TYPES}>
                                                            {(type) => (
                                                                <PaperSelectMenuItem
                                                                    value={type}
                                                                    icon={COMMAND_OPTION_TYPE_ICONS[type]}
                                                                >
                                                                    {COMMAND_OPTION_TYPE_LABELS[type]}
                                                                </PaperSelectMenuItem>
                                                            )}
                                                        </For>
                                                    </PaperSelectMenu>
                                                </div>
                                                <PaperFlex
                                                    style={{ flex: 1, "min-width": "9rem" }}
                                                >
                                                    <PaperInput
                                                        fullWidth
                                                        placeholder="Parameter"
                                                        value={option().name}
                                                        invalid={optionNameInvalid(index)}
                                                        onInput={(e) =>
                                                            updateOption(option().id, {
                                                                name: e.currentTarget.value,
                                                            })
                                                        }
                                                    />
                                                </PaperFlex>
                                                <PaperFlex direction="row" gap="onefourth">
                                                    <PaperButton size="tiny"
                                                        icon
                                                        title="Move up"
                                                        disabled={index === 0}
                                                        onClick={() => moveOption(index, -1)}>
                                                        <PaperIcon>arrow_upward</PaperIcon>
                                                    </PaperButton>
                                                    <PaperButton size="tiny"
                                                        icon
                                                        title="Move down"
                                                        disabled={index === options().length - 1}
                                                        onClick={() => moveOption(index, 1)}>
                                                        <PaperIcon>arrow_downward</PaperIcon>
                                                    </PaperButton>
                                                    <PaperButton size="tiny"
                                                        icon
                                                        variant="danger"
                                                        title="Remove parameter"
                                                        onClick={() => removeOption(option().id)}>
                                                        <PaperIcon>delete</PaperIcon>
                                                    </PaperButton>
                                                </PaperFlex>
                                            </PaperFlex>

                                            <PaperInput
                                                fullWidth
                                                placeholder="Parameter description"
                                                value={option().description}
                                                invalid={optionDescriptionInvalid(index)}
                                                onInput={(e) =>
                                                    updateOption(option().id, {
                                                        description: e.currentTarget.value,
                                                    })
                                                }
                                            />

                                            <PaperCheckbox
                                                checked={option().required}
                                                label="Required"
                                                onChange={(checked) =>
                                                    updateOption(option().id, {
                                                        required: checked,
                                                    })
                                                }
                                            />

                                            <Show when={orderProblem()}>
                                                <PaperText size={2} color="danger">
                                                    Required parameters must come before
                                                    optional ones.
                                                </PaperText>
                                            </Show>
                                    </PaperCard>
                                );
                            }}
                        </Index>
                    </PaperFlex>

                    <Show when={formError()}>
                        <PaperQuote variant="danger" icon="warning" title="Cannot create">
                            {formError()}
                        </PaperQuote>
                    </Show>
                </PaperFlex>
            </PaperModal>

            <PaperModal
                open={deleteTarget() !== null}
                onClose={() => setDeleteTarget(null)}
                title={`Delete /${deleteTarget()?.name ?? ""}`}
                size="small"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton onClick={() => setDeleteTarget(null)}>
                            Cancel
                        </PaperButton>
                        <PaperButton
                            variant="danger"
                            disabled={busy()}
                            onClick={() => void confirmDelete()}>
                            Delete
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperText preset="body">
                    This removes the command and its trigger. Flows bound to the trigger
                    stop firing until a command with this name is created again.
                </PaperText>
            </PaperModal>
        </>
    );
}

export { Commands };
