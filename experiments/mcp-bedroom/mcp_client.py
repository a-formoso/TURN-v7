import os
import asyncio,json,sys
from pathlib import Path
from mcp import ClientSession,StdioServerParameters
from mcp.client.stdio import stdio_client
BASE=Path(os.environ['KINOLOT_MCP_TRIAL_DIR'])
BASE.mkdir(parents=True,exist_ok=True)
async def main():
 params=StdioServerParameters(command=os.environ.get('KINOLOT_MCP_SERVER','mcp-for-blender'),args=[],env={'DISABLE_TELEMETRY':'1','BLENDER_MCP_DISABLE_TELEMETRY':'1','BLENDER_HOST':'127.0.0.1','BLENDER_PORT':'9876'})
 async with stdio_client(params) as (read,write):
  async with ClientSession(read,write) as session:
   await session.initialize()
   if len(sys.argv)>2 and sys.argv[1]=='tool':
    request=json.loads(Path(sys.argv[2]).read_text());result=await session.call_tool(request['name'],request.get('arguments',{}))
   elif len(sys.argv)<2 or sys.argv[1]=='inspect':
    listing=await session.list_tools();(BASE/'mcp-tools.json').write_text(listing.model_dump_json(indent=2))
    result=await session.call_tool('get_scene_info',{})
   else:
    code="import os\nos.environ['KINOLOT_MCP_TRIAL_DIR']="+repr(str(BASE))+"\n"+Path(sys.argv[1]).read_text()
    result=await session.call_tool('execute_blender_code',{'code':code,'user_prompt':'Isolated realistic bedroom trial; preserve the application and all saved film data.'})
   text=result.model_dump_json(indent=2)
   (BASE/'last-mcp-result.json').write_text(text)
   print(text[:7000])
asyncio.run(main())
