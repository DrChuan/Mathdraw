import type {ConstraintMode} from '../constraints/types';
export type Region={id:string;text:string;box:[number,number,number,number];manual?:boolean;localization?:'model'};
export type Scope={id:string;label:string;parent?:string};
export type RecognitionItem={id:string;role:'definition'|'condition'|'goal'|'uncertain';text:string;source:string;symbolRenames?:{from:string;to:string}[];quote?:string;sharedQuote?:boolean;scope:string;regions:string[];enabled:boolean;modified?:boolean;originalSource?:string;necessary:boolean};
export interface RecognizedQuestion {
 textOnly?:boolean;inputSource?:'image'|'text';
 version:1;id:string;image:string;width:number;height:number;regions:Region[];
 originalText:string;editedText:string;paragraphs:{text:string;regions:string[]}[];
 mode:ConstraintMode;points:string;segments:string;scopes:Scope[];activeScope:string;
 items:RecognitionItem[];warnings:string[];revision:number;
}
export interface RecognitionSettings {region:'beijing'|'singapore';workspace:string;ocrModel:string;model:string;configured:boolean}
