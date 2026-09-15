/* Canonical page images stay visible; text remains available in a secondary
   disclosure for screen readers and exact full-scene reading. */
function StageSceneScreenplay({reference,imageReference,pageReferences,onPreview}){
  const r=reference||{}, targetBeats=Array.isArray(r.targetBeats)?r.targetBeats:[],
    sourceErrors=Array.isArray(r.errors)?r.errors:[],
    ready=!!r.hasSource && !sourceErrors.length,
    beats=targetBeats.join(", "),
    rawImages=imageReference && Array.isArray(imageReference.images) ? imageReference.images : [],
    imageErrors=imageReference && Array.isArray(imageReference.errors) ? imageReference.errors : [],
    signatureMismatch=!!(imageReference && imageReference.signature && r.signature
      && imageReference.signature!==r.signature),
    pages=rawImages.filter(image=>image && typeof image.url==="string" && image.url),
    imagesReady=!!imageReference && !imageErrors.length && !signatureMismatch && pages.length>0,
    pageTags=Array.isArray(pageReferences)?pageReferences:[],
    pageWord=pages.length===1?"page":"pages",
    imageStatus=imagesReady ? pages.length+" screenplay "+pageWord+" · full scene"
      : (!imageReference ? "Screenplay page images unavailable — renderer is not loaded."
        : signatureMismatch ? "Screenplay page images unavailable — source changed."
        : imageErrors.length ? "Screenplay page images unavailable — "+imageErrors.join(" ")
        : "Screenplay page images unavailable — no pages were rendered.");
  const pagePreview=image=>{
    if(typeof onPreview==="function")
      onPreview({url:image.url,label:image.label||"Screenplay page",kind:"image"});
  };
  return <details className={"stage2-screenplay-reference"+(ready?"":" missing")} data-testid="stage-scene-screenplay">
    <summary>
      <span className="stage2-screenplay-summary-copy">
        <span className="stage2-screenplay-heading">Scene screenplay</span>
        <span className="stage2-screenplay-status">{ready
          ? (imagesReady ? "Included as text + "+pages.length+" screenplay "+pageWord : "Included as text · pages unavailable")
          : "Missing"}</span>
      </span>
      {imagesReady && <span className="stage2-screenplay-summary-pages" aria-label={pages.length+" screenplay page image references"}>
        {pages.map((image,index)=>{
          const tag=pageTags.find(x=>x&&x.id===image.id)||pageTags[index]||{},
            mention=tag.mention||tag.tag||("@Image"+(index+1));
          return <span className="stage2-screenplay-summary-page" key={"summary:"+(image.id||index)}
            title={(image.label||"Screenplay page")+" · attached as "+mention}>
            <img data-testid="stage-screenplay-summary-image" src={image.url}
              alt={(image.label||"Screenplay page")+" attached as "+mention} />
            <small>{mention}</small>
          </span>;
        })}
      </span>}
    </summary>
    {ready ? <div className="stage2-screenplay-body">
      <p>Scene {r.sceneNo||r.sceneId} · {r.sceneTitle||"Full screenplay"}. The complete canonical scene is included; only {targetBeats.length===1?"beat ":"beats "}{beats||"selected"} {targetBeats.length===1?"is":"are"} performed.</p>
      <section className={"stage2-screenplay-pages"+(imagesReady?"":" unavailable")} aria-label="Canonical screenplay page images">
        <div className="stage2-screenplay-pages-head">
          <strong>Screenplay page references</strong>
          <span>{imageStatus}</span>
        </div>
        {imagesReady ? <div className="stage2-screenplay-page-grid">
          {pages.map((image,index)=>{
            const page=Number(image.page)||index+1, total=Number(image.totalPages)||pages.length;
            return <figure className="stage2-screenplay-page-card" key={image.id||((imageReference.signature||r.signature)+":"+page)}>
              <button type="button" className="stage2-screenplay-page-button"
                onClick={()=>pagePreview(image)}
                aria-label={(image.label||"Screenplay page")+" — open preview"}>
                <img data-testid="stage-screenplay-page-image" src={image.url}
                  alt={image.label||"Canonical screenplay page"} />
                <span className="stage2-screenplay-page-open">Open full page</span>
              </button>
              <figcaption>Page {page} of {total}{targetBeats.length ? " · target beat"+(targetBeats.length===1?" ":"s ")+beats+" highlighted" : ""}</figcaption>
            </figure>;
          })}
        </div> : <p className="stage2-screenplay-image-error" role="status">{imageStatus}</p>}
      </section>
      <details className="stage2-screenplay-reading">
        <summary>Accessible full scene screenplay text</summary>
        <details className="stage2-screenplay-target">
          <summary>{targetBeats.length===1?"This beat’s":"Selected beats’"} screenplay</summary>
          <pre data-testid="stage-target-beat-screenplay">{r.targetText}</pre>
        </details>
        <pre tabIndex={0} aria-label="Full scene screenplay" data-testid="stage-scene-screenplay-text">{r.fullText}</pre>
        <small>Canonical reading copy of the complete scene; the page images above are the same source with the selected target beat highlighted.</small>
      </details>
    </div> : <p role="status">{sourceErrors[0]||"Write this scene’s screenplay in the Writers’ Room before rendering."}</p>}
  </details>;
}
window.StageSceneScreenplay=StageSceneScreenplay;