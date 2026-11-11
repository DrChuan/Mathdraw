import {ExpressionPanel} from './ExpressionPanel';
import {proposeCoordinateObjects} from './coordinateWorkspace';
import {planarContext} from './constraints/planarModel';
import {solveConstraints} from './constraints/solver';
import {solutionSetObject,installSolutionSet} from './constraints/document';
import {CoordinateObjectDialog} from './CoordinateObjects';
import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {newDrawing} from './types';
import ConstraintWorkbench from './ConstraintWorkbench';
import ConditionInput from './ConditionInput';
import PlanarObjectForm from './PlanarObjectForm';
import ConstraintCurves from './ConstraintCurves';
import {ConfigurationMenu,SolverStatus} from './ConstraintUI';
import {recognitionDifferences} from './recognition/differences';
import {createTextDraft} from './recognition/pipeline';
import type {RecognitionItem} from './recognition/types';
const base=()=>createTextDraft({image:'data:image/png;base64,AA==',width:10,height:10});
const item=(id:string,source:string,scope='common'):RecognitionItem=>({id,source,scope,text:source,quote:'原题关系',role:'condition',enabled:true,necessary:true,regions:[]});
describe('compact condition workspace presentation',()=>{
 it.each(['2d','3d'] as const)('readonly %s embeds no editor, footer or motion controls',dimension=>{const doc={...newDrawing(),dimension};const html=renderToStaticMarkup(<ConstraintWorkbench embedded docRef={{current:doc}} change={()=>false} close={()=>{}} highlight={()=>{}}/>);expect(html).toContain('constraint-readonly-preview');expect(html).not.toContain('constraint-editor');expect(html).not.toContain('<footer');expect(html).not.toContain('添加条件');expect(html).not.toContain('加载配置');expect(html).not.toContain('运动与轨迹');});
 it('keeps both input paths and adds coordinate relations to the same categories',()=>{const html=renderToStaticMarkup(<ConditionInput mode="coordinate" points="A B C" append={()=>true} onError={()=>{}}/>);expect(html).toContain('完整输入');expect(html).toContain('简写');expect(html).toContain('坐标 / 曲线');expect(html).not.toContain('坐标与圆锥曲线条件');});
 it('object creation and angle suggestions are collapsed initially',()=>{const doc=newDrawing();const html=renderToStaticMarkup(<PlanarObjectForm document={doc} submit={()=>true}/>);expect(html).toContain('＋ 添加对象');expect(html).not.toContain('<form');const angles=renderToStaticMarkup(<ConditionInput points="A B C" segments="AB,BC" append={()=>true} onError={()=>{}}/>);expect(angles).toContain('<summary>插入角');expect(angles).not.toContain('<details open');});
 it('keeps empty curve section quiet and groups file actions accessibly',()=>{const curves=renderToStaticMarkup(<ConstraintCurves points="A B C" curves={[]} conditions={[]} change={()=>{}} onError={()=>{}}/>);expect(curves).toContain('＋ 曲线');expect(curves).not.toContain('支持圆与椭圆');const menu=renderToStaticMarkup(<ConfigurationMenu><button>加载配置</button><button>保存配置</button></ConfigurationMenu>);expect(menu).toContain('<summary>配置');expect(menu).not.toContain('open=');});
 it('only failed searches offer the contextual deeper-search action',()=>{const props={message:'状态',stale:true,search:()=>{}};expect(renderToStaticMarkup(<SolverStatus {...props} status="satisfied"/>)).not.toContain('深入搜索');expect(renderToStaticMarkup(<SolverStatus {...props} status="notFound"/>)).toContain('深入搜索');expect(renderToStaticMarkup(<SolverStatus {...props} status="invalid"/>)).toContain('显示上次有效结果');});
 it('readable diffs match regenerated identities and preserve sibling scope separation',()=>{const before={...base(),items:[item('old','AB=2'),{...item('gone','BC=3'),quote:'另一条件'},item('sibling','AB=2','p2')]},after={...base(),items:[{...item('new','AB=4'),quote:'原题关系'},item('added','AC=5','p3'),item('sibling','AB=2','p2')]};const diff=recognitionDifferences(before,after);expect(diff.map(d=>d.kind).sort()).toEqual(['added','modified','removed']);expect(diff.find(d=>d.kind==='modified')?.before?.id).toBe('old');expect(recognitionDifferences(before,before)).toEqual([]);expect(before.items[0].source).toBe('AB=2');});
});

