// No identifiers: Calculate consumes arithmetic even after variable interpolation.
export const MAX_MATH_EXPRESSION_LENGTH = 4096;
export const MAX_MATH_TOKENS = 1024;
export const MAX_MATH_DEPTH = 64;

type Operator = "+" | "-" | "*" | "/" | "%" | "^" | "(" | ")";
type Token = { kind: "number"; value: number } | { kind: Operator | "end" };

function tokenize(expression: string): Token[] {
    if (expression.length > MAX_MATH_EXPRESSION_LENGTH) {
        throw new Error(`expression length exceeds ${MAX_MATH_EXPRESSION_LENGTH} characters`);
    }
    const tokens: Token[] = [];
    let position = 0;
    while (position < expression.length) {
        const character = expression[position];
        if (/\s/.test(character)) {
            position++;
            continue;
        }
        if (tokens.length >= MAX_MATH_TOKENS) {
            throw new Error(`expression token count exceeds ${MAX_MATH_TOKENS}`);
        }
        const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(expression.slice(position));
        if (number) {
            tokens.push({ kind: "number", value: Number(number[0]) });
            position += number[0].length;
        } else if ("+-*/%^()".includes(character)) {
            tokens.push({ kind: character as Operator });
            position++;
        } else {
            throw new Error(`unexpected character at position ${position + 1}`);
        }
    }
    if (tokens.length === 0) throw new Error("expression is empty");
    tokens.push({ kind: "end" });
    return tokens;
}

/** Decimal arithmetic only; evaluates directly without an AST or object lookup. */
export function evaluateMathExpression(expression: string): number {
    const tokens = tokenize(expression);
    let position = 0;
    const peek = () => tokens[position].kind;

    function sum(depth: number): number {
        let value = product(depth);
        while (peek() === "+" || peek() === "-") {
            const operator = tokens[position++].kind;
            const right = product(depth);
            value = operator === "+" ? value + right : value - right;
        }
        return value;
    }

    function product(depth: number): number {
        let value = unary(depth);
        while (peek() === "*" || peek() === "/" || peek() === "%") {
            const operator = tokens[position++].kind;
            const right = unary(depth);
            if (operator === "*") value *= right;
            else if (operator === "/") value /= right;
            else value %= right;
        }
        return value;
    }

    function unary(depth: number): number {
        // Every recursive edge (sign, power, parentheses) consumes this budget.
        if (depth > MAX_MATH_DEPTH) {
            throw new Error(`expression nesting depth exceeds ${MAX_MATH_DEPTH}`);
        }
        if (peek() === "+" || peek() === "-") {
            const operator = tokens[position++].kind;
            const value = unary(depth + 1);
            return operator === "-" ? -value : value;
        }
        return power(depth);
    }

    function power(depth: number): number {
        const value = primary(depth);
        if (peek() !== "^") return value;
        position++;
        // The RHS includes signs and powers: 2^-2 and 2^3^2 match existing flows.
        return value ** unary(depth + 1);
    }

    function primary(depth: number): number {
        const token = tokens[position];
        if (token.kind === "number") {
            position++;
            return token.value;
        }
        if (token.kind === "(") {
            position++;
            const value = sum(depth + 1);
            if (peek() !== ")") throw new Error("expected closing parenthesis");
            position++;
            return value;
        }
        throw new Error("expected a number or opening parenthesis");
    }

    const result = sum(0);
    if (peek() !== "end") throw new Error("unexpected token after expression");
    if (!Number.isFinite(result)) throw new Error("expression did not evaluate to a finite number");
    return result;
}
