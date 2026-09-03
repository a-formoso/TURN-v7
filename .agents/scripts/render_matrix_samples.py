import fitz, os
p='uploads/The Matrix - screenplay.pdf'
out='.agents/outputs/matrix-pages'
doc=fitz.open(p)
print('pages',doc.page_count,'metadata',doc.metadata)
# Representative pages: title/open, early setup, act transitions/mid-film/climax/end
indices=sorted(set(i for i in [0,1,2,9,24,49,74,99,119,doc.page_count-2,doc.page_count-1] if 0<=i<doc.page_count))
for i in indices:
    page=doc[i]
    pix=page.get_pixmap(matrix=fitz.Matrix(1.5,1.5), alpha=False)
    path=f'{out}/page-{i+1:03d}.png'
    pix.save(path)
    text=page.get_text('text')
    with open(f'{out}/page-{i+1:03d}.txt','w',encoding='utf-8') as f:f.write(text)
    print(i+1, page.rect, len(text), path)
