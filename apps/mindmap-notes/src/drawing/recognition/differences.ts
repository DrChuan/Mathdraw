import type {RecognizedQuestion,RecognitionItem} from './types';
export type RecognitionDifference={kind:'added'|'modified'|'removed';before?:RecognitionItem;after?:RecognitionItem};
export function recognitionDifferences(previous:RecognizedQuestion,next:RecognizedQuestion):RecognitionDifference[]{
 const used=new Set<string>(),out:RecognitionDifference[]=[];
 const same=(a:RecognitionItem,b:RecognitionItem)=>a.role===b.role&&a.scope===b.scope&&a.source===b.source&&a.enabled===b.enabled&&a.necessary===b.necessary&&a.text===b.text&&a.quote===b.quote;
 for(const after of next.items){let before=previous.items.find(i=>!used.has(i.id)&&i.id===after.id);
  if(!before)for(const field of ['quote','source','text'] as const){const matches=previous.items.filter(i=>!used.has(i.id)&&i.scope===after.scope&&!!after[field]&&i[field]===after[field]);if(matches.length===1){before=matches[0];break;}}
  if(before){used.add(before.id);if(!same(before,after))out.push({kind:'modified',before,after});}else out.push({kind:'added',after});
 }
 for(const before of previous.items)if(!used.has(before.id))out.push({kind:'removed',before});return out;
}
