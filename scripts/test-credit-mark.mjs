/* THE CREDIT MARK (owner 2026-11-13): "For buttons that have the render credits on them ... place [the sparkle] on the
   left side of the number of credits, so it conveys that this is what the user would be spending ... for every button
   across all the tabs, across the entire app."
   One helper draws the mark, every price chip uses it, and the button's own leading sparkle steps aside while a price
   is shown, so a button never carries two. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {transformSync} from "@babel/core";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const icons=read("app/icons.jsx"), gen=read("app/imagegen.jsx"), art=read("app/artroom.jsx"), cloud=read("app/blender-render-ui.jsx"),
  ve=read("app/video-elements.jsx"), css=read("app/styles.css"), html=read("TURN.html"), ai=read("app/ai.jsx");
let pass=0, fail=0;
const test=(name,fn)=>{ try{ fn(); pass++; console.log("PASS "+name); }catch(e){ fail++; console.log("FAIL "+name+"\n    "+String(e&&e.message||e).split("\n")[0]); } };

test("1 the sparkle icon is named, and nothing else about the icons changed", ()=>{
  const React={createElement:(type,props,...children)=>({type,props:props||{},children})};
  const box={React}; box.window=box; vm.createContext(box);
  vm.runInContext(transformSync(icons,{presets:["@babel/preset-react"],babelrc:false,configFile:false,filename:"icons.jsx"}).code+";this.__Icon=Icon;",box);
  const sparkle=box.__Icon.sparkles({s:10});
  assert.equal(sparkle.type,"svg"); assert.equal(sparkle.props.className,"ic-sparkles"); assert.equal(sparkle.props.width,10);
  assert.ok(String(sparkle.children[0].props.d).startsWith("M12 3l1.8 4.7L18.5 9"));
  const plus=box.__Icon.plus({s:14});
  assert.equal(plus.props.className,undefined,"other icons carry no class"); assert.equal(plus.props.width,14);
});

test("2 one helper draws the mark; every price chip puts it on the left of the number", ()=>{
  assert.ok(gen.includes("function nbCreditMark(size){")&&gen.includes("window.nbCreditMark = nbCreditMark;"));
  assert.ok(gen.includes('R.createElement(ic,{ s:size||10, key:"credit-mark" })'));
  // the image price chip (Characters, Props, Locations, Shots, Storyboards, Lookbook: every Generate / Regenerate / edit button)
  assert.ok(/"\)\s*\+\(isSeedreamModel\(model\)[^\n]*\},\n\s*nbCreditMark\(\), txt\);/.test(gen),"the mark, then the number");
  // a batch's price, the cloud set build's price, and the video element's price
  assert.ok(art.includes('typeof window.nbCreditMark==="function" ? window.nbCreditMark() : null, String(total));'));
  assert.ok(cloud.includes('typeof window.nbCreditMark==="function"?window.nbCreditMark():null,String(credits));'));
  assert.ok(ve.includes('React.createElement("span",{className:"nb-cost ve-cost",title:"About "+cost.total+" credits"},'));
  assert.ok(ve.includes('typeof window.nbCreditMark==="function" ? window.nbCreditMark() : null, String(cost.total))),'));
  assert.ok(!ve.includes('" · "+cost.total+" credits"'),"no price written out as words on that button any more");
  // every chip in the app is one of these (a new one must use the mark too)
  for(const f of ["artroom.jsx","imagegen.jsx","blender-render-ui.jsx","video-elements.jsx","locations-ui.jsx","shots-ui.jsx","props.jsx","lookbook.jsx","storyboard.jsx","stage.jsx","voices-ui.jsx","camera-inspiration-ui.jsx","blender-style-ui.jsx"]){
    let src=""; try{ src=read("app/"+f); }catch(e){ continue; }
    for(const m of src.matchAll(/className:"nb-cost[^"]*"[\s\S]{0,700}?\)\)?[;,]/g)) assert.ok(/nbCreditMark\(\)/.test(m[0]),f+": a price chip without the mark");
  }
  // the Stage's own Generate price already read this way
  assert.ok(read("app/stage.jsx").includes('_stEl("span",{className:"stage2-generate-cost",title:o.costTitle||""}, Icon.sparkles&&_stEl(Icon.sparkles,{s:12}), String(cost))'));
});

test("3 one sparkle a button: the leading one steps aside while a price is shown", ()=>{
  assert.ok(css.includes(".nb-cost > svg{flex:none;width:10px;height:10px;color:inherit}"));
  assert.ok(css.includes(":is(button,.sheet-tools-item):has(.nb-cost) > svg.ic-sparkles{display:none}"));
  assert.ok(/\.nb-cost\{display:inline-flex;align-items:center;margin-left:7px;[^}]*gap:3px\}/.test(css));
});

test("4 the manifest has it (Frances is told the look, never the price: billing sentences are dropped for her), and the changed files have new cache keys", ()=>{
  const s=ai.slice(ai.indexOf('APP_FEATURES.push({ name:"Art Room cards: one look"'));
  assert.ok(s.length>100,"the manifest has the entry");
  const entry=s.slice(0,s.indexOf("\n"));
  for(const re of [/the sparkle mark, then the number of credits/,/Characters, Props, Locations, Shots/,/its own bordered box/,/larger than one inside a box/])
    assert.ok(re.test(entry),String(re));
  assert.ok(!/TURN|McKee|Claude|Anthropic|MUSE|Cinema Machine/.test(entry));
  for(const f of ["icons.jsx","imagegen.jsx","artroom.jsx","blender-render-ui.jsx","video-elements.jsx","ai.jsx","script.jsx"])
    assert.ok(["20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3"].some(k=>html.includes("app/"+f+"?v="+k+'"')),f+" has its new cache key");
  assert.ok(["20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3"].some(k=>html.includes("app/styles.css?v="+k+'"')));
});

console.log(pass+" passed, "+fail+" failed");
process.exit(fail?1:0);
