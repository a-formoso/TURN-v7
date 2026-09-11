/* character-identity-ui.jsx — reusable existing-film identity conflict notice.
   The Art Room can mount window.CharacterIdentityNotice on its own cards. */

function CharacterIdentityNotice({ character, scenes, drafts, cast, onUpdate, readOnly }){
  const [resolutionNote,setResolutionNote] = React.useState("");
  if(!character || typeof window.turnIdentityReport!=="function") return null;

  /* Deliberately derive on every render.  A screenplay edit, cast edit, or
     hydrated film switch must change the notice without a polling loop. */
  const report = window.turnIdentityReport(character,{ scenes, drafts, cast });
  const name = character.name || "This character";
  const label = report.scriptPronouns || "the screenplay evidence";
  const hasIssue = report.status === "conflict";
  const chooseScreenplay = async ()=>{
    if(readOnly || !report.scriptPronouns || typeof onUpdate!=="function") return;
    const pronouns = report.scriptPronouns;
    const body = "This changes "+name+"'s canonical profile pronouns to "+pronouns+
      ". Existing profile/specifications and generated images may reflect the previous identity and may require re-drafting or regeneration. "+
      "TURN will not rewrite the screenplay or delete any assets.";
    let ok = false;
    if(typeof window.appConfirm==="function"){
      ok = await window.appConfirm({
        title:"Use "+pronouns+" from screenplay?",
        body,
        confirmLabel:"Use "+pronouns+" from screenplay",
        cancelLabel:"Keep profile",
      });
    }else if(typeof window.confirm==="function"){
      ok = window.confirm(body+" Continue?");
    }
    if(!ok) return;
    onUpdate(character.id,{ pronouns, pronounProvenance:"user", pronounSource:"user" });
    setResolutionNote("Canonical pronouns updated. Existing profile/specifications and images were left untouched — review the remaining evidence and explicitly re-draft or regenerate them when ready.");
  };
  const retainProfile = ()=>{
    setResolutionNote("Profile retained. Run the existing Consistency Check to propose screenplay rewrites; nothing was changed automatically.");
    if(typeof window.turnOpenConsistencyCheck==="function") window.turnOpenConsistencyCheck({characterId:character.id});
    else{
      try{ window.dispatchEvent(new CustomEvent("turn-open-consistency-check",{detail:{characterId:character.id}})); }catch(e){}
    }
  };
  const sourceName = source => source==="screenplay" ? "Screenplay"
    : source==="visual" ? "Visual spec" : "Profile";
  const style = {
    margin:"12px 0 2px",padding:"11px 12px",border:"1px solid",
    borderColor:hasIssue?"var(--alert, #b55)":"var(--line)",
    borderRadius:"var(--r-m, 8px)",background:hasIssue?"color-mix(in srgb, var(--alert, #b55) 8%, transparent)":"var(--bg-2)",
    fontSize:11.5,lineHeight:1.45,color:"var(--txt-1)",
  };
  const evidence = report.issues.map((issue,i)=>
    React.createElement("div",{key:sourceName(issue.source)+"-"+i,style:{marginTop:6}},
      React.createElement("b",null,sourceName(issue.source)+(issue.sceneNo!=null?" · Sc."+issue.sceneNo:""),": "),
      issue.message,
      issue.quote && React.createElement("div",{style:{marginTop:3,paddingLeft:8,borderLeft:"2px solid var(--line-2)",fontStyle:"italic",color:"var(--txt-2)"}},
        "“"+issue.quote+"”")));
  const advisories = (report.advisories||[]).map((item,i)=>
    React.createElement("div",{key:"advisory-"+i,style:{marginTop:6,color:"var(--txt-2)"}},
      React.createElement("b",null,"Guidance: "),
      item.message,
      item.quote && React.createElement("div",{style:{marginTop:3,paddingLeft:8,borderLeft:"2px solid var(--line-2)",fontStyle:"italic"}},
        "“"+item.quote+"”")));
  const actions = report.scriptPronouns && report.scriptPronouns!==report.pronouns
    ? React.createElement("div",{style:{display:"flex",flexWrap:"wrap",gap:7,marginTop:10}},
        React.createElement("button",{type:"button",className:"char-draft-btn",disabled:!!readOnly,onClick:chooseScreenplay},
          "Use "+report.scriptPronouns+" from screenplay"),
        React.createElement("button",{type:"button",className:"char-draft-btn",onClick:retainProfile},
          "Retain profile · run Consistency Check"))
    : null;

  if(report.status==="conflict"){
    return React.createElement("div",{className:"character-identity-notice conflict",style,role:"alert"},
      React.createElement("div",{style:{fontWeight:700,color:"var(--txt-0)"}},"Existing-film identity conflict"),
      React.createElement("div",{style:{marginTop:3}},"The sources disagree about pronouns for ",React.createElement("b",null,name),". Review the exact evidence before changing canon."),
      evidence,advisories,actions,
      React.createElement("div",{style:{marginTop:8,color:"var(--txt-2)"}},
        resolutionNote || "No screenplay text or assets will be rewritten automatically."),
      React.createElement("div",{style:{marginTop:6,fontSize:10,color:"var(--txt-3)"}},
        "Existing visual sheets are not deleted. If you change the profile, re-draft the specification and regenerate only with explicit approval."));
  }
  if(report.status==="unset"){
    return React.createElement("div",{className:"character-identity-notice unset",style,role:"status"},
      React.createElement("div",{style:{fontWeight:700,color:"var(--txt-0)"}},"Pronouns unset — identity unverified"),
      React.createElement("div",{style:{marginTop:3}},report.scriptPronouns
        ? "The screenplay has direct evidence for "+report.scriptPronouns+"; choose explicitly or retain the profile and run Consistency Check."
        : "No direct identity evidence was detected. Choose explicit pronouns before treating the identity as canon."),
      advisories,actions,
      resolutionNote && React.createElement("div",{style:{marginTop:7,color:"var(--txt-2)"}},resolutionNote));
  }
  if(report.status==="unverified"){
    return React.createElement("div",{className:"character-identity-notice unverified",style,role:"status"},
      React.createElement("div",{style:{fontWeight:700,color:"var(--txt-0)"}},"Identity check unverified"),
      React.createElement("div",{style:{marginTop:3}},"No direct conflicting identity evidence was detected. This is not a verification pass."),
      advisories,
      resolutionNote && React.createElement("div",{style:{marginTop:7,color:"var(--txt-2)"}},resolutionNote));
  }
  return null;
}
window.CharacterIdentityNotice = CharacterIdentityNotice;