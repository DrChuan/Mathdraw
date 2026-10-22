import { latexToExpression } from "./latex";
import { numericSource } from "./symbols";
type Ast =
  | { type: "number"; value: number }
  | { type: "variable"; name: string }
  | { type: "unary"; sign: number; value: Ast }
  | { type: "binary"; op: string; left: Ast; right: Ast }
  | { type: "call"; name: string; args: Ast[] };
interface Token {
  text: string;
  at: number;
  type: "number" | "name" | "symbol" | "end";
}
const functions: Record<string, (...args: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log,
  log10: Math.log10,
  floor: Math.floor,
  ceil: Math.ceil,
  sign: Math.sign,
  min: Math.min,
  max: Math.max,
};
/** Small numeric-only Pratt parser. No assignments, objects, property access or JS execution. */
export function parseExpression(
  source: string,
  variables: string[] = ["x", "y", "u", "v"],
): Ast {
  if (source.length > 2048) throw new Error("表达式不能超过 2048 个字符");
  const text = numericSource(latexToExpression(source),variables)
    .replace(/π/g, "pi")
    .replace(/−/g, "-")
    .replace(/×|·/g, "*")
    .replace(/÷/g, "/")
    .replace(/\*\*/g, "^");
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }
    const at = i;
    const num = text.slice(i).match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
    const name = text.slice(i).match(/^[a-zA-Z][a-zA-Z0-9_]*/);
    if (num) {
      tokens.push({ text: num[0], at, type: "number" });
      i += num[0].length;
    } else if (name) {
      tokens.push({ text: name[0], at, type: "name" });
      i += name[0].length;
    } else if ("+-*/^(),".includes(text[i]))
      tokens.push({ text: text[i++], at, type: "symbol" });
    else throw new Error(`第 ${i + 1} 个字符“${text[i]}”无法识别`);
  }
  tokens.push({ text: "", at: text.length, type: "end" });
  let cursor = 0,
    depth = 0,
    nodes = 0;
  const fail = (message: string): never => {
    throw new Error(
      `第 ${tokens[Math.min(cursor, tokens.length - 1)].at + 1} 个字符：${message}`,
    );
  };
  const expression = (minimum = 0): Ast => {
    if (++depth > 64 || ++nodes > 512) fail("表达式过于复杂");
    const token = tokens[cursor++];
    let left!: Ast;
    if (token.type === "number")
      left = { type: "number", value: Number(token.text) };
    else if (token.text === "+" || token.text === "-")
      left = {
        type: "unary",
        sign: token.text === "-" ? -1 : 1,
        value: expression(25),
      };
    else if (token.text === "(") {
      left = expression();
      if (tokens[cursor].text !== ")") fail("缺少右括号");
      cursor++;
    } else if (token.type === "name") {
      const name = token.text.toLowerCase();
      if (variables.includes(token.text)) left = { type: "variable", name: token.text };
      else if (name === "pi" || name === "e")
        left = {
          type: "number",
          value: name === "pi" ? Math.PI : Math.E,
        };
      else if (functions[name]) {
        if (tokens[cursor].text !== "(") fail("函数后需要括号");
        cursor++;
        const args = [expression()];
        while (tokens[cursor].text === ",") {
          cursor++;
          args.push(expression());
        }
        if (tokens[cursor].text !== ")") fail("缺少右括号");
        cursor++;
        if (
          args.length !== (name === "min" || name === "max" ? 2 : 1)
        )
          fail("函数参数数量不正确");
        left = { type: "call", name, args };
      } else if (variables.includes(name)) left = { type: "variable", name };
      else fail(`不支持的变量或函数 ${token.text}`);
    } else fail("需要数字、变量或括号");
    while (true) {
      const next = tokens[cursor];
      let op = next.text,
        implicit = false;
      if (next.type === "number" || next.type === "name" || op === "(") {
        op = "*";
        implicit = true;
      }
      const power =
        op === "+" || op === "-"
          ? 10
          : op === "*" || op === "/"
            ? 20
            : op === "^"
              ? 30
              : -1;
      if (power < minimum) break;
      if (!implicit) cursor++;
      left = {
        type: "binary",
        op,
        left,
        right: expression(op === "^" ? power : power + 1),
      };
    }
    depth--;
    return left!;
  };
  const result = expression();
  if (tokens[cursor].type !== "end") fail("此处有多余内容");
  return result;
}
export function evaluate(ast: Ast, scope: Record<string, number> = {}): number {
  switch (ast.type) {
    case "number":
      return ast.value;
    case "variable":
      return scope[ast.name] ?? NaN;
    case "unary":
      return ast.sign * evaluate(ast.value, scope);
    case "call":
      return functions[ast.name](...ast.args.map((a) => evaluate(a, scope)));
    case "binary": {
      const a = evaluate(ast.left, scope),
        b = evaluate(ast.right, scope);
      switch (ast.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return a / b;
        default:
          return a ** b;
      }
    }
  }
}
export function scalar(source: string) {
  const value = evaluate(parseExpression(source, []));
  if (!Number.isFinite(value) || Math.abs(value) > 1e9)
    throw new Error("请输入有限数值（绝对值不超过 10⁹）");
  return value;
}
export function equation(source: string, parameters: string[] = []) {
  const parts = latexToExpression(source).replace(/＝/g, "=").split("=");
  if (parts.length > 2) throw new Error("一个方程只能有一个等号");
  const lhs = parts.length === 2 ? parts[0].trim() : "",
    rhs = parts.length === 2 ? parts[1] : parts[0];
  if (lhs === "y" || lhs === "v")
    return { type: "y" as const, ast: parseExpression(rhs, ["x", "u", ...parameters]) };
  if (lhs === "x" || lhs === "u")
    return { type: "x" as const, ast: parseExpression(rhs, ["y", "v", ...parameters]) };
  return {
    type: "implicit" as const,
    ast: parseExpression(
      parts.length === 2 ? `(${parts[0]})-(${parts[1]})` : rhs, ["x","y","u","v",...parameters],
    ),
  };
}

