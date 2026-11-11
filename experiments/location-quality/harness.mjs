/* Offline harness: the app's real floor-plan and set-building code in Node. No account, network or saved-film writes.
   Private film data is read from outside the repository and never written into it. */
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
export const root=new URL('../../',import.meta.url);
export async function load(extra=[]){
  const b={console,crypto,TextEncoder,URL,nbEpoch:()=>1,location:{hostname:'localhost'},turnIsAdmin:true,
    TURN_SUPABASE:{setBuild:true,setBuildMcp:true},nbGetMeta:()=>null,nbGetImage:()=>'',scenesInStoryOrder:x=>x||[]};
  b.window=b;vm.createContext(b);
  for(const f of ['locations.jsx','blender-render-contract.js','blender-set-kitchen.js','blender-set-detail.js','blender-render.js','camera-angle-preview.js',...extra])
    vm.runInContext(readFileSync(new URL('app/'+f,root),'utf8'),b,{filename:f});
  const T=await import(new URL('app/vendor/three/r180/three.module.min.js',root));
  return {b,T};
}
export function film(b,path){
  const list=JSON.parse(readFileSync(path,'utf8'));b.turnContinuity={locations:list};return list;
}
