import os
import bpy, math, json
from mathutils import Vector
from pathlib import Path
OUT=Path(os.environ['KINOLOT_MCP_TRIAL_DIR']);OUT.mkdir(exist_ok=True)
scene=bpy.context.scene
# Retain the model imported through MCP; this is a new isolated scene, never a saved film.
imported=[o for o in scene.objects if o.type=='MESH']
assert imported,'The imported bedside asset is required for this trial.'
points=[o.matrix_world@Vector(c) for o in imported for c in o.bound_box]
lo=Vector([min(p[i] for p in points) for i in range(3)]);hi=Vector([max(p[i] for p in points) for i in range(3)])
scale=min(.48/(hi.x-lo.x),.45/(hi.y-lo.y),.55/(hi.z-lo.z))
anchor=bpy.data.objects.new('Bedside imported asset',None);scene.collection.objects.link(anchor)
for o in imported:
 matrix=o.matrix_world.copy();o.parent=anchor;o.matrix_world=matrix
anchor.scale=(scale,)*3;anchor.location=(.34-(lo.x+hi.x)*scale/2,3.98-(lo.y+hi.y)*scale/2,-lo.z*scale)

def mat(name,color,rough=.5,wood=False,fabric=False):
 m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough
 tex=n.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=4 if wood else 160;tex.inputs['Detail'].default_value=3
 coord=n.new('ShaderNodeTexCoord');mapping=n.new('ShaderNodeVectorMath');mapping.operation='MULTIPLY';mapping.inputs[1].default_value=(3,35,4) if wood else (1,1,1);l.new(coord.outputs['Generated'],mapping.inputs[0]);l.new(mapping.outputs[0],tex.inputs['Vector'])
 ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].position=.15;ramp.color_ramp.elements[1].position=.85
 for e,k in zip(ramp.color_ramp.elements,[.7,1.15]):e.color=(*(min(.95,c*k) for c in color),1)
 l.new(tex.outputs['Fac'],ramp.inputs[0]);l.new(ramp.outputs['Color'],p.inputs['Base Color'])
 bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.12 if wood else .10;bump.inputs['Distance'].default_value=.003 if wood else .001;l.new(tex.outputs['Fac'],bump.inputs['Height']);l.new(bump.outputs[0],p.inputs['Normal'])
 return m
wood=mat('Natural oak',(.42,.28,.15),.4,wood=True);paint=mat('Muted sage plaster',(.42,.48,.39),.85);floor=mat('Warm neutral floor',(.34,.31,.27),.65);linen=mat('Cotton duvet',(.69,.67,.6),.93,fabric=True);pillowmat=mat('Pillow cotton',(.81,.79,.72),.94,fabric=True);metal=mat('Brushed dark metal',(.09,.10,.10),.35)

def box(name,pos,size,material,bevel=.008):
 bpy.ops.mesh.primitive_cube_add(size=1,location=pos);o=bpy.context.object;o.name=name;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if bevel:
  b=o.modifiers.new('Soft manufactured edges','BEVEL');b.width=min(bevel,min(size)*.35);b.segments=4
  o.modifiers.new('Weighted surface normals','WEIGHTED_NORMAL')
 o.data.materials.append(material);return o
# Room shell: real apertures rather than dark surfaces masquerading as objects.
box('Floor',(2,2.2,-.06),(4.15,4.55,.12),floor)
box('North wall',(2,4.475,1.3),(4.15,.15,2.6),paint)
box('East wall',(4.075,2.2,1.3),(.15,4.4,2.6),paint)
box('South left',(0.5375,-.075,1.3),(1.075,.15,2.6),paint)
box('South right',(2.9625,-.075,1.3),(2.075,.15,2.6),paint)
box('Door header',(1.5,-.075,2.35),(.85,.15,.5),paint)
for y,size in [(1.225,2.45),(4.075,.65)]:box('Window wall side',(-.075,y,1.3),(.15,size,2.6),paint)
box('Below window',(-.075,3.1,.4),(.15,1.3,.8),paint);box('Above window',(-.075,3.1,2.35),(.15,1.3,.5),paint)
box('Ceiling',(2,2.2,2.675),(4.15,4.55,.15),paint)
trim=mat('Window and door painted timber',(.72,.71,.64),.45)
for y in [2.45,3.75]:box('Window frame vertical',(.006,y,1.45),(.09,.05,1.36),trim,.004)
for z in [.8,2.1]:box('Window frame horizontal',(.006,3.1,z),(.09,1.35,.05),trim,.004)
box('Window sill',(.045,3.1,.79),(.22,1.4,.04),trim,.005)
box('Closed bedroom door',(1.5,-.01,1.03),(.815,.045,2.06),trim,.005)
for x in [1.055,1.945]:box('Door casing',(x,.035,1.06),(.05,.035,2.12),trim,.004)
box('Door casing top',(1.5,.035,2.11),(.94,.035,.05),trim,.004)
box('Door handle',(1.80,.034,1.0),(.10,.035,.018),metal,.006)
# Full-sized single bed: modest frame, rounded mattress, shaped pillow and draped cloth.
box('Bed frame',(1.15,3.30,.25),(1.03,2.02,.22),wood,.018)
for x in [.72,1.58]:
 for y in [2.43,4.15]:box('Bed foot',(x,y,.10),(.055,.055,.20),wood,.009)
