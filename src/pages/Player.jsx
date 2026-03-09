
import {useEffect,useRef,useState} from "react"
import {io} from "socket.io-client"

let token = localStorage.getItem("bingoToken")
const socket = io(window.location.origin,{
 auth:{token},
 transports:["websocket"],
 upgrade:false
})

export default function Player(){

const [card,setCard]=useState(null)
const [state,setState]=useState(null)
const [nowMs,setNowMs]=useState(Date.now())
const [socketError,setSocketError]=useState("")
const [freshCells,setFreshCells]=useState(new Set())
const [raffleOpen,setRaffleOpen]=useState(false)
const [raffleLoading,setRaffleLoading]=useState(false)
const [raffleStatus,setRaffleStatus]=useState("")
const [raffleFirstName,setRaffleFirstName]=useState("")
const [rafflePhone,setRafflePhone]=useState("")
const [raffleEmail,setRaffleEmail]=useState("")
const previousTriggeredRef = useRef(new Set())
const vibrationTimeoutRef = useRef(null)
const hapticsUnlockedRef = useRef(false)
const winnerTierRef = useRef(null)

function triggerHaptics(pattern){
 if(typeof navigator==="undefined" || typeof navigator.vibrate!=="function") return
 if(!hapticsUnlockedRef.current) return
 try{
  navigator.vibrate(pattern)
 }catch{
  // best effort
 }
}

useEffect(()=>{
 const unlockHaptics=()=>{ hapticsUnlockedRef.current = true }
 window.addEventListener("touchstart",unlockHaptics,{passive:true})
 window.addEventListener("pointerdown",unlockHaptics,{passive:true})
 window.addEventListener("keydown",unlockHaptics)

const onToken=(t)=>{
 localStorage.setItem("bingoToken",t)
 token=t
}

const onCard=(nextCard)=>setCard(nextCard)
const onState=(nextState)=>setState(nextState)
const onError=(errorCode)=>{
 if(errorCode==="no_cards_generated"){
  setSocketError("Initialisation du bingo en cours, reessaie dans quelques secondes.")
  return
 }
 if(typeof errorCode==="string"){
  setSocketError(`Connexion: ${errorCode}`)
  return
 }
 setSocketError("Connexion indisponible temporairement.")
}

socket.on("token",onToken)
socket.on("card",onCard)
socket.on("state",onState)
socket.on("error",onError)

return ()=>{
 socket.off("token",onToken)
 socket.off("card",onCard)
 socket.off("state",onState)
 socket.off("error",onError)
 if(vibrationTimeoutRef.current){
  clearTimeout(vibrationTimeoutRef.current)
 }
 window.removeEventListener("touchstart",unlockHaptics)
 window.removeEventListener("pointerdown",unlockHaptics)
 window.removeEventListener("keydown",unlockHaptics)
}

},[])

useEffect(()=>{
 const interval = setInterval(()=>setNowMs(Date.now()),1000)
 return ()=>clearInterval(interval)
},[])

useEffect(()=>{
 if(!card || !state?.triggered) return

 const currentTriggered = new Set(state.triggered)
 const previousTriggered = previousTriggeredRef.current

 const newlyTriggered = []
 for(const eventName of currentTriggered){
  if(!previousTriggered.has(eventName)) newlyTriggered.push(eventName)
 }

 if(newlyTriggered.length===0){
  previousTriggeredRef.current = currentTriggered
  return
 }

 const newIndexes = card
  .map((eventName,index)=>newlyTriggered.includes(eventName)?index:-1)
  .filter((index)=>index!==-1)

 if(newIndexes.length>0){
  setFreshCells(new Set(newIndexes))

  triggerHaptics([80,40,120])

  if(vibrationTimeoutRef.current){
   clearTimeout(vibrationTimeoutRef.current)
  }
  vibrationTimeoutRef.current = setTimeout(()=>setFreshCells(new Set()),1400)
 }

 previousTriggeredRef.current = currentTriggered
},[card,state])

const boardCols = state?.board?.cols || 5
const boardRows = state?.board?.rows || 4
const safeCard = Array.isArray(card) ? card : []
const activeCount = safeCard.filter((eventName)=>state?.triggered.includes(eventName)).length
const lineGroups = Array.from({length:boardRows},(_,rowIndex)=>
 safeCard.slice(rowIndex*boardCols,(rowIndex+1)*boardCols)
)
const rowMissingCounts = lineGroups.map((line)=>
 line.reduce((missing,eventName)=>missing+(state?.triggered.includes(eventName)?0:1),0)
)
const sortedMissingCounts = [...rowMissingCounts].sort((a,b)=>a-b)
const tierProgress = Array.from({length:boardRows},(_,index)=>{
 const tier=index+1
 const missing=sortedMissingCounts.slice(0,tier).reduce((sum,value)=>sum+value,0)
 const label=tier===boardRows?"Carton plein":`${tier} ligne${tier>1?"s":""}`
 return {tier,label,missing}
})

function winnerTokensForTier(tier){
 const byLine = state?.winners?.byLine
 if(byLine && Array.isArray(byLine[`line_${tier}`])) return byLine[`line_${tier}`]
 if(tier===1 && Array.isArray(state?.winners?.one)) return state.winners.one
 if(tier===2 && Array.isArray(state?.winners?.two)) return state.winners.two
 if(tier===3 && Array.isArray(state?.winners?.three)) return state.winners.three
 if(tier===boardRows && Array.isArray(state?.winners?.full)) return state.winners.full
 return []
}

const wonTier = tierProgress.find(({tier})=>winnerTokensForTier(tier).includes(token))
const campaignEndAtMs = state?.campaign?.endAt ? Date.parse(state.campaign.endAt) : null
const campaignRemainingMs = campaignEndAtMs ? Math.max(0,campaignEndAtMs - nowMs) : null
const liveStreamUrl = state?.liveStream?.url || ""

function parseYouTubeVideoId(rawUrl){
 if(typeof rawUrl!=="string" || !rawUrl.trim()) return ""
 try{
  const url = new URL(rawUrl)
  const host = url.hostname.replace(/^www\./,"")
  if(host==="youtu.be"){
   return url.pathname.replace("/","").trim()
  }
  if(host==="youtube.com" || host==="m.youtube.com"){
   const fromQuery = url.searchParams.get("v")
   if(fromQuery) return fromQuery
   const pathParts = url.pathname.split("/").filter(Boolean)
   const liveIndex = pathParts.indexOf("live")
   if(liveIndex!==-1 && pathParts[liveIndex+1]) return pathParts[liveIndex+1]
  }
 }catch{
  return ""
 }
 return ""
}

function openLiveLink(){
 if(!liveStreamUrl) return
 if(typeof window==="undefined") return

 const ua = navigator.userAgent || ""
 const isAndroid = /Android/i.test(ua)
 const isIOS = /iPhone|iPad|iPod/i.test(ua)
 const isMobile = isAndroid || isIOS
 const videoId = parseYouTubeVideoId(liveStreamUrl)

 if(!isMobile){
  window.open(liveStreamUrl,"_blank","noopener,noreferrer")
  return
 }

 let mobileTarget = liveStreamUrl
 if(isAndroid && videoId){
  mobileTarget = `intent://www.youtube.com/watch?v=${videoId}#Intent;package=com.google.android.youtube;scheme=https;end`
 }else if(isIOS && videoId){
  mobileTarget = `youtube://www.youtube.com/watch?v=${videoId}`
 }

 const opened = window.open(mobileTarget,"_blank","noopener,noreferrer")
 if(!opened){
  window.open(liveStreamUrl,"_blank","noopener,noreferrer")
 }
}

function formatRemaining(ms){
 const totalSeconds = Math.floor(ms/1000)
 const days = Math.floor(totalSeconds/86400)
 const hours = Math.floor((totalSeconds%86400)/3600)
 const minutes = Math.floor((totalSeconds%3600)/60)
 const seconds = totalSeconds%60
 if(days>0){
  return `${days}j ${String(hours).padStart(2,"0")}h ${String(minutes).padStart(2,"0")}m ${String(seconds).padStart(2,"0")}s`
 }
 return `${String(hours).padStart(2,"0")}h ${String(minutes).padStart(2,"0")}m ${String(seconds).padStart(2,"0")}s`
}

useEffect(()=>{
 if(!card) return
 if(!wonTier) return
 if(winnerTierRef.current===wonTier.tier) return
 winnerTierRef.current = wonTier.tier
 setRaffleOpen(true)
 triggerHaptics([120,60,120,60,180])
},[wonTier,card])

async function submitRaffleEntry(){
 if(!wonTier) return
 if(!raffleFirstName.trim() || !rafflePhone.trim() || !raffleEmail.trim()){
  setRaffleStatus("Merci de remplir prénom, téléphone et email.")
  return
 }
 setRaffleLoading(true)
 setRaffleStatus("")
 try{
  const response = await fetch("/api/raffle/enter",{
   method:"POST",
   headers:{"content-type":"application/json"},
   body:JSON.stringify({
    tier:wonTier.tier,
    firstName:raffleFirstName,
    phone:rafflePhone,
    email:raffleEmail,
    token
   })
  })
  const data = await response.json().catch(()=>({}))
  if(!response.ok || !data.ok){
   if(data.error==="not_ulule_eligible"){
    setRaffleStatus("Email non éligible: contribution avec contrepartie ou don >= 10€ requis.")
    return
   }
   if(data.error==="already_won"){
    setRaffleStatus("Cet email a déjà gagné.")
    return
   }
   if(data.error==="not_qualified_for_tier"){
    setRaffleStatus("Ta qualification n'est plus active pour ce palier.")
    return
   }
   setRaffleStatus(`Erreur: ${data.error || "unknown_error"}`)
   return
  }
  setRaffleStatus(data.duplicated ? "Email déjà inscrit pour ce palier." : "Inscription au tirage validée.")
  setRaffleOpen(false)
 }finally{
  setRaffleLoading(false)
 }
}

if(!card) return (
<div className="player-shell">
 <div className="player-stage">
  <div className="player-head">
   <h1>Bingo Live</h1>
   <p>{socketError || "Chargement de la carte..."}</p>
  </div>
 </div>
</div>
)

return(
<div className="player-shell">
<div className="player-stage">

<div className="player-head">
 <h1>Bingo Live</h1>
 <p>Campagne en direct</p>
 <p>Palier en cours: {state?.phase?.targetLabel || "1 ligne"}</p>
 {campaignRemainingMs !== null && (
  <p className="campaign-countdown">
   {campaignRemainingMs > 0 ? `Fin de campagne dans: ${formatRemaining(campaignRemainingMs)}` : "Campagne terminée"}
  </p>
 )}
 <span className="player-counter">{activeCount}/{card.length} cases actives</span>
 {liveStreamUrl && (
  <button className="btn ghost raffle-cta" onClick={openLiveLink}>
   Rejoindre le live YouTube
  </button>
 )}
 {wonTier && (
  <button className="btn raffle-cta" onClick={()=>setRaffleOpen(true)}>
   Participer au tirage au sort
  </button>
 )}
</div>

<div className="player-progress">
 {tierProgress.map(({tier,label,missing})=>(
  <div key={tier} className={"progress-item "+(missing===0?"done":"")}>
   <span>{label}</span>
   <strong>{missing===0?"Prêt":`Il manque ${missing} case${missing>1?"s":""}`}</strong>
  </div>
 ))}
</div>

{wonTier && (
 <div className="winner-banner">
  Tu as gagné le palier: <strong>{wonTier.label}</strong>
 </div>
)}

{raffleStatus && <p className="status">{raffleStatus}</p>}

{wonTier && raffleOpen && (
 <div className="raffle-modal-backdrop">
  <div className="raffle-modal">
   <h2>Participer au tirage</h2>
   <p>Tu es qualifié pour <strong>{wonTier.label}</strong>. Renseigne tes infos de contribution.</p>
   <input
    className="input"
    placeholder="Prénom"
    value={raffleFirstName}
    onChange={(e)=>setRaffleFirstName(e.target.value)}
   />
   <input
    className="input"
    placeholder="Téléphone"
    value={rafflePhone}
    onChange={(e)=>setRafflePhone(e.target.value)}
   />
   <input
    className="input"
    type="email"
    placeholder="Email utilisé sur Ulule"
    value={raffleEmail}
    onChange={(e)=>setRaffleEmail(e.target.value)}
   />
   <div className="row">
    <button className="btn ghost" onClick={()=>setRaffleOpen(false)} disabled={raffleLoading}>Fermer</button>
    <button className="btn" onClick={submitRaffleEntry} disabled={raffleLoading}>
     {raffleLoading ? "Vérification..." : "Valider ma participation"}
    </button>
   </div>
  </div>
 </div>
)}

<div className="card-grid player-grid desktop-grid" style={{gridTemplateColumns:`repeat(${boardCols}, minmax(0, 1fr))`}}>

{card.map((c,i)=>{

 const active = state?.triggered.includes(c)

 return(
 <div key={i} className={"cell "+(active?"active":"")+(freshCells.has(i)?" fresh":"")}>
 <div className="cell-inner">
  <span className="cell-label">{c}</span>
  {active && <span className="cell-badge">ACTIF</span>}
 </div>
 </div>
 )

})}

</div>

<div className="mobile-lines">
{lineGroups.map((line,lineIndex)=>{
 const lineActiveCount = line.filter((eventName)=>state?.triggered.includes(eventName)).length
 return(
 <section key={lineIndex} className="line-block">
  <header className="line-head">
   <strong>Ligne {lineIndex+1}</strong>
   <span>{lineActiveCount}/{boardCols}</span>
  </header>

  <div className="line-list">
  {line.map((eventName,colIndex)=>{
   const absoluteIndex = lineIndex*boardCols+colIndex
   const active = state?.triggered.includes(eventName)
   const fresh = freshCells.has(absoluteIndex)
   return(
   <div key={absoluteIndex} className={"line-item "+(active?"active":"")+(fresh?" fresh":"")}>
    <span className="line-item-text">{eventName}</span>
    {active && <span className="line-item-badge">ACTIF</span>}
   </div>
   )
  })}
  </div>
 </section>
 )})}
</div>

</div>
</div>
)
}
