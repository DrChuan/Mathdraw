/** Translate the supported numeric LaTeX grammar to the restricted numeric parser. */
export function latexToExpression(source: string): string {
  if (source.length > 2048) throw new Error("表达式不能超过 2048 个字符");
  const text = source
    .trim()
    .replace(/^\$\$?|\$\$?$/g, "")
    .replace(/\\(?:left|right|displaystyle)\b/g, "")
    .replace(/\\[,;! ]/g, " ")
    .replace(/\\(?:cdot|times)\b/g, "*")
    .replace(/\\div\b/g, "/")
    .replace(/\\pi\b/g, "pi")
    .replace(/\\(?:lvert|rvert|vert)\b/g, "|");
  let i = 0,
    depth = 0;
  const skip = () => {
    while (/\s/.test(text[i] ?? "") && i < text.length) i++;
  };
  const group = (): string => {
    skip();
    if (++depth > 64) throw new Error("LaTeX 嵌套过深");
    let result: string;
    if (text[i] === "{") {
      i++;
      result = sequence("}");
      if (text[i++] !== "}") throw new Error("缺少 } ");
    } else if (text[i] === "(") {
      i++;
      result = sequence(")");
      if (text[i++] !== ")") throw new Error("缺少 )");
    } else if (text[i] === "\\") result = command();
    else {
      const m = text.slice(i).match(/^(?:\d+\.?\d*|\.\d+|[A-Za-z][A-Za-z0-9_]*)/);
      if (!m) throw new Error(`第 ${i + 1} 个字符：需要公式参数`);
      result = m[0];
      i += result.length;
    }
    depth--;
    return result;
  };
  const command = (): string => {
    const m = text.slice(i).match(/^\\([a-zA-Z]+)/);
    if (!m) throw new Error(`第 ${i + 1} 个字符：无效命令`);
    const name = m[1];
    i += m[0].length;
    if (["frac", "dfrac", "tfrac"].includes(name))
      return `((${group()})/(${group()}))`;
    if (name === "sqrt") {
      skip();
      let root = "2";
      if (text[i] === "[") {
        i++;
        root = sequence("]");
        if (text[i++] !== "]") throw new Error("缺少 ]");
      }
      return `((${group()})^(1/(${root})))`;
    }
    if (
      [
        "sin",
        "cos",
        "tan",
        "arcsin",
        "arccos",
        "arctan",
        "ln",
        "log",
        "exp",
        "abs",
      ].includes(name)
    ) {
      skip();
      let power: string | undefined;
      if (text[i] === "^") {
        i++;
        power = group();
      }
      const arg = group(),
        fn = name.replace("arc", "a");
      return power ? `((${fn}(${arg}))^(${power}))` : `${fn}(${arg})`;
    }
    throw new Error(`不支持的 LaTeX 命令 \\${name}`);
  };
  const sequence = (stop = ""): string => {
    let out = "";
    while (i < text.length && (!stop || text[i] !== stop)) {
      if (text[i] === "\\") out += command();
      else if (text[i] === "{") out += `(${group()})`;
      else if (text[i] === "|") {
        i++;
        const arg = sequence("|");
        if (text[i++] !== "|") throw new Error("绝对值缺少右侧 | ");
        out += `abs(${arg})`;
      } else out += text[i++];
    }
    return out;
  };
  return sequence();
}
