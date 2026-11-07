import os
from PIL import Image
from pathlib import Path
import json,math,statistics
P=Path(os.environ['KINOLOT_MCP_TRIAL_DIR'])
files={'Blender':P/'render_TR.png','Styled':P/'styled-grid.png'}
results={}
for kind,path in files.items():
 im=Image.open(path).convert('RGB')
 if kind=='Styled':im=im.crop((im.width//2,0,im.width,im.height//2))
 sx=im.width/768;sy=im.height/432
 def value(x,y):
  r,g,b=im.getpixel((x,y));return (.2126*r+.7152*g+.0722*b)/255
 pts=[]
 for y in range(round(64*sy),round(205*sy),3):
  # Search the observed outer window-frame edge around its independently predicted Blender position.
  expected=(661.9658+(y/sy-40.0423)*(635.9138-661.9658)/(225.1051-40.0423))*sx
  lo=max(4,round(expected-25*sx));hi=min(im.width-4,round(expected+25*sx))
  samples=[(sum(value(x+k,y) for k in [1,2,3])/3-sum(value(x-k,y) for k in [1,2,3])/3,x) for x in range(lo,hi)]
  contrast,x=max(samples)
  if contrast>.08:pts.append((y,x,contrast))
 assert len(pts)>=20,(kind,len(pts))
 def fit(ps):
  my=statistics.mean(p[0] for p in ps);mx=statistics.mean(p[1] for p in ps)
  slope=sum((p[0]-my)*(p[1]-mx) for p in ps)/sum((p[0]-my)**2 for p in ps)
  return slope,mx-slope*my
 slope,intercept=fit(pts)
 good=[p for p in pts if abs(p[1]-slope*p[0]-intercept)<3*sx]
 assert len(good)>=20,(kind,len(good))
 slope,intercept=fit(good)
 rms=(sum((x-slope*y-intercept)**2 for y,x,c in good)/len(good))**.5
 results[kind]={'angleFromImageVerticalDegrees':math.degrees(math.atan(-slope)),'edgeSamples':len(good),'rmsPixels':rms,'cropSize':im.size,'method':'Positive luminance transition at the outer left window jamb, rows corresponding to source y=64..205; linear fit with outlier rejection.'}
results['limits']='Measures one clearly visible edge, not all geometry or exact styled-image correspondence.'
(P/'window-edge-measurement.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))
