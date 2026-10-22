import { describe, it, expect, vi } from "vitest";
import { newDrawing, defaultStyle, type DrawingCurve, type Vec2 } from "./types";
import { applyDefinition, intersectionObjects } from "./model";
import { resolveGeometry, pointObject } from "./geometry";
import { tangentCandidates } from "./advanced";
import { conicCoefficients } from "./conics";
import { conicIntersections, polynomialRoots } from "./quadratic";
import { presetEquation, sampleCurve } from "./curves";
import { initialTool, toolStep } from "./interaction";
import { roots } from "./constructions";

const curve=(equation:string):DrawingCurve=>({id:crypto.randomUUID(),kind:"curve",name:"c",equation,planeId:"xy",range:[-5,5,-5,5],followView:true,style:defaultStyle()});
const intersections=(a:string,b:string)=>conicIntersections(conicCoefficients(a)!,conicCoefficients(b)!);
const checkTangent=(c:DrawingCurve,p:Vec2,count:number)=>{
  const ts=tangentCandidates(c,p),q=conicCoefficients(c.equation)!;
  expect(ts).toHaveLength(count);
  for(const {point:[x,y],direction:[u,v]} of ts) {
    const [A,B,C,D,E,F]=q;
    expect(A*x*x+B*x*y+C*y*y+D*x+E*y+F).toBeCloseTo(0,6);
    expect((x-p[0])*v-(y-p[1])*u).toBeCloseTo(0,6);
    expect((2*A*x+B*y+D)*u+(B*x+2*C*y+E)*v).toBeCloseTo(0,6);
  }
};

describe("global conic intersections",()=>{
  it("finds the default hyperbola/parabola crossings beyond their stored display rectangle",()=>{
    const d=newDrawing(),preset={h:0,k:0,a:3,b:2,angle:0};
    const a=curve(presetEquation({...preset,type:"hyperbola"})),b=curve(presetEquation({...preset,type:"parabola"}));
    d.objects.push(a,b);
    const points=intersectionObjects(d,a.id,b.id),r=resolveGeometry({...d,objects:[...d.objects,...points]});
    expect(points).toHaveLength(2);
    const x=(13.5+Math.sqrt(218.25))/2,y=Math.sqrt(6*x);
    expect(r.points.get(points[0].id)!.p[0]).toBeCloseTo(x,7);
    expect(r.points.get(points[0].id)!.p[1]).toBeCloseTo(-y,7);
    expect(r.points.get(points[1].id)!.p[1]).toBeCloseTo(y,7);
    expect(x).toBeGreaterThan(5);expect(y).toBeGreaterThan(5);
    expect(intersectionObjects(d,b.id,a.id)).toHaveLength(2);
  });
  it("still respects fixed display ranges and explicit limits",()=>{
    const a=curve("x^2/9-y^2/4=1"),b=curve("y^2=6*x"),d=newDrawing();
    d.objects.push({...a,followView:false},b);
    expect(()=>intersectionObjects(d,a.id,b.id)).toThrow(/没有/);
    const limited={...d,objects:[a,{...b,limits:{yMin:0}}]};
    expect(intersectionObjects(limited,a.id,b.id)).toHaveLength(1);
  });
  for(const [a,b,n] of [
    ["x^2+y^2=4","y=2",1],["x^2+y^2=4","x=2",1],
    ["x^2+y^2=4","x^2/4+y^2=1",2],["x^2+y^2=4","x^2/3+y^2/6=1",4],
    ["y=x^2","y=2*x^2",1],["y=x^2","y=x^2+1",0],
    ["x=y^2","x=2*y^2",1],["x*y=1","x*y=2",0],
    ["x^2+y^2=1","(x-2)^2+y^2=1",1],
    ["y=x^2","y=-x^2+1000",2],
  ] as const)it(`${a} with ${b}: ${n} intersections`,()=>{
    expect(intersections(a,b)).toHaveLength(n);
    expect(intersections(b,a)).toHaveLength(n);
  });
  it("reports overlapping curves",()=>expect(()=>intersections("x^2+y^2=4","2*x^2+2*y^2=8")).toThrow(/重合/));
  it("keeps all four intersections when both axes are mixed and translated",()=>{
    for(const angle of [0,17,45,89,120]) {
      const a=angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
      const x=`(${c}*(x-7)+${s}*(y+9))`,y=`(-${s}*(x-7)+${c}*(y+9))`;
      const points=intersections(`${x}^2+${y}^2=4`,`${x}^2/3+${y}^2/6=1`);
      expect(points).toHaveLength(4);
    }
  });
  it("retains repeated polynomial roots without duplicates",()=>{
    expect(polynomialRoots([4,-4,-3,2,1])).toHaveLength(2); // (x+2)^2*(x-1)^2
    expect(polynomialRoots([4,-4,-3,2,1])[0]).toBeCloseTo(-2,7);
    expect(polynomialRoots([4,-4,-3,2,1])[1]).toBeCloseTo(1,7);
  });
});

