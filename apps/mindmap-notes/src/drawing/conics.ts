import { equation, evaluate, type parseExpression } from "./expression";
import type { Vec2, DrawingCurve } from "./types";
import { presetEquation } from "./curves";
type Ast = ReturnType<typeof parseExpression>;
type Polynomial = Map<string, number>;
const key = (x: number, y: number) => `${x},${y}`;
const constant = (n: number): Polynomial => new Map([["0,0", n]]);
const scale = (a: Polynomial, k: number) => new Map([...a].map(([p, n]) => [p, n * k]));
function polynomial(ast: Ast): Polynomial | null {
  if (ast.type === "number") return constant(ast.value);
  if (ast.type === "variable") return new Map([[key(["x", "u"].includes(ast.name) ? 1 : 0,
    ["y", "v"].includes(ast.name) ? 1 : 0), 1]]);
  if (ast.type === "unary") { const a = polynomial(ast.value); return a && scale(a, ast.sign); }
  if (ast.type === "call") return ast.args.every(a => { const p = polynomial(a); return p && [...p.keys()].every(k => k === "0,0"); })
    ? constant(evaluate(ast)) : null;
  const a = polynomial(ast.left), b = polynomial(ast.right);
  if (!a || !b) return null;
  if (ast.op === "+" || ast.op === "-") {
    const result = new Map(a);
    for (const [k, v] of b) result.set(k, (result.get(k) ?? 0) + (ast.op === "+" ? v : -v));
    return result;
  }
  if (ast.op === "/") return [...b.keys()].every(k => k === "0,0") && b.get("0,0") !== 0
    ? scale(a, 1 / b.get("0,0")!) : null;
  const multiply = (a: Polynomial, b: Polynomial): Polynomial | null => {
    const result: Polynomial = new Map();
    for (const [ka, va] of a) for (const [kb, vb] of b) {
      if (va === 0 || vb === 0) continue;
      const pa = ka.split(",").map(Number), pb = kb.split(",").map(Number), x = pa[0] + pb[0], y = pa[1] + pb[1];
      if (x + y > 2) return null;
      const k = key(x,y); result.set(k, (result.get(k) ?? 0) + va * vb);
    }
    return result;
  };
  if (ast.op === "*") return multiply(a,b);
  if ([...b.keys()].some(k => k !== "0,0")) return null;
  const power = b.get("0,0");
  if (power === 0) return constant(1);
  if (power === 1) return a;
  if (power === 2) return multiply(a,a);
  return [...a.keys()].every(k => k === "0,0") ? constant(evaluate(ast)) : null;
}
/** Coefficients of A*x²+B*x*y+C*y²+D*x+E*y+F=0, including lines. */
export function conicCoefficients(source: string): [number,number,number,number,number,number] | null {
  const parsed = equation(source), p = polynomial(parsed.ast);
  if (!p) return null;
  if (parsed.type !== "implicit") {
    const k = parsed.type === "y" ? "0,1" : "1,0";
    p.set(k, (p.get(k) ?? 0) - 1);
  }
  const values = ["2,0","1,1","0,2","1,0","0,1","0,0"].map(k => p.get(k) ?? 0);
  const size = Math.max(...values.map(Math.abs));
  return size > 0 && Number.isFinite(size)
    ? values.map(v => v / size) as [number,number,number,number,number,number] : null;
}
/** Circle centre in the equation's local plane, excluding imaginary or point circles. */
export function circleCenter(source: string): Vec2 | null {
  try {
    const parsed = equation(source), p = polynomial(parsed.ast);
    if (!p) return null;
    if (parsed.type !== "implicit") {
      const k = parsed.type === "y" ? "0,1" : "1,0";
      p.set(k,(p.get(k) ?? 0)-1);
    }
    const A=p.get("2,0") ?? 0, B=p.get("1,1") ?? 0, C=p.get("0,2") ?? 0;
    const D=p.get("1,0") ?? 0, E=p.get("0,1") ?? 0, F=p.get("0,0") ?? 0;
    const scale = Math.max(Math.abs(A),Math.abs(C));
    if (scale < 1e-14 || Math.abs(A-C) > scale*1e-9 || Math.abs(B) > scale*1e-9) return null;
    const center: Vec2 = [-D/(2*A),-E/(2*C)];
    const r2 = center[0]**2+center[1]**2-F/A;
    return r2 > 1e-12 && center.every(v => Number.isFinite(v) && Math.abs(v)<=1e9) ? center : null;
  } catch { return null; }
}
/** Foci of a real, nondegenerate quadratic equation in its local plane. */
export function conicFoci(source: string, preset?: DrawingCurve["preset"]): Vec2[] | null {
  if (circleCenter(source)) return null;
  try {
    const parsed = equation(source), p = polynomial(parsed.ast);
    if (!p) return null;
    if (parsed.type !== "implicit") {
      const k = parsed.type === "y" ? "0,1" : "1,0";
      p.set(k, (p.get(k) ?? 0) - 1);
    }
    let A = p.get("2,0") ?? 0, B = p.get("1,1") ?? 0, C = p.get("0,2") ?? 0;
    let D = p.get("1,0") ?? 0, E = p.get("0,1") ?? 0, F = p.get("0,0") ?? 0;
    const size = Math.max(Math.abs(A), Math.abs(B), Math.abs(C));
    if (!Number.isFinite(size) || size < 1e-14) return null;
    [A,B,C,D,E,F] = [A,B,C,D,E,F].map(v => v / size);
    const angle = .5 * Math.atan2(B, A - C), c = Math.cos(angle), s = Math.sin(angle);
    const delta = Math.hypot(A - C, B), l1 = (A + C + delta) / 2, l2 = (A + C - delta) / 2;
    const d1 = D*c + E*s, d2 = -D*s + E*c;
    const world = (u: number, v: number): Vec2 => [c*u - s*v, s*u + c*v];
    let result: Vec2[];
    if (Math.abs(l1) > 1e-10 && Math.abs(l2) > 1e-10) {
      const u = -d1/(2*l1), v = -d2/(2*l2), K = -F + d1*d1/(4*l1) + d2*d2/(4*l2);
      const r1 = K/l1, r2 = K/l2;
      if (l1*l2 > 0) {
        if (r1 <= 0 || r2 <= 0) return null;
        const f = Math.sqrt(Math.abs(r1-r2));
        result = r1 >= r2 ? [world(u-f,v),world(u+f,v)] : [world(u,v-f),world(u,v+f)];
      } else {
        if (Math.abs(K) < 1e-12) return null;
        const f = Math.sqrt(Math.abs(r1)+Math.abs(r2));
        result = r1 > 0 ? [world(u-f,v),world(u+f,v)] : [world(u,v-f),world(u,v+f)];
      }
    } else if (Math.abs(l1) > 1e-10 && Math.abs(d2) > 1e-12) {
      result = [world(-d1/(2*l1), -(F-d1*d1/(4*l1))/d2 - d2/(4*l1))];
    } else if (Math.abs(l2) > 1e-10 && Math.abs(d1) > 1e-12) {
      result = [world(-(F-d2*d2/(4*l2))/d1 - d1/(4*l2), -d2/(2*l2))];
    } else return null;
    if (!result.every(p => p.every(n => Number.isFinite(n) && Math.abs(n) <= 1e9))) return null;
    if (result.length === 2) {
      if (preset && source.replace(/\s/g, "") === presetEquation(preset).replace(/\s/g, "")) {
        const angle = (preset.angle + (preset.type === "ellipse" && preset.b > preset.a ? 90 : 0)) * Math.PI / 180;
        if ((result[0][0]-result[1][0])*Math.cos(angle)+(result[0][1]-result[1][1])*Math.sin(angle) > 1e-8) result.reverse();
      } else if (result[0][0]-result[1][0] > 1e-8 ||
        (Math.abs(result[0][0]-result[1][0]) <= 1e-8 && result[0][1] > result[1][1])) result.reverse();
    }
    return result;
  } catch { return null; }
}

