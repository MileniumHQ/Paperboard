// The Functions category: each function's trigger and call blocks, with
// rename and delete beside its name.
import { For, Show } from "solid-js";
import { PaperBadge, PaperButton, PaperEmptyState, PaperIcon, PaperText } from "@mileniumhq/paperui";
import type { ActionInfo } from "@mileniumhq/paperapi";
import { buildCallSchema, buildTriggerSchema, type FunctionDef } from "../../lib/functions";
import LibraryItem, { type LibraryPress } from "./LibraryItem";

export default function FunctionList(props: {
    functions: FunctionDef[];
    shown: FunctionDef[];
    search: string;
    onCreate: () => void;
    onRename: (fn: FunctionDef) => void;
    onDelete: (fn: FunctionDef) => void;
    onPress: LibraryPress;
}) {
    return (
        <>
            <Show when={props.functions.length > 0}>
                <PaperButton fullWidth onClick={props.onCreate}>
                    <PaperIcon>add</PaperIcon>
                    Create Function
                </PaperButton>
            </Show>

            <Show when={props.functions.length === 0}>
                <PaperEmptyState icon="functions" title="No functions yet">
                    <PaperButton size="tiny" onClick={props.onCreate}>
                        <PaperIcon>add</PaperIcon>
                        Create Function
                    </PaperButton>
                </PaperEmptyState>
            </Show>

            <Show when={props.shown.length === 0 && props.functions.length > 0}>
                <PaperEmptyState icon="search_off" title={`No functions matching "${props.search}"`} />
            </Show>

            <For each={props.shown}>
                {(fn) => {
                    const trigSchema = buildTriggerSchema(fn);
                    const callSchema = buildCallSchema(fn);
                    return (
                        <div class="library-function-group">
                            <div class="library-function-header">
                                <div class="library-function-title">
                                    <PaperIcon>functions</PaperIcon>
                                    <PaperText preset="heading">
                                        {fn.name}
                                    </PaperText>
                                    <PaperBadge variant="monochrome">
                                        {fn.params.length}
                                    </PaperBadge>
                                </div>
                                <div class="library-function-actions">
                                    <PaperButton size="tiny"
                                        icon
                                        onClick={() => props.onRename(fn)}
                                        title={`Rename ${fn.name}`}>
                                        <PaperIcon>edit</PaperIcon>
                                    </PaperButton>
                                    <PaperButton size="tiny"
                                        icon
                                        onClick={() => props.onDelete(fn)}
                                        title={`Delete ${fn.name}`}>
                                        <PaperIcon>delete</PaperIcon>
                                    </PaperButton>
                                </div>
                            </div>

                            <PaperText preset="section" class="library-function-caption">
                                Trigger
                            </PaperText>
                            <LibraryItem
                                item={{ panelId: "builtin.function", action: trigSchema.id, schema: trigSchema }}
                                isTrigger={true}
                                onPress={props.onPress}
                            />

                            <PaperText preset="section" class="library-function-caption">
                                Call
                            </PaperText>
                            <LibraryItem
                                item={{ panelId: "builtin.function", action: callSchema.id, schema: callSchema } as ActionInfo}
                                isTrigger={false}
                                onPress={props.onPress}
                            />
                        </div>
                    );
                }}
            </For>
        </>
    );
}
