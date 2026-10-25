import {planarRelations} from '../constraints/planarRelations';
import {constraintKinds} from '../constraints/types';
import {conditionExamples,conditionLabels} from '../constraints/catalog';
/** Shared executable grammar catalog: prompt and documentation enumerate the
 * same condition kinds as the parser, rather than maintaining a second list. */
export const recognitionGrammar=`
【解析器支持的完整条件目录】
${constraintKinds.map(k=>`${conditionLabels[k]}：${conditionExamples[k]}`).join('\n')}
上表 onCurve/diameter 在无坐标或空间模式须引用已声明的圆/曲线；坐标模式引用已定义对象。体积/线面角/二面角/共面/共球及几何体只适用于立体模式。
图形引用可写 area(Triangle(A,B,C))=sqrt(2)、area(Polygon(A,B,C,D))=6、circumradius(Triangle(A,B,C))=2；与直接写顶点的语义相同。不要把这些几何度量当数值函数或新建辅助三角形。
【坐标对象定义：精确命令名与参数】
保留名称 x、y、u、v 不得用作对象名；数值变量还须避开 z、pi 及函数名。e 未声明时表示自然常数；只有原题明确给出或曲线模板明确创建离心率参数时才可显式声明 e，辅助变量不要占用它。
A=(2,0)；a=?；a>0；c: x^2/a^2-y^2/b^2=1。
F_1=Focus(c,1)，F_2=Focus(c,2)；A_1=Vertex(c,1)，A_2=Vertex(c,2)。焦点和主轴顶点序号1在左/下，2在右/上。
l=Asymptote(c,1)，第二渐近线是 Asymptote(c,2)；l=Directrix(c,1)。原题只说一条渐近线时保留一种分支，不自行增加斜率正负限制。
s=Segment(A,B)，l=Line(A,B)，h=Vector(A,B)，t=Triangle(A,B,C)。
c=Circle(O,A)（圆心和圆上一点），c=Circle(O,2)（圆心和半径），c=Circle3(A,B,C)，c=DiameterCircle(A,B)（以AB为直径的圆）。不要在识别条目里引入未在题中命名的中点来替代直径圆。
M,N=Intersect(c,l)（两个不同交点的一条定义）；单点用 M=Intersect(c,l,1)，第二点用 N=Intersect(c,l,2)。序号从1开始。若交点构造在初值不存在，使用 intersection(M,c,l)、intersection(N,c,l) 和 M!=N 保留为待求关系，不固定采样坐标。
已知关系（不是新对象）：onCurve(A,c)、onLine(A,l)、intersection(A,c,l)、center(O,c)、focus(F,c,1)、directrix(l,c,1)、tangent(l,c)、parallel(l,s)、perpendicular(l,s)、lineAngle(l,s,60)。引用命名直线的角使用 lineAngle，而三点角使用 angle(A,B,C)=5*pi/6。
参数/坐标等式：x(A)=2，y(A)=0，a(c)=2，b(c)=1，e(c)=sqrt(2)，radius(c)=3，focalDistance(c)=4。数值必须是原题给定，不能先解题填入。
普通边长和角度等式始终是标量；只有原文带向量标记才用 vec 或 dot。数值角度默认度；含pi或rad(...)为弧度。不存在的命令、自然语言源码或不支持的定义应标 uncertain，不能伪装成可执行条件。
`;

/** Executable named-reference signatures, not a second handwritten command list. */
export const namedRelationGrammar=`
【有坐标模式：命名对象关系签名】
${Object.entries(planarRelations).map(([name,spec])=>`${name}：参数个数 ${spec.counts.join('或')}；${spec.example}；${spec.meaning}`).join('\n')}
上述命令是关系，role=condition，不是对象定义。倾斜角必须用 inclination(l,30)；150度用 inclination(l,150)，竖直线用 inclination(l,90)，其定义须用 l: x=x(F_2) 或一般式，不能用有限斜率 k 模板。angle(A,B,C)=60 仅引用三点，angle(AB,CD)=60 仅引用端点组；命名直线使用 lineAngle(l,s,60)。x_axis/y_axis 不是内置对象，严禁输出 angle(l,x_axis)=30。倾斜角与锐夹角不同，不可替换。要定义过 F_2 的未知斜率直线，先 k=?，再 l: y=k*(x-x(F_2))+y(F_2)；倾斜角单独作为关系，不预先计算斜率。
`;

export const recognitionValidationProtocol=`
【输出前必须执行的协议检查】
1. 建立类型明确的符号表：点、线/线段/向量、曲线、数值参数分别记录。points 只放点；被引用对象必须由本题或祖先小问定义。x_axis/y_axis 不存在，不得凭空引用。
2. 每个原题片段先确定是定义、已知、目标还是待确认，再从上列规范写法选签名；区分“点组条件”和“命名对象关系”。命名关系严格按上列参数数量，值放在最后一个参数内，不混写另一种签名。构造是名称=构造命令，关系没有对象赋值前缀。
3. 直线倾斜角 inclination(l,theta) 不是三点角，也不是 lineAngle 的锐夹角。angle(A,B,C) 顶点是B。默认度，含 pi 或 rad(...) 是弧度；不能把150度改成30度。
4. 不输出语法目录外的函数、临时英文对象或猜测别名。可表达就用规范语法；无法忠实表达就 uncertain、source为空、necessary=true，并说明原因。不得丢弃关系以制造可导入结果。
5. 一条原文关系对应一个条目；一句多个关系须拆原文片段。源码可多行但都必须属于该片段；不能把推导出的等距、垂直等替代原文关系。目标与证明结论不用作已知。
6. 每个小问只引用公共或祖先定义，不能依赖兄弟小问；列全必要点、线段及语法引用。截断、不确定、未支持内容明确标记。合法语法不保证有解，不能以填入答案或固定未知量换取成功。
程序会在返回后运行正式编译器检查全部小问的语法、引用、模式和依赖；未通过的条目保留供修改，阻止导入，不自动循环调用API。
`;
