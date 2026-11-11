/* A fast diagnostic picture of four cameras from the same ray queries the coverage planner uses.
   Not the product's renderer: flat colours, distance shading and outlines only, to judge framing in seconds. */
import {deflateSync} from 'node:zlib';
import {writeFileSync} from 'node:fs';
function png(width,height,rgb){
  const crcTable=new Int32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c;});
  const crc=b=>{let c=-1;for(const x of b)c=crcTable[(c^x)&255]^(c>>>8);return (c^-1)>>>0;};
  const chunk=(type,data)=>{const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(type,4,'latin1');data.copy(out,8);
    out.writeUInt32BE(crc(out.subarray(4,data.length+8)),data.length+8);return out;};
  const head=Buffer.alloc(13);head.writeUInt32BE(width);head.writeUInt32BE(height,4);head[8]=8;head[9]=2;
  const raw=Buffer.alloc(height*(1+width*3));
  for(let y=0;y<height;y++){raw[y*(1+width*3)]=0;rgb.copy(raw,y*(1+width*3)+1,y*width*3,(y+1)*width*3);}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
export function grid(coverage,survey,scene,cameras,file,{w=480,h=270}={}){
  const keys=['TL','TR','BL','BR'],W=w*2+6,H=h*2+6,rgb=Buffer.alloc(W*H*3,24);
  const colour=new Map(survey.entries.map((e,i)=>[e,(scene.materials[scene.objects[i].material]?.baseColor||[.5,.5,.5]).map(c=>Math.pow(c,1/2.2))]));
  keys.forEach((key,k)=>{
    const pose=cameras[key],b=coverage.basis(pose),ox=(k%2)*(w+6),oy=Math.floor(k/2)*(h+6);
    const ids=new Array(w*h),depth=new Float32Array(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const u=(x+.5)/w,v=(y+.5)/h,tx=(2*u-1)*b.tx,ty=(1-2*v)*b.ty,d=[0,1,2].map(i=>b.f[i]+b.r[i]*tx+b.u[i]*ty),n=Math.hypot(...d);
      const hit=survey.cast(b.o,d.map(q=>q/n));ids[y*w+x]=hit?.entry||null;depth[y*w+x]=hit?hit.distance:1e9;
    }
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x,e=ids[i];let c=e?colour.get(e):[.28,.43,.57];
      const fog=e?Math.max(.45,1-depth[i]/(survey.diag*1.6)):1;
      // Outline where the surface or the depth changes, so plain boxes still read as shapes.
      const edge=x>0&&y>0&&(ids[i-1]!==e||ids[i-w]!==e||Math.abs(depth[i-1]-depth[i])>.04*depth[i]+.02||Math.abs(depth[i-w]-depth[i])>.04*depth[i]+.02);
      const at=((oy+y)*W+ox+x)*3;
      for(let j=0;j<3;j++)rgb[at+j]=Math.round(255*Math.min(1,c[j]*fog*(edge?.35:1)+(e?.08:0)));
    }
  });
  writeFileSync(file,png(W,H,rgb));
}