describe("responsive tangent construction",()=>{
  for(const [eq,p,n] of [
    ["x^2+y^2=9",[0,0],0],["x^2+y^2=9",[3,0],1],["x^2+y^2=9",[5,0],2],
    ["x^2/9+y^2/4=1",[3,0],1],["x^2/9+y^2/4=1",[10,10],2],
    ["y^2=6*x",[-100,0],2],["y^2=6*x",[0,0],1],["y^2=6*x",[3,0],0],
    ["x^2/9-y^2/4=1",[0,0],0],["x^2/9-y^2/4=1",[3,0],1],
    ["x^2/9-y^2/4=1",[0,4],2],
  ] as [string,Vec2,number][])it(`${eq} through ${p}`,()=>checkTangent(curve(eq),p,n));
  it("finds on-curve and external tangents after rotation and translation",()=>{
    const a=Math.PI/5,c=Math.cos(a),s=Math.sin(a),h=7,k=-9;
    const transform=([x,y]:Vec2):Vec2=>[h+c*x-s*y,k+s*x+c*y];
    for(const type of ["ellipse","parabola","hyperbola"] as const) {
      const q=curve(presetEquation({type,h,k,a:3,b:2,angle:36}));
      checkTangent(q,transform(type==="parabola"?[0,0]:[3,0]),1);
      checkTangent(q,transform(type==="parabola"?[-100,0]:type==="ellipse"?[10,10]:[0,4]),2);
    }
  });
  it("retains small quadratic coefficients for large real circles",()=>{
    checkTangent(curve("x^2+y^2=1000000000000"),[1000000,0],1);
    checkTangent(curve("x^2+y^2=1000000000000"),[2000000,0],2);
    checkTangent(curve("x^2+y^2=10000000000000000"),[100000000,0],1);
  });
  it("deduplicates the periodic endpoint of a parametric circle",()=>{
    const c={...curve("0"),parametric:{x:"cos(t)",y:"sin(t)",tMin:0,tMax:2*Math.PI}};
    // Separate numeric accuracy from OS scheduling; deadlines have their own clock fixture.
    const clock=vi.spyOn(performance,"now").mockReturnValue(0);
    try {
      expect(tangentCandidates(c,[1,0])).toHaveLength(1);
      expect(tangentCandidates(c,[2,0])).toHaveLength(2);
    } finally {clock.mockRestore();}
  });
  it("stops an over-budget one-dimensional search",()=>{
    let now=0;
    const clock=vi.spyOn(performance,"now").mockImplementation(()=>++now);
    try {expect(()=>roots(x=>x-1,-5,5)).toThrow(/超时/);expect(now).toBeLessThan(30);}
    finally {clock.mockRestore();}
  });
  it("merges both tangent branches on the curve and restores them when dragging out",()=>{
    let d=["c:x^2/9+y^2/4=1","P=(5,0)","Tangent(c,P)"].reduce((d,s)=>applyDefinition(d,s),newDrawing());
    const id=d.objects.find(o=>o.symbol==="P")!.id;
    const tangents=d.objects.filter(o=>o.kind==="curve"&&o.derived?.type==="tangent");
    expect(tangents).toHaveLength(2);
    for(const position of [[3,0,0],[100,100,0],[0,0,0],[5,0,0]]) {
      d={...d,objects:d.objects.map(o=>o.id===id?{...o,construction:{type:"free",position}} as typeof o:o)};
      const r=resolveGeometry(d);
      expect(tangents.filter(t=>r.curves.has(t.id))).toHaveLength(position[0]===0?0:2);
    }
  });
  it("draws tangent lines as a clipped segment rather than a marching grid",()=>{
    const c=curve("2*x-3*y=1");
    const sampled=sampleCurve(c,[-5,5,-5,5],240);
    expect(sampled.paths).toHaveLength(1);expect(sampled.paths[0]).toHaveLength(2);
    sampled.paths[0].forEach(([x,y])=>expect(2*x-3*y).toBeCloseTo(1,10));
  });
  it("resolves 240 successive drag positions without a numerical search or lost tangent",()=>{
    const base=["c:x^2/9+y^2/4=1","P=(5,0)","Tangent(c,P)"].reduce((d,s)=>applyDefinition(d,s),newDrawing());
    const id=base.objects.find(o=>o.symbol==="P")!.id;
    const clock=vi.spyOn(performance,"now");
    try {
      for(let i=0;i<240;i++) {
        const a=i*2*Math.PI/240,position=[4.5*Math.cos(a),3*Math.sin(a),0];
        const d={...base,objects:base.objects.map(o=>o.id===id?{...o,construction:{type:"free",position}} as typeof o:o)};
        const r=resolveGeometry(d);
        expect(r.errors.size).toBe(0);
        expect([...r.curves.values()].filter(c=>c.derived?.type==="tangent")).toHaveLength(2);
      }
      // The bounded numerical solvers read the clock; conics must take the algebraic path.
      expect(clock).not.toHaveBeenCalled();
    } finally {clock.mockRestore();}
  });
  it("shares failed intersection searches across all candidate branches",()=>{
    const d=newDrawing(),a=curve("x^4+y^4=1"),b=curve("y=20");d.objects.push(a,b);
    const points=Array.from({length:32},(_,branch)=>({...pointObject("I",[0,0,0]),
      construction:{type:"intersection" as const,first:a.id,second:b.id,branch}}));
    d.objects.push(...points);
    let now=0;
    const clock=vi.spyOn(performance,"now").mockImplementation(()=>++now);
    try {
      const r=resolveGeometry(d);
      expect(points.every(p=>r.errors.get(p.id)?.includes("超时"))).toBe(true);
      expect(()=>intersectionObjects(d,a.id,b.id)).toThrow(/超时/);
      expect(now).toBeLessThan(30);
    }
    finally {clock.mockRestore();}
  });
  it("prompts direct creation after the second selection",()=>{
    expect(toolStep({...initialTool("intersect"),references:["c"]})).toContain("直接创建");
    expect(toolStep({...initialTool("axes"),axisPlane:newDrawing().planes[0]})).not.toContain("确认");
  });
});