/** Recognize an affine equation symbolically, without mistaking a zoomed curve for a line. */
export function isLineEquation(source: string): boolean {
  type Affine = [number, number, number];
  const constant = (v: Affine) => v[0] === 0 && v[1] === 0;
  const scale = (v: Affine, k: number): Affine => v.map(x => x * k) as Affine;
  const affine = (ast: Ast): Affine | null => {
    if (ast.type === "number") return [0, 0, ast.value];
    if (ast.type === "variable") return ["x", "u"].includes(ast.name) ? [1, 0, 0] : [0, 1, 0];
    if (ast.type === "unary") {
      const v = affine(ast.value); return v && scale(v, ast.sign);
    }
    if (ast.type === "call") return ast.args.every(a => { const v = affine(a); return v && constant(v); })
      ? [0, 0, evaluate(ast)] : null;
    const a = affine(ast.left), b = affine(ast.right);
    if (!a || !b) return null;
    if (ast.op === "+" || ast.op === "-") return a.map((v, i) => v + (ast.op === "+" ? 1 : -1) * b[i]) as Affine;
    if (ast.op === "*") return constant(a) ? scale(b, a[2]) : constant(b) ? scale(a, b[2]) : null;
    if (ast.op === "/") return constant(b) && b[2] !== 0 ? scale(a, 1 / b[2]) : null;
    if (constant(b) && b[2] === 1) return a;
    if (constant(b) && b[2] === 0) return [0, 0, 1];
    return constant(a) && constant(b) ? [0, 0, a[2] ** b[2]] : null;
  };
  try {
    const parsed = equation(source), a = affine(parsed.ast);
    if (!a) return false;
    if (parsed.type === "y") a[1] -= 1;
    if (parsed.type === "x") a[0] -= 1;
    return a.every(Number.isFinite) && Math.hypot(a[0], a[1]) > 0;
  } catch { return false; }
}
