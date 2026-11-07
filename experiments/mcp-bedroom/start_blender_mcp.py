import os
import bpy, importlib.util, sys, time
from pathlib import Path
addon_path=Path(os.environ['KINOLOT_BLENDER_MCP_ADDON'])
bpy.ops.wm.read_factory_settings(use_empty=True)
spec=importlib.util.spec_from_file_location('kinolot_trial_blender_mcp',str(addon_path))
addon=importlib.util.module_from_spec(spec);sys.modules[spec.name]=addon;spec.loader.exec_module(addon)
addon.register()
bpy.context.scene.blendermcp_auto_start_server=False
server=addon.BlenderMCPServer(host='127.0.0.1',port=9876)
bpy.types.blendermcp_server=server
server.start()
if not server.running: raise RuntimeError('Blender MCP listener did not start')
print('Isolated Blender MCP trial ready',flush=True)
