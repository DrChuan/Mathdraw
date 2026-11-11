import { memo } from "react";
import Markdown from "../Markdown";
export const FormulaPreview = memo(function FormulaPreview({source,display=false}: {source:string;display?:boolean}) {
  return <div className="expression-preview"><Markdown compact text={display?`$$\n${source}\n$$`:`$${source}$`} /></div>;
});
