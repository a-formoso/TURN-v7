# Isolated MCP bedroom experiment

Developer proof, not a production integration. These scripts reproduce the reviewed
local trial through a real MCP server and an add-on inside Blender. Customer film
data and the existing cloud worker are not read or changed.

The bedside asset is Side Table 01 by James Ray Cock, Poly Haven, CC0:
https://polyhaven.com/a/side_table_01 . Other furnishings and bedding are procedural.
No model, texture, generated image or Blender binary is committed.

Environment:
- KINOLOT_MCP_TRIAL_DIR: absolute output folder, outside customer data.
- KINOLOT_BLENDER_MCP_ADDON: reviewed addon.py from the MCP for Blender source.
- KINOLOT_MCP_SERVER: installed mcp-for-blender executable.

Reviewed MCP source: 2e4b0bc294694b1570d76ed01be657c22e6d02a0
from https://github.com/ahujasid/mcp-for-blender .

Start Blender with start_blender_mcp.py in interactive mode. On Linux a virtual
display is required by this add-on; a background Blender launch is rejected.
The listener stays on loopback. No persistent Codex configuration is changed.
Run mcp_client.py inspect to verify the empty scene. Execute enable_library.py,
then the import-side-table.json request with mcp_client.py tool. Execute
build_bedroom.py, render_views.py, then assemble_grid.py. The latter waits for
all four renders; it never combines a partial run. verify_scene.py checks the
actual scene through MCP. refine_room.py records the reviewed shell correction.

All four views use one saved scene. The fixture is a proposed bedroom, not Theo's
saved location. New modelling, lighting and assets also changed: this experiment
does not isolate MCP as the cause of improved output. Image-model styling is a
separate native-chat trial, not a call through Kinolot's provider connection.

The existing cloud render contract accepts bounded primitives only. Cloud MCP
authoring, detailed scene persistence and use from the app are still pending.
The proposed three-stage UI has not been implemented.
