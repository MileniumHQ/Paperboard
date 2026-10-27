// What the variable picker offers a field: every value a flow has produced
// by the time it reaches that field. Pure, so the ordering and naming rules
// are tested without a canvas.
import { typeInfo } from "./typeCatalog";
import { variableFieldIcon } from "./variableTypes";
import { filterPickerItems } from "./variablePicker";
import { type CanvasBlock, blockVariableName, findBlock } from "./tree";
import { type FunctionDef, functionIdFromTriggerAction } from "./functions";

export interface PickerVariable {
    id: string;
    label: string;
    sourceBlockId: string;
    sourceName: string;
    icon?: string;
    type?: string;
    typeName?: string;
}

interface TriggerFieldInfo {
    type: string;
    label?: string;
    typeName?: string;
    icon?: string;
}
type TriggerFieldMap = Record<string, TriggerFieldInfo>;

export function typedTriggerFields(action: any): TriggerFieldMap | null {
    if (!action || typeof action !== "object") return null;
    // trigger schemas can carry typed output fields directly; the label
    // travels with the field so the picker can name it
    if (
        action.outputFields &&
        typeof action.outputFields === "object" &&
        Object.keys(action.outputFields).length > 0
    ) {
        const map: TriggerFieldMap = {};
        for (const [fieldId, v] of Object.entries<any>(action.outputFields)) {
            map[fieldId] =
                typeof v === "string"
                    ? { type: v }
                    : {
                          type: v?.type || "any",
                          label: v?.label,
                          typeName: v?.typeName,
                          icon: v?.icon,
                      };
        }
        return map;
    }
    // typed output defined with the PaperAPI schema DSL: derive fields
    // from the registered custom type
    const outType =
        typeof action.output === "string" ? action.output : action.output?.type;
    if (outType) {
        const def = typeInfo(outType);
        if (def?.fields && Object.keys(def.fields).length > 0) {
            const map: TriggerFieldMap = {};
            for (const [fieldId, f] of Object.entries(def.fields)) {
                map[fieldId] = { type: String(f.type), label: f.label };
            }
            return map;
        }
    }
    return null;
}

function functionTriggerFields(functions: FunctionDef[], actionId: string): TriggerFieldMap | null {
    const fid = functionIdFromTriggerAction(actionId);
    if (!fid) return null;
    const def = functions.find((f) => f.id === fid);
    if (!def) return null;
    const map: TriggerFieldMap = {};
    for (const p of def.params) map[p.name] = { type: p.type, label: p.name };
    return map;
}

/**
 * The variables a field on `blockId` can use, in flow order: its trigger's
 * fields, every earlier action's output, and the names earlier Set Variable
 * blocks assigned. Repeated labels are numbered; `expectedType` narrows the
 * list to values the field accepts.
 */
