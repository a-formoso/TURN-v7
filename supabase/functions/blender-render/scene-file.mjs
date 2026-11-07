export const SCENE_FILE_MAX_BYTES=33554432;

export async function readSceneFile(request){
  const declared=Number(request.headers.get('content-length')||0);
  if(declared>SCENE_FILE_MAX_BYTES)throw new Error('scene_too_large');
  const reader=request.body?.getReader();
  if(!reader)throw new Error('invalid_scene_file');
  let size=0;const chunks=[];
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      size+=value.length;
      if(size>SCENE_FILE_MAX_BYTES){await reader.cancel();throw new Error('scene_too_large');}
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  if(size<64||!/^BLENDER[-_][vV]\d{3}$/.test(new TextDecoder().decode(bytes.subarray(0,12))))throw new Error('invalid_scene_file');
  return bytes;
}
