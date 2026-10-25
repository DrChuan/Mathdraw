export function inputDiagnosis(source:string,message:string){
 const token=message.match(/找不到对象\s+([A-Za-z][A-Za-z0-9_]*)|不支持的变量或函数\s+([A-Za-z][A-Za-z0-9_]*)|符号\s+([A-Za-z][A-Za-z0-9_]*)/)?.slice(1).find(Boolean);
 const matches=token?[...source.matchAll(new RegExp(`(?<![A-Za-z0-9_])${token}(?![A-Za-z0-9_])`,'g'))]:[];
 const kind=/找不到|未声明|引用|不存在/.test(message)?'对象引用':/占用|重名|保留/.test(message)?'名称冲突':/退化|无实|无定义|无效位置|失效|零/.test(message)?'数学定义':/字符|语法|括号|不支持.*函数/.test(message)?'输入格式':'输入检查';
 const hint=kind==='对象引用'?'请从已有对象中选择，或先声明该对象。':kind==='名称冲突'?'请保留原题名称，给辅助对象换一个未使用的符号。':kind==='数学定义'?'请检查当前构型与取值；语法正确也可能在当前取值下无定义。':'原输入已保留。请核对命令参数、括号和数值表达式。';
 return {kind,hint,start:matches.length===1?matches[0].index:undefined,end:matches.length===1?matches[0].index!+token!.length:undefined};
}
export default function InputFeedback({source,message}:{source:string;message:string}){const d=inputDiagnosis(source,message);return <div className="input-feedback" role="alert"><strong>{d.kind}</strong> · {message}{d.start!==undefined&&<pre>{source.slice(0,d.start)}<mark>{source.slice(d.start,d.end)}</mark>{source.slice(d.end)}</pre>}<small>{d.hint}</small></div>;}
