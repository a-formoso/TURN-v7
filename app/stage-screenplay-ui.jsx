/* Reading context stays separate from editable direction and visual inputs. */
function StageSceneScreenplay({reference}){
  const r=reference||{}, ready=!!r.hasSource && !(r.errors||[]).length;
  const beats=(r.targetBeats||[]).join(", ");
  return <details className={"stage2-screenplay-reference"+(ready?"":" missing")} data-testid="stage-scene-screenplay">
    <summary>
      <span className="stage2-screenplay-heading">Scene screenplay</span>
      <span className="stage2-screenplay-status">{ready?"Included as text":"Missing"}</span>
    </summary>
    {ready ? <div className="stage2-screenplay-body">
      <p>Scene {r.sceneNo||r.sceneId} · {r.sceneTitle||"Full screenplay"}. Sent in full with your video prompt; no image slots used. Only {r.targetBeats.length===1?"beat ":"beats "}{beats} {r.targetBeats.length===1?"is":"are"} performed.</p>
      <details className="stage2-screenplay-target">
        <summary>{r.targetBeats.length===1?"This beat’s":"Selected beats’"} screenplay</summary>
        <pre data-testid="stage-target-beat-screenplay">{r.targetText}</pre>
      </details>
      <pre tabIndex={0} aria-label="Full scene screenplay" data-testid="stage-scene-screenplay-text">{r.fullText}</pre>
      <small>Reading context only—not a pictured page, visual reference, or instruction to perform other beats.</small>
    </div> : <p role="status">{(r.errors||[])[0]||"Write this scene’s screenplay in the Writers’ Room before rendering."}</p>}
  </details>;
}
window.StageSceneScreenplay=StageSceneScreenplay;