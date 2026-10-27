// One block on the canvas: its sentence of words and fields, its problems,
// extra options and the value it produces, and for a trigger or container,
// the flow of blocks nested inside it.
import { createSignal, createMemo, For, Show } from "solid-js";
import {
    PaperFlex,
    PaperIcon,
    PaperText,
    PaperButton,
} from "@mileniumhq/paperui";
import { checkActionInput, type ActionSchema } from "@mileniumhq/paperapi";
import type { CanvasBlock } from "../lib/tree";
import { typeDisplayName } from "../lib/typeCatalog";
import { actionParams, formatFallbackLabel, parseTemplateTokens, type TemplateToken } from "../lib/template";
import type { ActionBlockProps } from "./actionBlockProps";
import InputPill from "./fields/InputPill";

export type { ActionBlockProps };

export default function ActionBlock(props: ActionBlockProps) {
    const [isDragging, setIsDragging] = createSignal(false);
    const [isEditing, setIsEditing] = createSignal(false);
    const [showMoreOptions, setShowMoreOptions] = createSignal(false);
    let dragStart = { x: 0, y: 0 };
    let posStart = { x: 0, y: 0 };

    // limits the action declares on its inputs, checked on what is typed;
    // a variable is only known when the flow runs, and the call itself is
    // checked again by the SDK then
    const inputProblems = createMemo(() => {
        const problems: { key: string; message: string }[] = [];
        const isVariable = (v: unknown) => typeof v === "string" && v.includes("{{");
        for (const [key, def] of Object.entries((props.action as ActionSchema)?.inputs || {})) {
            const message = checkActionInput(def, props.values?.[key], isVariable);
            if (message) problems.push({ key, message });
        }
        return problems;
    });
    const hasProblem = (key: string) => inputProblems().some((p) => p.key === key);

    const paramsMap = createMemo(() => actionParams(props.action as ActionSchema));

    const tokens = createMemo(() => {
        const template =
            props.action.template ||
            props.action.writtenOut ||
            undefined;
        return parseTemplateTokens(template, props.action.name, paramsMap());
    });

    const handlePointerDown = (e: PointerEvent) => {
        props.onInteract?.();

        if (e.button === 2) {
            e.stopPropagation();
            return;
        }

        if (e.button !== 0 || !props.onMove || props.static) return;

        if ((e.target as HTMLElement).closest(".actionInput") || (e.target as HTMLElement).closest("button")) return;

        e.stopPropagation();
        setIsDragging(true);
        dragStart = { x: e.clientX, y: e.clientY };
        posStart = { x: props.pos?.x || 0, y: props.pos?.y || 0 };

        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: PointerEvent) => {
        if (!isDragging() || !props.onMove) return;
        e.stopPropagation();

        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;

        props.onMove(
            {
                x: Math.round(posStart.x + dx),
                y: Math.round(posStart.y + dy),
            },
            e.clientX,
            e.clientY,
        );
    };

    const handlePointerUp = (e: PointerEvent) => {
        if (isDragging()) {
            setIsDragging(false);
            try {
                (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            } catch (err) {
                console.debug("[actions] pointer capture release failed:", String(err));
            }
            props.onDragEnd?.();
        }
    };

    const isContainerBlock = () =>
        props.action.id === "repeat" ||
        props.action.id === "if" ||
        props.action.id === "if-else" ||
        props.action.id === "try-catch";

    const isHoverIndex = (index: number, branch?: "else") => {
        if (!props.activeDropTarget || !props.id) return false;
        const expectedParentId = branch === "else" ? `${props.id}:else` : props.id;
        return (
            props.activeDropTarget.parentId === expectedParentId &&
            props.activeDropTarget.insertIndex === index
        );
    };

    const isRunning = () =>
        Boolean(props.running || (props.id && props.runningBlockIds?.().has(props.id)));

    const renderInputPill = (token: TemplateToken, placeholderOverride?: string) => (
        <InputPill
            block={props}
            token={token}
            def={paramsMap()[token.key!]}
            placeholderOverride={placeholderOverride}
            invalid={hasProblem(token.key!)}
        />
    );

    const schemaInputs = () => (props.action as ActionSchema)?.inputs || {};

    // A multiline input is declared by its own schema flag and gets a
    // wrapping block row under the header instead of an inline pill. Today
    // only the builtin Text action declares it.
    const multilineKeys = () => {
        const keys: { key: string; label: string }[] = [];
        for (const t of tokens()) {
            if (t.type === "input" && t.key && paramsMap()[t.key]?.multiline) {
                keys.push({ key: t.key, label: t.label || formatFallbackLabel(t.key) });
            }
        }
        return keys;
    };

    const templateKeySet = () => {
        const set = new Set<string>();
        for (const t of tokens()) {
            if (t.type === "input" && t.key) set.add(t.key);
        }
        return set;
    };
    const extraKeys = () =>
        Object.keys(schemaInputs()).filter((k) => !templateKeySet().has(k));

    const isSourceHighlight = () =>
        Boolean(props.id && props.highlightedSourceBlockId?.() === props.id);

    const stacksVertically = () =>
        Boolean(
            props.isTrigger ||
                isContainerBlock() ||
                extraKeys().length > 0 ||
                multilineKeys().length > 0,
        );

    return (
        <PaperFlex
            class={`action ${props.isTrigger ? "triggerAction" : ""} ${isContainerBlock() ? "triggerAction isContainer" : ""} ${isRunning() ? "runningFlow" : ""} ${isSourceHighlight() ? "sourceHighlight" : ""} ${isDragging() ? "dragging" : ""} ${props.class || ""}`}
            direction={stacksVertically() ? "column" : "row"}
            align={stacksVertically() ? "stretch" : "center"}
            gap="base"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onFocusIn={() => setIsEditing(true)}
            onFocusOut={(e) => {
                // focus moves between the card's own fields while editing;
                // only a focus leaving the card ends the editing state
                const next = e.relatedTarget as Node | null;
                if (!next || !(e.currentTarget as HTMLElement).contains(next)) {
                    setIsEditing(false);
                }
            }}
            onContextMenu={(e) => {
                if (props.static || !props.id) return;
                e.preventDefault();
                e.stopPropagation();
                props.onContextMenu?.(props.id, e.clientX, e.clientY, e);
            }}
            style={{
                ...(props.pos
                    ? {
                          transform: `translate3d(${props.pos.x}px, ${props.pos.y}px, 0)`,
                          "z-index": isEditing()
                              ? 999999
                              : props.zIndex !== undefined
                                ? props.zIndex
                                : "auto",
                      }
                    : {}),
            }}
        >
            <PaperFlex
                direction="row"
                align="center"
                gap="half"
                class="actionHeaderRow"
                fullWidth
            >
                <Show when={props.iconSrc}>
                    <PaperIcon src={props.iconSrc} class="actionHeaderIcon" />
                </Show>
                <Show when={!props.iconSrc && props.action.icon}>
                    <PaperIcon class="actionHeaderIcon">{props.action.icon}</PaperIcon>
                </Show>

                <span class="actionText" contenteditable="false">
                    <For each={tokens()}>
                        {(token) => {
                            if (token.type === "input") {
                                if (
                                    token.key === "right" &&
                                    (props.values?.operator === "is-true" ||
                                        props.values?.operator === "is-false")
                                ) {
                                    return null;
                                }
                                if (token.key && paramsMap()[token.key]?.multiline) {
                                    return null;
                                }
                                return renderInputPill(token);
                            }
                            return <span contenteditable="false">{token.text}</span>;
                        }}
                    </For>
                </span>
            </PaperFlex>

            <Show when={(props.action as ActionSchema).deprecated}>
                {(message) => (
                    <div class="actionDeprecated" role="note">
                        <PaperIcon aria-hidden="true">warning</PaperIcon>
                        <PaperText size={2}>{message()}</PaperText>
                    </div>
                )}
            </Show>

            <div class="actionProblems" aria-live="polite">
                <For each={inputProblems()}>
                    {(problem) => (
                        <div class="actionProblem">
                            <PaperIcon aria-hidden="true">error</PaperIcon>
                            <PaperText size={2}>{problem.message}</PaperText>
                        </div>
                    )}
                </For>
            </div>

            <Show when={multilineKeys().length > 0}>
                <For each={multilineKeys()}>
                    {({ key, label }) => (
                        <div class="actionMultilineRow">
                            {renderInputPill({ type: "input", key, label })}
                        </div>
                    )}
                </For>
            </Show>

            <Show when={extraKeys().length > 0}>
                <div class="actionMoreOptions">
                    <PaperButton size="tiny"
                        variant="text"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowMoreOptions(!showMoreOptions());
                        }}
                        title={showMoreOptions() ? "Hide extra options" : "Show extra options"}>
                        <PaperIcon>
                            {showMoreOptions() ? "expand_more" : "chevron_right"}
                        </PaperIcon>
                        Options
                    </PaperButton>
                    <Show when={showMoreOptions()}>
                        <For each={extraKeys()}>
                            {(key) => {
                                const def = schemaInputs()[key];
                                return (
                                    <div class="actionMoreOptionsRow">
                                        <PaperText size={3} weight={500}>
                                            {def?.label || formatFallbackLabel(key)}
                                        </PaperText>
                                        {renderInputPill(
                                            {
                                                type: "input",
                                                key,
                                                label: def?.label || formatFallbackLabel(key),
                                            },
                                            def?.typeName || typeDisplayName(def?.type),
                                        )}
                                    </div>
                                );
                            }}
                        </For>
                    </Show>
                </div>
            </Show>

            <Show when={!props.isTrigger && props.variableName}>
                <div
                    class="actionVariableFooter"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onContextMenu={(e) => {
                        if (props.id) props.onContextMenu?.(props.id, e.clientX, e.clientY, e);
                    }}
                    title="Right-click for variable options"
                >
                    <span class="actionVariableFooterText">{props.variableName}</span>
                </div>
            </Show>

            <Show when={props.isTrigger || isContainerBlock()}>
                <FlowBranch block={props} blocks={props.children} isHoverIndex={isHoverIndex} />

                <Show when={props.action.id === "if-else" || props.action.id === "try-catch"}>
                    <PaperText size={3} weight={500} class="ifElsePlain">
                        {props.action.id === "try-catch" ? "catch" : "else"}
                    </PaperText>

                    <FlowBranch block={props} branch="else" blocks={props.elseChildren} isHoverIndex={isHoverIndex} />
                </Show>
            </Show>
        </PaperFlex>
    );
}

