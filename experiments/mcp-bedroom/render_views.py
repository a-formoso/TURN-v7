import os
import bpy,json,time
from pathlib import Path
OUT=Path(os.environ['KINOLOT_MCP_TRIAL_DIR'])
scene=bpy.context.scene
scene.cycles.samples=32
queue=['TL','TR','BL','BR'];complete=[]
def render_next():
 if not queue:
  (OUT/'render-status.json').write_text(json.dumps({'status':'complete','panels':complete}))
  return None
 key=queue.pop(0)
 (OUT/'render-status.json').write_text(json.dumps({'status':'rendering','current':key,'panels':complete}))
 try:
  scene.camera=bpy.data.objects['Camera '+key];scene.render.filepath=str(OUT/('render_'+key+'.png'))
  bpy.ops.render.render(write_still=True)
  complete.append(key)
  (OUT/'render-status.json').write_text(json.dumps({'status':'rendered','last':key,'panels':complete}))
 except Exception as e:
  (OUT/'render-status.json').write_text(json.dumps({'status':'failed','error':str(e),'panels':complete}));return None
 return .5
bpy.app.timers.register(render_next,first_interval=1.0)
print('Scheduled four actual Blender renders through MCP.')
