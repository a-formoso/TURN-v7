/* Real hover/focus/tap overlay handlers with a controlled DOM adapter, no browser automation. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const compiled=process.env.HELP_TEST_DIST==='1';let checks=0;
const ok=(v,m)=>{assert.ok(v,m);checks++;};
const flat=n=>n&&typeof n==='object'?[n,...(n.children||[]).flatMap(flat)]:[];
function harness(){
 let hooks=[],cursor=0,effects=[],pending=[],listeners=new Map();
 const document={body:{name:'body'},activeElement:null,addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:k=>listeners.delete(k)};
 const trigger={owner:'trigger',getBoundingClientRect:()=>({right:300,bottom:70}),contains:x=>x===trigger,focus:()=>document.activeElement=trigger};
 const inner={owner:'panel',focus:()=>document.activeElement=inner};
 const panel={contains:x=>x===inner,querySelector:()=>inner};
 const b={console,document,innerWidth:320,innerHeight:480,Icon:{info:()=>null},setTimeout:fn=>{const t={fn};pending.push(t);return t;},clearTimeout:t=>{if(t)t.off=true;},addEventListener(){},removeEventListener(){}};b.window=b;
 b.ReactDOM={createPortal:(node,target)=>({type:'portal',props:{target},children:[node]})};
 b.React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(x=>x!=null&&x!==false)}),
  useId:()=>{cursor++;return ':id:';},useRef:v=>{const i=cursor++;return hooks[i]||(hooks[i]={current:v});},
  useState:v=>{const i=cursor++;if(!(i in hooks))hooks[i]={value:v};return [hooks[i].value,x=>hooks[i].value=typeof x==='function'?x(hooks[i].value):x];},
  useEffect:(fn,deps)=>{const i=cursor++,old=hooks[i];if(!old||deps.some((v,k)=>v!==old.deps[k]))effects.push(()=>{old?.cleanup?.();hooks[i].cleanup=fn();});hooks[i]={deps,cleanup:old?.cleanup};}};
 vm.createContext(b);vm.runInContext(readFileSync(compiled?'dist/app/locations-ui.js':'app/locations-ui.jsx','utf8'),b);
 function render(){cursor=0;effects=[];const tree=b.LocationHelpPopover({label:'What changed',title:'Changes',children:close=>b.React.createElement('p',null,'Full requirements')});
 for(const n of flat(tree))if(n.props.ref)n.props.ref.current=n.type==='button'?trigger:panel;effects.splice(0).forEach(f=>f());return tree;}
 const button=tree=>flat(tree).find(n=>n.props['aria-label']==='What changed');
 return {b,render,button,listeners,document,trigger,inner,flush:()=>{const tasks=pending;pending=[];tasks.forEach(t=>{if(!t.off)t.fn();});}};
}
{
 const h=harness();let tree=h.render();ok(!flat(tree).some(n=>n.type==='portal'),'Closed help contributes only a compact trigger, no extra content row');
 tree.props.onMouseEnter();tree=h.render();let popup=flat(tree).find(n=>n.type==='portal');ok(popup.props.target===h.document.body,'Help is portalled outside the card flow');
 const dialog=flat(tree).find(n=>n.props.role==='dialog');ok(dialog.props.style.width<=296&&dialog.props.style.left>=12,'The floating help fits a narrow viewport');
 ok(h.button(tree).props['aria-expanded']===true,'The trigger exposes expanded state');
 tree.props.onMouseLeave();dialog.props.onMouseEnter();h.flush();tree=h.render();ok(flat(tree).some(n=>n.type==='portal'),'Moving from the trigger into help keeps links usable');
 h.button(tree).props.onClick({stopPropagation(){}});tree=h.render();tree.props.onMouseLeave();h.flush();tree=h.render();ok(flat(tree).some(n=>n.type==='portal'),'Tap pins help open instead of requiring hover');
 h.listeners.get('pointerdown')({target:{}});tree=h.render();ok(!flat(tree).some(n=>n.type==='portal'),'Outside tap dismisses help');
 h.button(tree).props.onFocus();tree=h.render();ok(flat(tree).some(n=>n.type==='portal'),'Keyboard focus opens help');
 h.listeners.get('keydown')({key:'Escape',preventDefault(){},stopPropagation(){}});tree=h.render();ok(!flat(tree).some(n=>n.type==='portal')&&h.document.activeElement===h.trigger,'Escape closes help and returns focus');
 h.button(tree).props.onKeyDown({key:'ArrowDown',preventDefault(){}});tree=h.render();h.flush();ok(h.document.activeElement===h.inner,'Arrow down opens the interactive panel and moves focus inside');
 flat(tree).find(n=>n.props['aria-label']==='Close help').props.onClick();tree=h.render();ok(!flat(tree).some(n=>n.type==='portal'),'The explicit close control dismisses the overlay');
}
{
 const h=harness(),steps=[{n:2,name:'Floor plan',next:true,todo:'The opening top is above the ceiling. Correct the measurements.'}];
 let go=0;h.b.goToLocationStep=()=>go++;
 h.b.React.useReducer=(f,i)=>[i,()=>{}];
 const rows=h.b.locationTodoRows({l:{id:'room'},steps:[{n:1,done:true}].concat(steps),looks:[],spatialState:{ready:true,plan:{frame:'f',anchors:[{}]}},previs:true});
 const tree=h.b.LocationTodoList({l:{id:'room'},rows,onLook(){}});
 // (owner 2026-11-17: "the tracker alone is enough") no second next-step row with a help trigger. Since the picture-first
 // card (2026-11-21) the steps are the To do tab's rows: the one to do next is marked, says what to do, and opens its section
 ok(!flat(tree).some(n=>n.props.className==='loc-steps-next')&&!flat(tree).some(n=>n.type===h.b.LocationHelpPopover),'The list stands alone: no second next-step row');
 const row=flat(tree).find(n=>n.type==='li'&&n.props.className==='loc-todo-row next');
 const step=flat(row).find(n=>n.type==='button');
 ok(step.props['aria-current']==='step'&&flat(row).some(n=>n.type==='small'&&n.children.join('')===steps[0].todo),'The step to do next carries the full instruction');
 step.props.onClick();ok(go===1,'The step opens the required repair section');
}
console.log('PASS location help: '+checks+' overlay, hover, tap, keyboard, compactness and repair-route checks');