// the blocks nested in a trigger or container (or its else/catch branch),
// with an insertion line before each and a drop zone after the last
function FlowBranch(branchProps: {
    block: ActionBlockProps;
    branch?: "else";
    blocks?: CanvasBlock[];
    isHoverIndex: (index: number, branch?: "else") => boolean;
}) {
    const block = branchProps.block;
    const parentId = () => (branchProps.branch ? `${block.id}:else` : block.id);
    const count = () => branchProps.blocks?.length || 0;

    return (
        <>
            <Show when={count() > 0}>
                <div class="triggerNestedActions">
                    <For each={branchProps.blocks}>
                        {(child, index) => (
                            <>
                                <div
                                    class={`actionInsertLine ${branchProps.isHoverIndex(index(), branchProps.branch) ? "activeHover" : ""}`}
                                    data-drop-parent={parentId()}
                                    data-drop-index={index()}
                                />
                                <div
                                    class="nestedActionWrapper"
                                    onPointerDown={(e) => {
                                        if (e.button === 2) {
                                            e.stopPropagation();
                                            return;
                                        }
                                        if (e.button !== 0) return;
                                        if ((e.target as HTMLElement).closest(".actionInput")) return;
                                        e.stopPropagation();
                                        const target = e.currentTarget as HTMLElement;
                                        const rect = target.getBoundingClientRect();
                                        const grabOffset = {
                                            x: Math.round(e.clientX - rect.left),
                                            y: Math.round(e.clientY - rect.top),
                                        };
                                        block.onStartDragChild?.(child, grabOffset, e);
                                    }}
                                >
                                    <ActionBlock
                                        id={child.id}
                                        action={child.action}
                                        isTrigger={child.isTrigger}
                                        values={child.values}
                                        children={child.children}
                                        elseChildren={child.elseChildren}
                                        iconSrc={child.iconSrc}
                                        static={false}
                                        variableName={child.variableName}
                                        activeDropTarget={block.activeDropTarget}
                                        onContextMenu={block.onContextMenu}
                                        onStartDragChild={block.onStartDragChild}
                                        onValueChange={block.onValueChange}
                                        running={Boolean(child.id && block.runningBlockIds?.().has(child.id))}
                                        runningBlockIds={block.runningBlockIds}
                                        onRequestVariablePicker={block.onRequestVariablePicker}
                                        onRequestOptionPicker={block.onRequestOptionPicker}
                                        activeTargetBlockId={block.activeTargetBlockId}
                                        highlightedSourceBlockId={block.highlightedSourceBlockId}
                                        isVariablePickerOpen={block.isVariablePickerOpen}
                                    />
                                </div>
                            </>
                        )}
                    </For>
                </div>
            </Show>

            <div
                class={`actionDropZone ${branchProps.isHoverIndex(count(), branchProps.branch) ? "activeHover" : ""}`}
                data-drop-parent={parentId()}
                data-drop-index={count()}
            >
                <PaperIcon>add</PaperIcon>
                <span>Drop Actions Here</span>
            </div>
        </>
    );
}