box('Headboard',(1.15,4.265,.62),(1.04,.07,.86),wood,.02)
box('Mattress',(1.15,3.30,.45),(.98,1.94,.20),pillowmat,.075)
pillow=box('Soft pillow',(1.15,3.98,.64),(.72,.43,.18),pillowmat,.075);pillow.rotation_euler.z=.035
# Cloth surface has actual shallow folds and hanging edges, not a thick rectangular block.
verts=[];faces=[];nx=44;ny=70
for j in range(ny+1):
 y=-.84+1.68*j/ny
 for i in range(nx+1):
  x=-.525+1.05*i/nx
  edge=.10*(abs(x)/.525)**12+.10*(max(0,-y)/.84)**12
  wrinkle=.006*math.sin(x*37+y*19)+.004*math.sin(y*41-x*12)+.003*math.cos(y*74+x*7)
  verts.append((1.15+x,3.04+y,.575-edge+wrinkle))
for j in range(ny):
 for i in range(nx):
  a=j*(nx+1)+i;faces.append((a,a+1,a+nx+2,a+nx+1))
mesh=bpy.data.meshes.new('Duvet cloth mesh');mesh.from_pydata(verts,[],faces);mesh.update();duvet=bpy.data.objects.new('Draped cotton duvet',mesh);scene.collection.objects.link(duvet);duvet.data.materials.append(linen)
for f in mesh.polygons:f.use_smooth=True
solid=duvet.modifiers.new('Cloth thickness','SOLIDIFY');solid.thickness=.009
sub=duvet.modifiers.new('Soft folds','SUBSURF');sub.levels=1;sub.render_levels=1
# Desk and chair use furniture-scale joinery, thin tops and tapered-looking legs.
box('Desk top',(3.23,3.34,.735),(1.20,.64,.035),wood,.012)
for x in [2.72,3.74]:
 for y in [3.10,3.58]:box('Desk leg',(x,y,.36),(.04,.04,.72),wood,.006)
box('Desk apron',(3.23,3.57,.66),(1.08,.025,.12),wood,.006)
box('Chair seat',(3.23,2.55,.455),(.43,.43,.035),wood,.018)
for x in [3.05,3.41]:
 for y in [2.38,2.72]:box('Chair leg',(x,y,.23),(.025,.025,.46),wood,.005)
for x in [3.04,3.42]:box('Chair back upright',(x,2.37,.65),(.025,.028,.46),wood,.005)
box('Chair back',(3.23,2.37,.79),(.41,.027,.16),wood,.02)
# Wardrobe shell and separate door fronts; handles are small hardware.
box('Wardrobe body',(3.45,.65,1.025),(.9,.58,1.99),wood,.009)
for x in [3.225,3.675]:box('Wardrobe door',(x,.956,1.04),(.438,.025,1.88),wood,.008)
for x in [3.40,3.50]:box('Wardrobe handle',(x,.979,1.07),(.012,.022,.13),metal,.005)
# Soft daylight. No photographic furniture or alternative generated room is used as a reference.
world=bpy.data.worlds.new('Daylight world');scene.world=world;world.use_nodes=True
n=world.node_tree.nodes;l=world.node_tree.links;sky=n.new('ShaderNodeTexSky');sky.sky_type='NISHITA';sky.sun_elevation=.65;sky.sun_rotation=3.2;l.new(sky.outputs[0],n.get('Background').inputs[0]);n.get('Background').inputs[1].default_value=.18
light=bpy.data.lights.new('Window daylight','AREA');light.energy=220;light.shape='RECTANGLE';light.size=1.2;light.size_y=1.1
o=bpy.data.objects.new('Window daylight',light);scene.collection.objects.link(o);o.location=(-.3,3.1,1.6);o.rotation_euler=(Vector((2.5,2.6,.7))-o.location).to_track_quat('-Z','Y').to_euler()
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=32;scene.cycles.use_denoising=True;scene.cycles.max_bounces=6
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=0
scene.render.resolution_x=768;scene.render.resolution_y=432;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB'
poses={'TL':((.42,.42,1.60),(1.95,2.95,.95),22),'TR':((3.55,3.98,1.75),(1.8,1.70,1.0),22),'BL':((2.55,2.0,1.45),(1.05,3.72,.80),35),'BR':((1.1,2.7,1.45),(3.25,2.8,1.0),28)}
for name,(pos,target,lens) in poses.items():
 data=bpy.data.cameras.new(name);data.lens=lens;data.sensor_width=36;data.sensor_fit='HORIZONTAL';data.clip_start=.05
 cam=bpy.data.objects.new('Camera '+name,data);scene.collection.objects.link(cam);cam.location=pos;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
scene.camera=bpy.data.objects['Camera TL'];bpy.context.view_layer.update()
# Embedded textures keep the saved scene reusable independently of the temporary import download.
bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'bedroom-mcp.blend'))
(OUT/'scene-inventory.json').write_text(json.dumps({'method':'Scene authored through the real MCP execute_blender_code tool in a live Blender process.','asset':{'id':'side_table_01','source':'Poly Haven','author':'James Ray Cock','license':'CC0'},'objects':[{'name':o.name,'type':o.type,'position':list(o.location),'dimensions':list(o.dimensions)} for o in scene.objects],'cameras':{k:{'position':list(bpy.data.objects['Camera '+k].location),'lens':v[2]} for k,v in poses.items()},'limits':['Disposable room, not actual Theo saved data.','New modelling, materials and render settings differ from the old prototype; this is not an MCP-only quality comparison.','The closed door is an explicit test design choice; no surrounding house is modelled.']},indent=2))
print(json.dumps({'saved':str(OUT/'bedroom-mcp.blend'),'objects':len(scene.objects),'importedMeshCount':len(imported),'cameras':list(poses)}))