/** Parametrize a nondegenerate conic; hyperbolas retain the branch containing the driver. */
export function conicPath(curve:DrawingCurve,seed:Vec2):DrawingCurve["parametric"]|null {
  try {
    const parsed=equation(curve.equation),p=polynomial(parsed.ast);if(!p)return null;
    if(parsed.type!=="implicit"){const k=parsed.type==="y"?"0,1":"1,0";p.set(k,(p.get(k)??0)-1);}
    let [A,B,C,D,E,F]=["2,0","1,1","0,2","1,0","0,1","0,0"].map(k=>p.get(k)??0);
    const size=Math.max(Math.abs(A),Math.abs(B),Math.abs(C));if(size<1e-14)return null;
    [A,B,C,D,E,F]=[A,B,C,D,E,F].map(v=>v/size);
    const angle=.5*Math.atan2(B,A-C),c=Math.cos(angle),s=Math.sin(angle),delta=Math.hypot(A-C,B),l1=(A+C+delta)/2,l2=(A+C-delta)/2,d1=D*c+E*s,d2=-D*s+E*c;
    const n=(x:number)=>String(Math.abs(x)<1e-14?0:Number(x.toPrecision(15)));
    const world=(u:string,v:string,tMin:number,tMax:number)=>({x:`(${n(c)}*(${u})-${n(s)}*(${v}))`,y:`(${n(s)}*(${u})+${n(c)}*(${v}))`,tMin,tMax});
    const corners=[[curve.range[0],curve.range[2]],[curve.range[0],curve.range[3]],[curve.range[1],curve.range[2]],[curve.range[1],curve.range[3]]];
    if(Math.abs(l1)>1e-10&&Math.abs(l2)>1e-10){
      const u=-d1/(2*l1),v=-d2/(2*l2),K=-F+d1*d1/(4*l1)+d2*d2/(4*l2),r1=K/l1,r2=K/l2;
      if(l1*l2>0){if(r1<=0||r2<=0)return null;return world(`${n(u)}+${n(Math.sqrt(r1))}*cos(t)`,`${n(v)}+${n(Math.sqrt(r2))}*sin(t)`,0,2*Math.PI);}
      if(Math.abs(K)<1e-12)return null;
      const su=c*seed[0]+s*seed[1]-u,sv=-s*seed[0]+c*seed[1]-v;
      const extent=Math.min(10,Math.max(2,Math.asinh(Math.max(...corners.map(([x,y])=>Math.hypot(c*x+s*y-u,-s*x+c*y-v)))/Math.sqrt(Math.min(Math.abs(r1),Math.abs(r2))))+1));
      const ch="((exp(t)+exp(-t))/2)",sh="((exp(t)-exp(-t))/2)";
      return r1>0?world(`${n(u)}+${n((su<0?-1:1)*Math.sqrt(r1))}*${ch}`,`${n(v)}+${n(Math.sqrt(-r2))}*${sh}`,-extent,extent):world(`${n(u)}+${n(Math.sqrt(-r1))}*${sh}`,`${n(v)}+${n((sv<0?-1:1)*Math.sqrt(r2))}*${ch}`,-extent,extent);
    }
    if(Math.abs(l1)>1e-10&&Math.abs(d2)>1e-12){const ts=corners.map(([x,y])=>c*x+s*y);return world("t",`(-(${n(l1)}*t^2+${n(d1)}*t+${n(F)}))/(${n(d2)})`,Math.min(...ts),Math.max(...ts));}
    if(Math.abs(l2)>1e-10&&Math.abs(d1)>1e-12){const ts=corners.map(([x,y])=>-s*x+c*y);return world(`(-(${n(l2)}*t^2+${n(d2)}*t+${n(F)}))/(${n(d1)})`,"t",Math.min(...ts),Math.max(...ts));}
    return null;
  }catch{return null;}
}
