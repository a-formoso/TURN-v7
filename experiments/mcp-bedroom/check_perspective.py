import os
import bpy,json,math
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
from pathlib import Path
scene=bpy.context.scene;cam=bpy.data.objects['Camera TR'];bpy.context.view_layer.update()
forward=cam.matrix_world.to_quaternion()@Vector((0,0,-1))
lines={
 'south-west room corner':[(0,0,.1),(0,0,2.5)],
 'door left casing':[(1.055,.035,.1),(1.055,.035,2.1)],
 'window near jamb':[(.006,3.75,.8),(.006,3.75,2.1)],
 'window far jamb':[(.006,2.45,.8),(.006,2.45,2.1)]}
projected={}
for name,pts in lines.items():
 uv=[world_to_camera_view(scene,cam,Vector(p)) for p in pts]
 pixels=[[v.x*768,(1-v.y)*432] for v in uv]
 dx=pixels[1][0]-pixels[0][0];dy=pixels[1][1]-pixels[0][1]
 projected[name]={'worldPoints':pts,'pixelsBottomTop':pixels,'angleFromImageVerticalDegrees':math.degrees(math.atan2(dx,-dy))}
window_geometry=[]
for o in scene.objects:
 if o.name.startswith('Window frame vertical'):
  z=o.matrix_world.to_3x3()@Vector((0,0,1));z.normalize();window_geometry.append({'name':o.name,'worldVerticalDirection':list(z),'rotationDegrees':[math.degrees(a) for a in o.rotation_euler]})
assert all(abs(v['worldVerticalDirection'][0])<1e-6 and abs(v['worldVerticalDirection'][1])<1e-6 for v in window_geometry)
r={'readOnly':True,'camera':'TR','lensMm':cam.data.lens,'cameraPitchDegrees':math.degrees(math.asin(forward.z)),'windowGeometry':window_geometry,'projectedLines':projected,'interpretation':'Upright parallel world edges project to different slopes in this tilted perspective camera. This checks Blender geometry/projection, not exact styled-image fidelity.'}
(Path(os.environ['KINOLOT_MCP_TRIAL_DIR']) / 'perspective-check.json').write_text(json.dumps(r,indent=2))
print(json.dumps(r))
