import katex from "katex";
import type { Vec2 } from "./types";
type Glyph={text:string;x:number;y:number;size:number;italic:boolean};
type Box={width:number;up:number;down:number;glyphs:Glyph[];lines:Vec2[][]};
type Node={tag:string;text:string;attrs:Record<string,string>;children:Node[]};
const empty=():Box=>({width:0,up:0,down:0,glyphs:[],lines:[]});
const decode=(s:string)=>s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_m,n:string)=>n[0]==="#"?String.fromCodePoint(n[1]==="x"?parseInt(n.slice(2),16):Number(n.slice(1))):({amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" "}[n]??""));
function mathTree(tex:string,display:boolean):Node {
  const xml=katex.renderToString(tex,{output:"mathml",displayMode:display,throwOnError:true,trust:false,strict:"ignore"});
  const root:Node={tag:"root",text:"",attrs:{},children:[]},stack=[root];
  for(const token of xml.match(/<[^>]+>|[^<]+/g)??[]) {
    if(token.startsWith("</")){stack.pop();continue;}
    if(token.startsWith("<")){
      const tag=token.match(/^<([\w:]+)/)?.[1];if(!tag)continue;
      const node:Node={tag,text:"",attrs:Object.fromEntries([...token.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m=>[m[1],decode(m[2])])),children:[]};
      stack.at(-1)!.children.push(node);if(!token.endsWith("/>"))stack.push(node);
    }else stack.at(-1)!.text+=decode(token);
  }
  return root;
}
let context:CanvasRenderingContext2D|null|undefined;
function textBox(text:string,size:number,italic:boolean):Box {
  if(context===undefined)context=typeof document!=="undefined"?document.createElement("canvas").getContext("2d"):null;
  let width=0;
  if(context){context.font=`${italic?"italic ":""}${size}px "Times New Roman"`;width=context.measureText(text).width;}
  else width=[...text].reduce((sum,c)=>sum+size*(/[il1.,:;' ]/.test(c)?.28:/[MW∑√]/.test(c)?.85:.53),0);
  return {width,up:size*.8,down:size*.23,glyphs:[{text,x:0,y:0,size,italic}],lines:[]};
}
function place(out:Box,b:Box,x:number,y:number) {
  out.glyphs.push(...b.glyphs.map(g=>({...g,x:g.x+x,y:g.y+y})));
  out.lines.push(...b.lines.map(line=>line.map(([a,c])=>[a+x,c+y] as Vec2)));
  out.width=Math.max(out.width,x+b.width);out.up=Math.max(out.up,b.up-y);out.down=Math.max(out.down,b.down+y);
}
function row(boxes:Box[],gap=0):Box {const out=empty();let x=0;for(const b of boxes){place(out,b,x,0);x+=b.width+gap;}out.width=Math.max(0,x-gap);return out;}
function layout(n:Node,s:number,display=false):Box {
  const kids=n.children.filter(n=>n.tag!=="annotation"&&n.tag!=="annotation-xml");
  const child=(i:number,size=s)=>kids[i]?layout(kids[i],size,display):empty();
  if(n.tag==="annotation"||n.tag==="annotation-xml")return empty();
  if(["mi","mn","mo","mtext","ms"].includes(n.tag)){
    const text=n.text||kids.map(c=>c.text).join(""),italic=n.tag==="mi"&&n.attrs.mathvariant!=="normal";
    const b=textBox(text.replace(/\u2061/g,""),s,italic);
    if(n.tag==="mo"&&text.trim()&&!["(",")","[","]","|","‖"].includes(text)){const o=empty();place(o,b,s*.10,0);o.width+=s*.10;return o;}
    return b;
  }
  if(n.tag==="mspace")return {...empty(),width:parseFloat(n.attrs.width??"0")*s};
  if(n.tag==="mfrac"){
    const a=child(0,s*.88),b=child(1,s*.88),o=empty(),w=Math.max(a.width,b.width)+s*.3,y=-s*.25;
    place(o,a,(w-a.width)/2,y-s*.18-a.down);place(o,b,(w-b.width)/2,y+s*.18+b.up);
    o.lines.push([[0,y],[w,y]]);o.width=w;return o;
  }
  if(["msub","msup","msubsup"].includes(n.tag)){
    const a=child(0),o=empty();place(o,a,0,0);
    if(n.tag!=="msup"){const b=child(1,s*.7);place(o,b,a.width+s*.03,Math.max(s*.24,a.down+b.up*.45));}
    if(n.tag!=="msub"){const b=child(n.tag==="msubsup"?2:1,s*.7);place(o,b,a.width+s*.03,-Math.max(s*.5,a.up-b.down*.3));}
    return o;
  }
  if(n.tag==="msqrt"||n.tag==="mroot"){
    const body=n.tag==="msqrt"?row(kids.map(k=>layout(k,s,display))):child(0),o=empty(),sign=textBox("√",Math.max(s,body.up+body.down+s*.15),false),x=sign.width*.85;
    place(o,sign,0,body.down*.3);place(o,body,x,0);o.lines.push([[x,-body.up-s*.1],[x+body.width+s*.1,-body.up-s*.1]]);o.width+=s*.1;
    if(n.tag==="mroot")place(o,child(1,s*.5),0,-s*.55);return o;
  }
  if(["mover","munder","munderover"].includes(n.tag)){
    const a=child(0),o=empty(),over=n.tag!=="munder",under=n.tag!=="mover",b=child(1,s*.7),c=child(2,s*.7),w=Math.max(a.width,b.width,c.width);
    place(o,a,(w-a.width)/2,0);
    if(over){const accent=kids[n.tag==="munderover"?2:1]?.text??"",y=-a.up-s*.13;
      if(/[→⃗]/.test(accent)){o.lines.push([[0,y],[w,y]],[[w-s*.2,y-s*.1],[w,y],[w-s*.2,y+s*.1]]);o.up=Math.max(o.up,-y+s*.1);}
      else {const top=n.tag==="munderover"?c:b;place(o,top,(w-top.width)/2,y-top.down);}}
    if(under)place(o,b,(w-b.width)/2,a.down+s*.12+b.up);o.width=w;return o;
  }
  if(n.tag==="mtable"){
    const rows=kids.map(r=>r.children.map(c=>layout(c,s*.95,display))),cols=Math.max(0,...rows.map(r=>r.length)),widths=Array.from({length:cols},(_,i)=>Math.max(0,...rows.map(r=>r[i]?.width??0))),o=empty();let y=0;
    for(const r of rows){const up=Math.max(s*.7,...r.map(b=>b.up)),down=Math.max(s*.2,...r.map(b=>b.down));let x=0;for(let i=0;i<r.length;i++){place(o,r[i],x+(widths[i]-r[i].width)/2,y+up);x+=widths[i]+s*.6;}y+=up+down+s*.3;}
    const shift=-y*.55;return {...o,up:-shift,down:y+shift,glyphs:o.glyphs.map(g=>({...g,y:g.y+shift})),lines:o.lines.map(l=>l.map(([x,y])=>[x,y+shift]))};
  }
  if(n.tag==="menclose"){const b=child(0);if(n.attrs.notation?.includes("top"))b.lines.push([[0,-b.up-s*.1],[b.width,-b.up-s*.1]]);return b;}
  const boxes=kids.map(k=>layout(k,n.tag==="mstyle"&&n.attrs.scriptlevel==="1"?s*.7:s,display));
  const height=Math.max(s,...boxes.map(b=>b.up+b.down));
  for(let i=0;i<kids.length;i++)if(kids[i].tag==="mo"&&/^[()[\]{}|‖]$/.test(kids[i].text)&&height>s*1.4)boxes[i]=textBox(kids[i].text,height*.92,false);
  return row(boxes);
}
const cache=new Map<string,Box>();
/** Plain text plus $…$ / $$…$$; only positioned Times glyphs and vector rules leave this module. */
export function annotationLayout(source:string,size:number,italic=true):Box {
  const key=JSON.stringify([source,size,italic]);const cached=cache.get(key);if(cached)return cached;
  const out=empty();let x=0,y=0;
  const re=/(\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\n])+?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/g;
  const append=(s:string)=>{const lines=s.split("\n");for(let i=0;i<lines.length;i++){if(i){x=0;y+=size*1.5;}const b=textBox(lines[i],size,italic);place(out,b,x,y);x+=b.width;}};
  let at=0;
  for(const match of source.matchAll(re)){
    append(source.slice(at,match.index));const text=match[0],display=text.startsWith("$$")||text.startsWith("\\["),delimiter=text.startsWith("$")?(display?2:1):2,tex=text.slice(delimiter,-delimiter);
    try {const b=layout(mathTree(tex,display),size,display);if(display&&x){x=0;y+=size*1.5;}place(out,b,x,y);x+=b.width;if(display){x=0;y+=b.down+size*1.2;}}
    catch {append(text);}
    at=match.index!+text.length;
  }
  append(source.slice(at));cache.set(key,out);if(cache.size>128)cache.delete(cache.keys().next().value!);return out;
}
