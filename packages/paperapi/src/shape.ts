// The shapes a value is checked against: what a panel's contract (contract.ts)
// and the daemon's protocol (protocol/) are both written in.
import { describeValue, valueProblem } from "./blocksSchema";
import { errorMessage } from "./errors";

// ─── Shapes ─────────────────────────────────────────────────────────────────

/**
 * What a value must be. `check` gives why `value` isn't, or null: `at` names
 * where it sits, and `strict` refuses an object a field its shape doesn't
 * name (what a call is given is strict; what it answers may carry more, as a
 * TypeScript value may).
 */
export interface Shape<T> {
    readonly check: (value: unknown, at: string, strict: boolean) => string | null;
    /** only carries T for Infer; never set */
    readonly __type?: T;
}

/** An object field that may be left out. */
export interface OptionalShape<T> {
    readonly optional: Shape<T>;
}

/** The TypeScript type a shape describes. */
export type Infer<S> = S extends Shape<infer T> ? T : S extends OptionalShape<infer T> ? T | undefined : never;

export type Fields = Record<string, Shape<any> | OptionalShape<any>>;
/** An object's shape, with its fields: what a contract's scope and state are made of. */
export interface ObjectShape<F extends Fields = Fields> extends Shape<ObjectOf<F>> {
    readonly fields: F;
}
type Flat<T> = { [K in keyof T]: T[K] } & {};
export type ObjectOf<F extends Fields> = Flat<
    { [K in keyof F as F[K] extends OptionalShape<any> ? never : K]: Infer<F[K]> } & {
        [K in keyof F as F[K] extends OptionalShape<any> ? K : never]?: F[K] extends OptionalShape<infer T> ? T : never;
    }
>;

const noTypes = () => undefined;
const where = (at: string) => (at ? `the field "${at}"` : "the value");
const fail = (at: string, problem: string) => `${where(at)}: ${problem}`;
const core = (ref: "text" | "number" | "boolean" | "any"): Shape<any> => ({
    check: (value, at) => {
        const problem = valueProblem(ref, value, noTypes);
        return problem ? fail(at, problem) : null;
    },
});
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
const field = (at: string, key: string) => (at ? `${at}.${key}` : key);

/**
 * The shapes a contract is written in. A value travels as JSON, so these are
 * JSON's: text, numbers, true/false, lists, objects, and nothing.
 */
export const shape = {
    text: (): Shape<string> => core("text"),
    /** a finite number */
    number: (): Shape<number> => core("number"),
    boolean: (): Shape<boolean> => core("boolean"),
    /** any JSON value the receiver reads itself: a saved document whose own reader checks it */
    json: (): Shape<unknown> => core("any"),
    /**
     * A value the panel's own reader checks: a saved document whose reader
     * throws, saying why, when the value is not one. The value travels as it
     * is; what the reader gives back is not used.
     */
    read: <T>(reader: (value: unknown) => T): Shape<T> => ({
        check: (value, at) => {
            let problem: string | null = null;
            try {
                reader(value);
            } catch (err) {
                // quiet: the reader's reason is the problem, which the caller is refused with
                problem = fail(at, errorMessage(err));
            }
            return problem;
        },
    }),
    /** what a call that gives nothing back answers */
    nothing: (): Shape<void> => ({
        check: (value, at) => (value === undefined || value === null ? null : fail(at, `expected nothing, got ${describeValue(value)}`)),
    }),
    /** exactly one of these texts, numbers or true/false */
    oneOf: <const V extends readonly (string | number | boolean)[]>(...values: V): Shape<V[number]> => ({
        check: (value, at) =>
            values.includes(value as V[number])
                ? null
                : fail(at, `expected ${values.map((v) => JSON.stringify(v)).join(" or ")}, got ${describeValue(value)}`),
    }),
    list: <T>(item: Shape<T>): Shape<T[]> => ({
        check: (value, at, strict) => {
            if (!Array.isArray(value)) return fail(at, `expected a list, got ${describeValue(value)}`);
            for (let i = 0; i < value.length; i++) {
                const problem = item.check(value[i], `${at}[${i}]`, strict);
                if (problem) return problem;
            }
            return null;
        },
    }),
    object: <F extends Fields>(fields: F): ObjectShape<F> => ({
        fields,
        check: (value, at, strict) => objectProblem(fields, value, at, strict),
    }),
    /** text keys, each to a value of one shape */
    record: <T>(entry: Shape<T>): Shape<Record<string, T>> => ({
        check: (value, at, strict) => {
            if (!isRecord(value)) return fail(at, `expected an object, got ${describeValue(value)}`);
            for (const [key, v] of Object.entries(value)) {
                const problem = entry.check(v, field(at, key), strict);
                if (problem) return problem;
            }
            return null;
        },
    }),
    /** the value, or null */
    nullable: <T>(inner: Shape<T>): Shape<T | null> => ({
        check: (value, at, strict) => (value === null ? null : inner.check(value, at, strict)),
    }),
    /** a value that is one of these shapes: the first that fits */
    either: <S extends Shape<any>[]>(...shapes: S): Shape<Infer<S[number]>> => ({
        check: (value, at, strict) => {
            const problems: string[] = [];
            for (const s of shapes) {
                const problem = s.check(value, at, strict);
                if (!problem) return null;
                problems.push(problem);
            }
            return problems.join(", or ");
        },
    }),
    /** an object field that may be left out */
    optional: <T>(inner: Shape<T>): OptionalShape<T> => ({ optional: inner }),
};

function objectProblem(fields: Fields, value: unknown, at: string, strict: boolean): string | null {
    if (!isRecord(value)) return fail(at, `expected an object, got ${describeValue(value)}`);
    if (strict) {
        for (const key of Object.keys(value)) {
            if (!Object.hasOwn(fields, key)) return `there is no field "${field(at, key)}"`;
        }
    }
    for (const [key, def] of Object.entries(fields)) {
        const v = value[key];
        if ("optional" in def) {
            if (v === undefined) continue;
            const problem = def.optional.check(v, field(at, key), strict);
            if (problem) return problem;
            continue;
        }
        if (v === undefined) return `${where(field(at, key))} is missing`;
        const problem = def.check(v, field(at, key), strict);
        if (problem) return problem;
    }
    return null;
}
