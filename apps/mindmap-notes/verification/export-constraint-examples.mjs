import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const destination=resolve(process.argv[2]??"verification/constraint-examples");
const server=await createServer({configFile:false,server:{middlewareMode:true,watch:null},logLevel:"error"});
try {
  const {solveConstraints}=await server.ssrLoadModule("/src/drawing/constraints/solver.ts");
  const {parseCondition}=await server.ssrLoadModule("/src/drawing/constraints/input.ts");
  const {solutionSetObject,installSolutionSet,constraintLocusPoints}=await server.ssrLoadModule("/src/drawing/constraints/document.ts");
  const {newDrawing}=await server.ssrLoadModule("/src/drawing/types.ts");
  const {normalizeDrawing}=await server.ssrLoadModule("/src/drawing/model.ts");
  const {resolveGeometry,project}=await server.ssrLoadModule("/src/drawing/geometry.ts");
  const examples=[
    ["01-三边定三角形","A B C",["AB=3","AC=4","BC=5"],"AB BC CA"],
    ["02-正方体与镜像构型","A B C D E F G H",["cube(A,B,C,D,E,F,G,H)","AB=3"],"AB BC CD DA EF FG GH HE AE BF CG DH"],
    ["03-铰接与圆轨迹","A B C D",["AB=3","AC=3","BC=3","AD=3","BD=3"],"AB AC BC AD BD"],
    ["04-球面轨迹","A B C P",["AB=3","AC=4","BC=5","AP=2"],"AB BC CA AP"],
  ];
  await mkdir(destination,{recursive:true});
  const report=[];
  for(const [title,names,sources,edges] of examples) {
    const points=names.split(" "),problem={points,segments:edges.split(" ").map(edge=>[...edge]),conditions:sources.map(source=>parseCondition(source,points))};
    const result=solveConstraints({id:1,problem,budget:800,seed:17});
    if(!result.branches.length)throw new Error(`Example failed: ${title}`);
    const doc=normalizeDrawing(installSolutionSet(newDrawing(),solutionSetObject(problem,result)));doc.title=title;
    const positions=[...resolveGeometry(doc).points.values()].filter(p=>p.object?.construction.type!=="origin").map(p=>project(p.p,doc));
    positions.push(...constraintLocusPoints(doc).map(p=>project(p,doc)));
    const xs=positions.map(p=>p[0]),ys=positions.map(p=>p[1]);doc.view.center=[(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2];doc.view.scale=64;
    const file=resolve(destination,`${title}.mathdraw.json`);await writeFile(file,JSON.stringify(doc,null,2),"utf8");
    report.push({title,branches:result.branches.length,dof:result.branches[0].dof,elapsed:result.elapsed});
  }
  console.log(JSON.stringify(report,null,2));
} finally {await server.close();}