export function variablesBefore(
    blocks: CanvasBlock[],
    blockId: string,
    functions: FunctionDef[],
    expectedType?: string,
): PickerVariable[] {
    const available: PickerVariable[] = [];

    for (const trig of blocks) {
        if (trig.id === blockId) {
            break;
        }
        if (!findBlock([trig], blockId)) {
            continue;
        }

        const trigActionId = (trig.action as any)?.id || "";
        const fieldTypes =
            functionTriggerFields(functions, trigActionId) ||
            (() => {
                const typed = typedTriggerFields(trig.action);
                if (!typed) {
                    console.debug(
                        `[actions] trigger "${trigActionId}" exposes no typed field metadata; variable picker offers only the trigger output`,
                    );
                }
                return typed;
            })();
        if (fieldTypes) {
            for (const [fieldId, field] of Object.entries(fieldTypes)) {
                const def = typeInfo(field.type);
                available.push({
                    id: fieldId,
                    label:
                        field.label ||
                        def?.name ||
                        fieldId.charAt(0).toUpperCase() + fieldId.slice(1),
                    sourceBlockId: trig.id,
                    sourceName: trig.action.name,
                    // resolved once, here: the picker displays this icon
                    // and the inserted chip stores the very same one
                    icon: variableFieldIcon(field.type, field.icon),
                    type: field.type,
                    typeName: field.typeName,
                });
            }
        }

        const trigOutput = trig.action.output;
        // a trigger with typed fields exposes those instead of one opaque
        // output, so the picker never offers "Command Data" next to them
        const hasTypedFields =
            fieldTypes !== null && Object.keys(fieldTypes).length > 0;
        if (trigOutput && !hasTypedFields) {
            const label =
                typeof trigOutput === "string"
                    ? trigOutput
                    : (trigOutput as any).label || (trigOutput as any).type || "Output";
            const id =
                typeof trigOutput === "string"
                    ? trigOutput
                    : (trigOutput as any).type || "output";
            const outType =
                typeof trigOutput === "string"
                    ? trigOutput
                    : (trigOutput as any).type || "any";

            available.push({
                id,
                label: label.charAt(0).toUpperCase() + label.slice(1),
                sourceBlockId: trig.id,
                sourceName: trig.action.name,
                icon: trig.action.icon || "bolt",
                type: outType,
            });

            if (id === "message" || (trig.action as any).id === "chat-message") {
                available.push({
                    id: "message.sender",
                    label: "Sender",
                    sourceBlockId: trig.id,
                    sourceName: trig.action.name,
                    icon: "person",
                    type: "string",
                });
            }
        }

        const pushActionOutput = (child: CanvasBlock) => {
            const out = child.action.output;
            if (!out) return;
            available.push({
                id: child.id,
                label: blockVariableName(child) || "Result",
                sourceBlockId: child.id,
                sourceName: child.action.name,
                icon: child.action.icon || "terminal",
                type: typeof out === "string" ? out : (out as any).type || "any",
            });
        };
        // names assigned by Set/Increment Variable blocks are picker
        // items too: a stored name resolves against the live variable
        // store at run time. Only literal names qualify — a key that is
        // itself a reference cannot be listed. Clears drop the name again
        // so a deleted variable is not offered.
        const namedVariables = new Map<string, PickerVariable>();
        const pushNamedVariable = (child: CanvasBlock) => {
            const actionId = (child.action as any)?.id || "";
            const rawKey = (child.values as any)?.key;
            const name = typeof rawKey === "string" ? rawKey.trim() : "";
            if (actionId === "clear-variable") {
                if (name) namedVariables.delete(name);
                return;
            }
            if (actionId !== "set-variable" && actionId !== "increment-variable") return;
            if (!name || name.includes("{{") || name.includes("}}")) return;
            namedVariables.set(name, {
                id: name,
                label: name,
                sourceBlockId: child.id,
                sourceName: child.action.name,
                icon: "data_object",
                type: "string",
            });
        };
        const visitInOrder = (list: CanvasBlock[]): boolean => {
            for (const child of list) {
                if (child.id === blockId) return true;
                pushActionOutput(child);
                pushNamedVariable(child);
                if (child.children && visitInOrder(child.children)) return true;
                if (child.elseChildren && visitInOrder(child.elseChildren)) return true;
            }
            return false;
        };
        visitInOrder(trig.children || []);
        for (const item of namedVariables.values()) available.push(item);
        break;
    }

    const labelCounts = new Map<string, number>();
    for (const v of available) {
        const k = v.label.toLowerCase();
        labelCounts.set(k, (labelCounts.get(k) || 0) + 1);
    }
    const labelSeen = new Map<string, number>();
    for (const v of available) {
        const k = v.label.toLowerCase();
        if ((labelCounts.get(k) || 0) > 1) {
            const n = (labelSeen.get(k) || 0) + 1;
            labelSeen.set(k, n);
            v.label = `${v.label} ${n}`;
        }
    }

    return filterPickerItems(available, expectedType);
}
