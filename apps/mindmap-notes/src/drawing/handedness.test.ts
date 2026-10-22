import { describe,it,expect } from "vitest";
import { newDrawing, type Vec3 } from "./types";
import { add,mul,dot,cross,unit,rotate,project,viewRay,unprojectOnPlane,coordinateAxis,
  frameFromDirections,planeFromPoints,validateDrawing,resolveGeometry,pointObject } from "./geometry";
import { sceneFor } from "./scene";
import { screenPoint,hitTest,toolHits,initialTool } from "./interaction";
import { normalizeDrawing,solidObject } from "./model";
import { axisId } from "./axes";

const close=(a:number[],b:number[])=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],8));
const basis:Vec3[]=[[1,0,0],[0,1,0],[0,0,1]];
const spatial=()=>{const d=newDrawing();d.dimension="3d";d.view.mode="space";return d;};

describe("right-handed space projection",()=>{
  it("shows default x down-left, y down-right and z up",()=>{
    const d=spatial(),[x,y,z]=basis.map(p=>project(p,d));
    expect(x[0]).toBeLessThan(0);expect(x[1]).toBeGreaterThan(0);
    expect(y[0]).toBeGreaterThan(0);expect(y[1]).toBeGreaterThan(0);
    close(z,[0,-Math.sqrt(2/3)]);
    close(cross(coordinateAxis(d,"x").direction,coordinateAxis(d,"y").direction),coordinateAxis(d,"z").direction);
  });
  for(const projection of ["orthographic","oblique"] as const) {
    it(`${projection}: screen right × screen up points toward the viewer at every rotation`,()=>{
      const d=spatial();d.view.projection=projection;
      for(const angle of [-180,-90,-35,0,15,45,90,180]) {
        d.view.angle=angle;
        const columns=basis.map(p=>project(p,d));
        const right=columns.map(p=>p[0]) as Vec3,up=columns.map(p=>-p[1]) as Vec3;
        close(unit(cross(right,up)),viewRay(d));
        close(project(add([2,3,4],mul(viewRay(d),20)),d),project([2,3,4],d));
      }
    });
    it(`${projection}: dragging in a tilted workplane inverts the same projection`,()=>{
      const d=spatial();d.view.projection=projection;
      const p=planeFromPoints([1,2,3],[3,2,4],[1,4,3],"tilted");
      d.planes.push(p);d.view.planeId=p.id;
      for(const angle of [-120,-30,0,40,125]) {
        d.view.angle=angle;
        const original=add(p.origin,[0,0,2]),wanted=add(original,add(mul(p.u,2),mul(p.v,-3)));
        close(unprojectOnPlane(project(wanted,d),original,d),wanted);
      }
    });
  }
  it("renders axis arrows in the projected positive directions",()=>{
    const d=spatial(),size:[number,number]=[1000,700],origin=screenPoint(d,size,[0,0,0]);
    const scene=sceneFor(d,[],size);
    for(const axis of ["x","y","z"] as const) {
      const path=scene.paths.find(p=>p.id===axisId(axis))!;
      const end=path.points.at(-1)!,unitEnd=screenPoint(d,size,coordinateAxis(d,axis).direction);
      expect((end[0]-origin[0])*(unitEnd[0]-origin[0])+(end[1]-origin[1])*(unitEnd[1]-origin[1])).toBeGreaterThan(0);
      expect(path.arrow).toBe(true);
    }
  });
});

