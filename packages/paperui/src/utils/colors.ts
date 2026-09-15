import { paperRoles, type PaperRole } from "../types";
import { getVarCss } from "./theme";

/**
 * The one place role names become CSS variables. Variant components set
 * these on their root and style with var(--role-base|--role-deep|--role-on),
 * so a new role is added in colors.css and here, and every component picks
 * it up.
 */
export function isPaperRole(value: string | undefined): value is PaperRole {
    return (
        typeof value === "string" &&
        (paperRoles as readonly string[]).includes(value)
    );
}

export interface RoleVars {
    "--role-base": string;
    "--role-deep": string;
    "--role-on": string;
}

export function roleVars(role: PaperRole): RoleVars {
    return {
        "--role-base": getVarCss(role),
        "--role-deep": getVarCss(`${role}-deep`),
        "--role-on": getVarCss("on-color"),
    };
}

/** base color only, for components that tint or border with it */
export function roleBaseVar(role: PaperRole): string {
    return getVarCss(role);
}
