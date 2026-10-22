const builtins = new Set(["sin","cos","tan","asin","acos","atan","sqrt","abs","exp","ln","log","log10","floor","ceil","sign","min","max","pi","e"]);
/** Normalise subscripts and split implicit products such as kx into single-letter variables. */
export function numericSource(source: string, known: string[] = []): string {
  return source.replace(/([A-Za-z])_\{([^{}]+)\}/g,"$1_$2 ")
    .replace(/(?<![\\A-Za-z_])[A-Za-z][A-Za-z0-9_]*/g, (word,at:string|number,whole:string) => {
      const index=Number(at), before=whole.slice(0,index);
      if ((/\d$/.test(before) && /^e\d*$/i.test(word)) || before.endsWith("\\") || builtins.has(word.toLowerCase()) || word.includes("_") || known.includes(word)) return word;
      return word.length>1 ? word.split("").join("*") : word;
    });
}
export const numericFunctions = builtins;
export const isVariableSymbol = (s: string) => /^[A-Za-z](?:_[A-Za-z0-9]+)?$/.test(s) && !builtins.has(s.toLowerCase()) && !["x","y","z","u","v"].includes(s);