describe('coordinate object and relation structure',()=>{
 it('uses two sections in coordinate mode and keeps declarations in coordinate-free mode',()=>{
  const html=renderToStaticMarkup(<ConstraintWorkbench docRef={{current:newDrawing()}} change={()=>false} close={()=>{}} highlight={()=>{}}/>);
  const coordinate=html.split('data-workspace-mode="coordinate"')[1].split('data-workspace-mode="plane"')[0];
  expect(coordinate).toContain('坐标对象');expect(coordinate).toContain('对象关系');expect(coordinate).not.toContain('声明平面图形');expect(coordinate).not.toContain('批量声明点与线段');expect(coordinate).toContain('＋ 添加');
  expect(html.split('data-workspace-mode="plane"')[1]).toContain('声明平面图形');
 });
 it('retains both input forms and suppresses incomplete construction formulas',()=>{
  const html=renderToStaticMarkup(<CoordinateObjectDialog document={newDrawing()} initialKind="asymptote" close={()=>{}} proposeObject={()=>false} proposeShape={()=>{}} proposePoints={()=>{}} confirm={()=>{}} back={()=>{}} error=""/>);
  expect(html).toContain('请选择来源对象');expect(html).not.toContain('Asymptote(,1)');expect(html).toContain('高级：源码录入');expect(html).not.toContain('搜索对象类型');expect(html).not.toContain('创建对象类型');
 });
});


describe('direct conic creation',()=>{
 it('leads with a display equation and keeps every companion name field in the initial layout',()=>{
  const html=renderToStaticMarkup(<CoordinateObjectDialog document={newDrawing()} initialKind="ellipse" close={()=>{}} proposeObject={()=>true} proposeShape={()=>{}} proposePoints={()=>{}} confirm={()=>{}} back={()=>{}} error=""/>);
  expect(html.indexOf('当前对象公式预览')).toBeLessThan(html.indexOf('新建对象名称'));
  expect(html).toContain('\\displaystyle');expect(html).not.toContain('核对新增内容');
  expect(html).toContain('type="submit">创建');expect(html).not.toContain('未知参数由后续条件确定');
  expect(html.match(/disabled="" aria-label="[^"]+名称"/g)).toHaveLength(8);
 });
});


it('exposes diameter circles as a direct basic-object choice',()=>{
 const html=renderToStaticMarkup(<CoordinateObjectDialog document={newDrawing()} close={()=>{}} proposeObject={()=>true} proposeShape={()=>{}} proposePoints={()=>{}} confirm={()=>{}} back={()=>{}} error=""/>);
 expect(html).toContain('直径两端点');expect(html).toContain('线与向量');expect(html).not.toContain('搜索类型');
});


it('keeps the condition edit action outside disclosure and omits fixed-value sliders',()=>{
 const draft=proposeCoordinateObjects({context:planarContext(newDrawing()),points:'O',segments:'',conditions:[],curves:[]},'椭圆 C x 参数 a,b,c,e\na=2').draft;
 const problem={mode:'coordinate' as const,points:draft.points.split(' '),segments:[],conditions:draft.conditions,planar:draft.context};
 const result=solveConstraints({id:1,problem,budget:1000}),set=solutionSetObject(problem,result),doc=installSolutionSet(draft.context.document,set);
 const html=renderToStaticMarkup(<ExpressionPanel doc={doc} selected={[]} select={()=>{}} change={()=>false} drafts={{}} previewProblem="" onDraft={()=>{}} editor={{current:null}} onContext={()=>{}} onConstraintEdit={()=>{}}/>);
 expect(html).toContain('条件图形');expect(html).toContain(`aria-label="编辑定义 ${set.symbol}"`);expect(html).not.toContain('构型与动点设置');
 expect(html).not.toContain('aria-label="调整数值 a"');expect(html).toContain('aria-label="调整数值 b"');
});

it('shows sliders for external inputs even when the solved construction has zero internal DOF',()=>{
 const draft=proposeCoordinateObjects({context:planarContext(newDrawing()),points:'O',segments:'',conditions:[],curves:[]},'k=2\nP=(?,?)\nx(P)=k\ny(P)=0').draft;
 const k=draft.context.document.objects.find(o=>o.symbol==='k')!;draft.context.inputs=[{object:k.id,fields:['value']}];
 const problem={mode:'coordinate' as const,points:draft.points.split(' '),segments:[],conditions:draft.conditions,planar:draft.context},result=solveConstraints({id:1,problem}),set=solutionSetObject(problem,result),doc=installSolutionSet(draft.context.document,set);
 expect(result.branches[0].dof).toBe(0);
 const html=renderToStaticMarkup(<ExpressionPanel doc={doc} selected={[]} select={()=>{}} change={()=>false} drafts={{}} previewProblem="" onDraft={()=>{}} editor={{current:null}} onContext={()=>{}} onConstraintEdit={()=>{}}/>);
 expect(html).toContain('可变输入');expect(html).toContain('aria-label="调整数值 k"');expect(html.match(/<input[^>]*aria-label="调整数值 k"[^>]*>/)?.[0]).not.toContain('disabled');
});
