import os
import bpy,json,hashlib
from mathutils import Vector
from pathlib import Path
OUT=Path(os.environ['KINOLOT_MCP_TRIAL_DIR'])
scene=bpy.context.scene;bpy.context.view_layer.update()
def bounds(o):
 points=[o.matrix_world@Vector(c) for c in o.bound_box]
 return [[min(p[i] for p in points) for i in range(3)],[max(p[i] for p in points) for i in range(3)]]
meshes=[o for o in scene.objects if o.type=='MESH'];records=[{'name':o.name,'bounds':bounds(o),'vertices':len(o.data.vertices)} for o in meshes]
assert len([o for o in scene.objects if o.type=='CAMERA'])==4
assert abs(scene.render.resolution_x/scene.render.resolution_y-16/9)<1e-9
for name in ['Soft pillow','Draped cotton duvet','Mattress','Headboard','Desk top','Chair seat','Closed bedroom door']:
 assert name in bpy.data.objects,name
assert len(bpy.data.objects['Draped cotton duvet'].data.vertices)>2000
assert abs(bpy.data.objects['Desk top'].dimensions.z-.035)<1e-6
assert abs(bpy.data.objects['Desk leg'].dimensions.x-.04)<1e-6
imported=[o for o in meshes if o.parent and o.parent.name=='Bedside imported asset'];assert imported
b=[bounds(o) for o in imported];lower=[min(v[0][i] for v in b) for i in range(3)];upper=[max(v[1][i] for v in b) for i in range(3)]
assert abs(lower[2])<.00001,(lower,upper)
assert lower[0]>=.075 and upper[0]<=.64 and upper[1]<=4.325,(lower,upper)
geometrySignature=hashlib.sha256(json.dumps(records,sort_keys=True).encode()).hexdigest()
result={'checks':'passed','meshes':len(meshes),'geometrySignature':geometrySignature,'bedsideWorldBounds':[lower,upper],'cameras':{key:{'position':list(bpy.data.objects['Camera '+key].location),'lens':bpy.data.objects['Camera '+key].data.lens} for key in ['TL','TR','BL','BR']},'resolutionPerPanel':[scene.render.resolution_x,scene.render.resolution_y],'method':'One static saved scene; no per-panel scene regeneration or animation.'}
(OUT/'geometry-verification.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result))