describe("manual coordinate frames",()=>{
  it("selects the face under an axis instead of letting the axis intercept it",()=>{
    const d=spatial(),size:[number,number]=[1000,700];d.objects.push(solidObject("cube"));
    const hits=hitTest(d,[],size,screenPoint(d,size,[0,1,0]),true);
    expect(hits.some(h=>h.kind==="edge"&&h.id===axisId("y"))).toBe(true);
    const faces=toolHits({...initialTool("axes"),points:["O","X"]},hits);
    expect(faces.length).toBeGreaterThan(0);expect(faces.every(h=>h.kind==="face")).toBe(true);
    const choosingY={...initialTool("axes"),points:["O","X"],axisPlane:d.planes[0]};
    expect(toolHits(choosingY,hits).every(h=>h.kind==="point")).toBe(true);
  });
  it("uses the selected y half-plane and derives a right-handed z",()=>{
    const origin:Vec3=[2,3,4],plane=planeFromPoints(origin,add(origin,[0,1,0]),add(origin,[1,0,0]),"reversed normal");
    const f=frameFromDirections(origin,add(origin,[0,2,0]),add(origin,[3,5,0]),plane);
    close(f.x,[0,1,0]);close(f.y,[1,0,0]);expect(f.zSign).toBe(1);
    close(cross(f.x,f.y),[0,0,-1]);
    expect(dot(cross(f.x,f.y),coordinateAxis({...spatial(),coordinateFrame:f},"z").direction)).toBeCloseTo(1);
    const other=frameFromDirections(origin,add(origin,[0,2,0]),add(origin,[-3,5,0]),plane);
    close(other.y,[-1,0,0]);close(cross(other.x,other.y),[0,0,1]);
  });
  it("keeps its orientation on an arbitrarily tilted face and after saving",()=>{
    const origin:Vec3=[1,-2,3],x=rotate([1,0,0],[25,33,17]),y=rotate([0,1,0],[25,33,17]);
    const plane=planeFromPoints(origin,add(origin,x),add(origin,y),"face");
    const f=frameFromDirections(origin,add(origin,mul(x,3)),add(origin,add(mul(x,4),mul(y,2))),plane);
    close(f.x,x);close(f.y,y);expect(dot(cross(f.x,f.y),cross(x,y))).toBeCloseTo(1);
    const d=spatial();d.coordinateFrame=f;
    expect(validateDrawing(d)).toBe(d);
    const restored=normalizeDrawing(JSON.parse(JSON.stringify(d)));
    for(const axis of ["x","y","z"] as const)close(coordinateAxis(restored,axis).direction,coordinateAxis(d,axis).direction);
    close(resolveGeometry(restored).points.get(restored.objects[0].id)!.p,origin);
  });
  it("uses the manual basis for axis-constrained points",()=>{
    const d=spatial(),o:Vec3=[2,3,4],plane=planeFromPoints(o,add(o,[0,1,0]),add(o,[1,0,0]),"face");
    d.coordinateFrame=frameFromDirections(o,add(o,[0,1,0]),add(o,[1,0,0]),plane);
    for(const axis of ["x","y","z"] as const) {
      const p=pointObject(axis,[0,0,0]);p.construction={type:"onAxis",axis,parameter:2};d.objects.push(p);
    }
    const r=resolveGeometry(d);
    for(const p of d.objects)if(p.kind==="point"&&p.construction.type==="onAxis") {
      close(r.points.get(p.id)!.p,add(o,mul(coordinateAxis(d,p.construction.axis).direction,2)));
    }
  });
  it("rejects collinear, coincident or off-plane direction selections",()=>{
    const plane=planeFromPoints([0,0,0],[1,0,0],[0,1,0],"xy");
    expect(()=>frameFromDirections([0,0,0],[0,0,0],[0,1,0],plane)).toThrow(/重合/);
    expect(()=>frameFromDirections([0,0,0],[1,0,0],[2,0,0],plane)).toThrow(/x 轴/);
    expect(()=>frameFromDirections([0,0,0],[1,0,0],[0,1,1],plane)).toThrow(/y 方向/);
    expect(()=>frameFromDirections([0,0,1],[1,0,1],[0,1,1],plane)).toThrow(/原点/);
    expect(()=>frameFromDirections([0,0,0],[1,0,1],[0,1,0],plane)).toThrow(/原点/);
  });
});
