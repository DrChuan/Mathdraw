/** Named-object relation protocol shared by validation, evaluation and OCR instructions.
 * Point-group commands remain in input.ts; these forms resolve actual object names. */
export const planarRelations = {
 pointLineDistance:{references:2,counts:[3],example:'pointLineDistance(P,l,2)',meaning:'点到命名直线的距离'},
 onCurve:{references:2,counts:[2],example:'onCurve(P,c)',meaning:'点在已定义曲线上'},
 onLine:{references:2,counts:[2],example:'onLine(P,l)',meaning:'点在已定义直线上'},
 intersection:{references:3,counts:[3],example:'intersection(P,c,l)',meaning:'点同时在两个对象上'},
 tangent:{references:2,counts:[2],example:'tangent(l,c)',meaning:'直线与二次曲线相切'},
 parallel:{references:2,counts:[2],example:'parallel(l,AB)',meaning:'两直线平行'},
 perpendicular:{references:2,counts:[2],example:'perpendicular(l,AB)',meaning:'两直线垂直'},
 center:{references:2,counts:[2],example:'center(O,c)',meaning:'点为曲线中心'},
 focus:{references:2,counts:[2,3],example:'focus(F,c,1)',meaning:'点为曲线焦点，序号1或2'},
 directrix:{references:2,counts:[2,3],example:'directrix(l,c,1)',meaning:'直线为曲线准线，序号1或2'},
 lineAngle:{references:2,counts:[3],example:'lineAngle(l,s,60)',meaning:'两直线的较小夹角，0到90度；不是倾斜角'},
 inclination:{references:1,counts:[2],example:'inclination(l,30)',meaning:'直线倾斜角，x轴正向逆时针到直线，0度含、180度不含'},
 distance:{references:1,counts:[2],example:'distance(s,2)',meaning:'命名线段或向量的长度'},
 equal:{references:2,counts:[2],example:'equal(s,t)',meaning:'两线段等长'},
 ratio:{references:2,counts:[3],example:'ratio(s,t,2)',meaning:'两线段长度比'},
 vectorDot:{references:2,counts:[3],example:'vectorDot(h,j,2)',meaning:'两个向量的数量积'},
} as const;
export const planarRelationPattern=new RegExp(`^(${Object.keys(planarRelations).join('|')})\\s*\\((.*)\\)$`,'i');
export const lateBoundPlanarCommands=new Set([...Object.keys(planarRelations).map(s=>s.toLowerCase()),'vectorrelation']);
export const planarRelationCounts=Object.fromEntries(Object.entries(planarRelations).map(([name,spec])=>[name.toLowerCase(),spec.counts])) as Record<string,readonly number[]>;
export function namedAngleSyntaxHint(source:string){
 if(/^angle\s*\([^)]*\b(?:x_axis|y_axis)\b/i.test(source))throw Error('x_axis/y_axis 不是内置对象；直线倾斜角请用 inclination(l,30)，命名直线夹角请用 lineAngle(l,s,30)');
}

export const planarRelationReferences=Object.fromEntries(Object.entries(planarRelations).map(([name,spec])=>[name.toLowerCase(),spec.references])) as Record<string,number>;
