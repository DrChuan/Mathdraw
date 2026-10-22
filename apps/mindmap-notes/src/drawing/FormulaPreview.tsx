import { memo } from "react";
import Markdown from "../Markdown";
export const FormulaPreview = memo(function FormulaPreview({source}: {source:string}) {
  return <div className="expression-preview"><Markdown compact text={`$${source}$`} /></div>;
});
