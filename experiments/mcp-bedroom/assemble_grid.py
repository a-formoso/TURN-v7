import os
from pathlib import Path
from PIL import Image
import time,json,hashlib
p=Path(os.environ['KINOLOT_MCP_TRIAL_DIR']);deadline=time.monotonic()+240
while True:
 status=json.loads((p/'render-status.json').read_text())
 if status['status']=='failed':raise RuntimeError(status)
 if status['status']=='complete':break
 if time.monotonic()>deadline:raise TimeoutError('Render is still running; no partial grid was assembled.')
 time.sleep(2)
im=Image.new('RGB',(1536,864))
for i,k in enumerate(['TL','TR','BL','BR']):
 with Image.open(p/('render_'+k+'.png')) as panel:
  assert panel.size==(768,432)
  im.paste(panel,((i%2)*768,(i//2)*432))
im.save(p/'grid-blender.png')
report=json.loads((p/'trial-report.json').read_text());report['status']='Blender renders complete; styling comparison pending';report['sceneSha256']=hashlib.sha256((p/'bedroom-mcp.blend').read_bytes()).hexdigest();report['geometryVerification']='geometry-verification.json';report['sourceGrid']='grid-blender.png';report['dimensions']={'sheet':[1536,864],'panel':[768,432]};(p/'trial-report.json').write_text(json.dumps(report,indent=2)+'\n')
print('Four refined Blender renders assembled at exact 16:9 with no resizing or cropping.')
