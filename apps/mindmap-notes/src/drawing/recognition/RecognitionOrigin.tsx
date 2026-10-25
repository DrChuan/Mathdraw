import type {RecognizedQuestion} from './types';
import './recognition.css';
/** Stable item identity survives condition splitting and row reordering. */
export function RecognitionOrigin({question,id}:{question?:RecognizedQuestion;id:string}){
 const item=question?.items.find(i=>id===i.id||id.startsWith(i.id+':'));
 if(!question||!item)return null;
 return <span className="recognition-origin" tabIndex={0} aria-label="查看此条件的原题来源" title="查看原题来源">↗<span className="recognition-source-popover"><small>{question.regions.some(r=>item.regions.includes(r.id)&&r.localization==='model')?'模型视觉定位，请核对；可在识别窗口重框':'原始 OCR 来源；手工修改后的条件以当前源码为准'}</small><span className="recognition-image"><img src={question.image} alt="此条件的原题截图"/>{question.regions.filter(r=>item.regions.includes(r.id)).map(r=><span key={r.id} className="source-region highlighted" style={{left:`${r.box[0]/question.width*100}%`,top:`${r.box[1]/question.height*100}%`,width:`${r.box[2]/question.width*100}%`,height:`${r.box[3]/question.height*100}%`}}/>)}</span></span></span>;
}
