import os
import bpy,json
from pathlib import Path
OUT=Path(os.environ['KINOLOT_MCP_TRIAL_DIR'])
scene=bpy.context.scene
for o in scene.objects:
 if o.type=='MESH' and any(word in o.name.lower() for word in ['wall','ceiling','floor','door header']):
  for mod in list(o.modifiers):
   if mod.type=='BEVEL':o.modifiers.remove(mod)
# Close the deliberately closed test door's oversized side gaps, keeping the same aperture and door position.
bpy.data.objects['Closed bedroom door'].dimensions.x=.844
bpy.data.objects['Closed bedroom door'].dimensions.z=2.085
bpy.data.objects['Closed bedroom door'].location.z=1.0475
# Overlap shell joins outside the interior footprint to prevent light leaks at meeting wall edges.
bpy.data.objects['East wall'].dimensions.y=4.7
bpy.data.objects['North wall'].dimensions.x=4.3
for name in ['Floor','Ceiling']:
 bpy.data.objects[name].dimensions.x=4.3;bpy.data.objects[name].dimensions.y=4.7
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'bedroom-mcp.blend'))
print('Refined shell joins and closed-door gaps; furniture and camera poses unchanged.')
