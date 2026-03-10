
import {useEffect,useRef,useState} from "react"
import {io} from "socket.io-client"
import OldeupeLogo from "../components/OldeupeLogo.jsx"

let token = localStorage.getItem("bingoToken")
const socket = io(window.location.origin,{
 auth:{token},
 transports:["websocket"],
 upgrade:false
})

export default function Player(){

const [card,setCard]=useState(null)
const [state,setState]=useState(null)
const [content,setContent]=useState({})
const [nowMs,setNowMs]=useState(Date.now())
const [socketError,setSocketError]=useState("")
const [freshCells,setFreshCells]=useState(new Set())
const [playerMeta,setPlayerMeta]=useState({raffleEnteredTiers:[]})
const [raffleOpen,setRaffleOpen]=useState(false)
const [raffleLoading,setRaffleLoading]=useState(false)
const [raffleStatus,setRaffleStatus]=useState("")
const [raffleFirstName,setRaffleFirstName]=useState("")
const [raffleEmail,setRaffleEmail]=useState("")
const [phaseBump,setPhaseBump]=useState(false)
const previousTriggeredRef = useRef(new Set())
const vibrationTimeoutRef = useRef(null)
const hapticsUnlockedRef = useRef(false)
const winnerTierRef = useRef(null)
const previousPhaseTierRef = useRef(null)
const previousRoundTierRef = useRef(null)
const previousPhaseMissingRef = useRef(null)
const phaseBumpTimeoutRef = useRef(null)
const logoSrc = typeof content["brand.logo_src"]==="string" ? content["brand.logo_src"] : ""

function t(key,fallback,vars={}){
 const template = typeof content[key]==="string" && content[key] ? content[key] : fallback
 return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g,(_,name)=>{
  const value = vars[name]
  return value===undefined || value===null ? "" : String(value)
 })
}

function cssRemSetting(key,fallback,min,max){
 const raw = Number.parseFloat(content[key])
 const safe = Number.isFinite(raw) ? Math.min(Math.max(raw,min),max) : fallback
 return `${safe}rem`
}

const playerShellStyle = {
 "--player-mobile-shell-font-size": cssRemSetting("player.mobile_shell_font_size",1.125,0.95,2.4),
 "--player-mobile-title-size": cssRemSetting("player.mobile_title_size",2.15,1.4,4.8),
 "--player-mobile-text-size": cssRemSetting("player.mobile_text_size",1.18,0.95,3.2),
 "--player-mobile-button-size": cssRemSetting("player.mobile_button_size",1.14,0.95,3.2),
 "--player-mobile-countdown-number-size": cssRemSetting("player.mobile_countdown_number_size",2.22,1.2,5),
 "--player-mobile-spotlight-size": cssRemSetting("player.mobile_spotlight_size",2.34,1.3,5),
 "--player-mobile-progress-size": cssRemSetting("player.mobile_progress_size",1.16,0.95,3.2),
 "--player-mobile-card-text-size": cssRemSetting("player.mobile_card_text_size",1.42,0.95,4)
}

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

const onContent=(nextContent)=>setContent(nextContent || {})
const onCard=(nextCard)=>setCard(nextCard)
const onPlayerMeta=(nextMeta)=>setPlayerMeta(nextMeta || {raffleEnteredTiers:[]})
const onState=(nextState)=>setState(nextState)
const onError=(errorCode)=>{
 if(errorCode==="no_cards_generated"){
  setSocketError(t("player.no_cards_generated","Initialisation du bingo en cours, reessaie dans quelques secondes."))
  return
 }
 if(typeof errorCode==="string"){
  setSocketError(`Connexion: ${errorCode}`)
  return
 }
 setSocketError(t("player.connection_error","Connexion indisponible temporairement."))
}

socket.on("token",onToken)
socket.on("content",onContent)
socket.on("card",onCard)
socket.on("player-meta",onPlayerMeta)
socket.on("state",onState)
socket.on("error",onError)

return ()=>{
 socket.off("token",onToken)
 socket.off("content",onContent)
 socket.off("card",onCard)
 socket.off("player-meta",onPlayerMeta)
 socket.off("state",onState)
 socket.off("error",onError)
 if(vibrationTimeoutRef.current){
  clearTimeout(vibrationTimeoutRef.current)
 }
 if(phaseBumpTimeoutRef.current){
  clearTimeout(phaseBumpTimeoutRef.current)
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
function formatTierLabel(tier,totalRows){
 if(tier===totalRows) return "carton plein"
 return `${tier} ligne${tier>1?"s":""}`
}

function formatTierSentenceLabel(tier,totalRows){
 if(tier===totalRows) return "le carton plein"
 return `${tier} ligne${tier>1?"s":""}`
}

const tierProgress = Array.from({length:boardRows},(_,index)=>{
 const tier=index+1
 const missing=sortedMissingCounts.slice(0,tier).reduce((sum,value)=>sum+value,0)
 const label=formatTierLabel(tier,boardRows)
 const shortLabel=formatTierLabel(tier,boardRows)
 return {tier,label,shortLabel,missing}
})
const currentTargetTier = Number(state?.phase?.targetTier || 1)
const currentTierProgress = tierProgress.find(({tier})=>tier===currentTargetTier) || null
const currentReward = typeof content[`reward.line_${currentTargetTier}`]==="string" ? content[`reward.line_${currentTargetTier}`].trim() : ""

useEffect(()=>{
 if(!currentTierProgress){
  previousPhaseMissingRef.current = null
  return
 }

 const currentMissing = currentTierProgress.missing
 const previousMissing = previousPhaseMissingRef.current
 const previousTier = previousPhaseTierRef.current
 previousPhaseMissingRef.current = currentMissing
 previousPhaseTierRef.current = currentTargetTier

 if(previousMissing===null || previousTier===null){
  return
 }

 if(previousMissing===currentMissing && previousTier===currentTargetTier){
  return
 }

 setPhaseBump(true)
 if(phaseBumpTimeoutRef.current){
  clearTimeout(phaseBumpTimeoutRef.current)
 }
 phaseBumpTimeoutRef.current = setTimeout(()=>setPhaseBump(false),820)
},[currentTargetTier,currentTierProgress])

function winnerTokensForTier(tier){
 const byLine = state?.winners?.byLine
 if(byLine && Array.isArray(byLine[`line_${tier}`])) return byLine[`line_${tier}`]
 if(tier===1 && Array.isArray(state?.winners?.one)) return state.winners.one
 if(tier===2 && Array.isArray(state?.winners?.two)) return state.winners.two
 if(tier===3 && Array.isArray(state?.winners?.three)) return state.winners.three
 if(tier===boardRows && Array.isArray(state?.winners?.full)) return state.winners.full
 return []
}

const isQualifiedForCurrentTier = winnerTokensForTier(currentTargetTier).includes(token)
const campaignEndAtMs = state?.campaign?.endAt ? Date.parse(state.campaign.endAt) : null
const campaignRemainingMs = campaignEndAtMs ? Math.max(0,campaignEndAtMs - nowMs) : null
const countdownParts = campaignRemainingMs && campaignRemainingMs > 0 ? splitRemaining(campaignRemainingMs) : null
const liveStreamUrl = state?.liveStream?.url || ""
const ululePageUrl = state?.liveStream?.ululeUrl || ""
const gameEnded = Boolean(state?.game?.ended)
const gameFallbackActive = Boolean(state?.game?.fallbackActive)
const liveMessage = typeof content["player.live_message"]==="string" ? content["player.live_message"].trim() : ""
const raffleEnteredTiers = Array.isArray(playerMeta?.raffleEnteredTiers) ? playerMeta.raffleEnteredTiers : []
const hasEnteredCurrentTierRaffle = raffleEnteredTiers.includes(currentTargetTier)

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

function openUluleLink(){
 if(!ululePageUrl) return
 if(typeof window==="undefined") return
 window.open(ululePageUrl,"_blank","noopener,noreferrer")
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

function splitRemaining(ms){
 const totalSeconds = Math.floor(ms/1000)
 const days = Math.floor(totalSeconds/86400)
 const hours = Math.floor((totalSeconds%86400)/3600)
 const minutes = Math.floor((totalSeconds%3600)/60)
 const seconds = totalSeconds%60
 return {days,hours,minutes,seconds}
}

useEffect(()=>{
 if(!card) return
 if(!isQualifiedForCurrentTier || !currentTierProgress) return
 if(winnerTierRef.current===currentTierProgress.tier) return
 winnerTierRef.current = currentTierProgress.tier
 setRaffleOpen(true)
 triggerHaptics([120,60,120,60,180])
},[isQualifiedForCurrentTier,currentTierProgress,card])

useEffect(()=>{
 if(isQualifiedForCurrentTier) return
 setRaffleOpen(false)
 setRaffleStatus("")
},[isQualifiedForCurrentTier,currentTargetTier])

useEffect(()=>{
 if(!hasEnteredCurrentTierRaffle) return
 setRaffleOpen(false)
 setRaffleLoading(false)
 setRaffleStatus("")
},[hasEnteredCurrentTierRaffle,currentTargetTier])

useEffect(()=>{
 if(previousRoundTierRef.current===null){
  previousRoundTierRef.current = currentTargetTier
  return
 }
 if(previousRoundTierRef.current===currentTargetTier) return
 previousRoundTierRef.current = currentTargetTier
 setRaffleOpen(false)
 setRaffleLoading(false)
 setRaffleStatus("")
 setRaffleFirstName("")
 setRaffleEmail("")
},[currentTargetTier])

async function submitRaffleEntry(){
 if(!currentTierProgress) return
 if(!raffleFirstName.trim() || !raffleEmail.trim()){
  setRaffleStatus(t("player.error_missing_fields","Merci de remplir ton prenom et l'email utilise pour ta contribution Ulule."))
  return
 }
 setRaffleLoading(true)
 setRaffleStatus("")
 try{
  const response = await fetch("/api/raffle/enter",{
   method:"POST",
   headers:{"content-type":"application/json"},
   body:JSON.stringify({
    tier:currentTierProgress.tier,
    firstName:raffleFirstName,
    email:raffleEmail,
    token
   })
  })
  const data = await response.json().catch(()=>({}))
  if(!response.ok || !data.ok){
   if(data.error==="contribution_too_low"){
    setRaffleStatus(t("player.error_contribution_too_low","Une contribution existe bien pour cet email sur Ulule, mais son montant est inferieur a 10 EUR. Pour participer au tirage, la contribution ou le don doit etre d'au moins 10 EUR."))
    return
   }
   if(data.error==="not_ulule_eligible"){
    setRaffleStatus(t("player.error_not_ulule_eligible","Aucune contribution eligible n'a ete trouvee pour cet email sur Ulule. Verifie que l'email est correct, ou contribue avec cet email avec une contrepartie ou un don d'au moins 10 EUR."))
    return
   }
   if(data.error==="not_qualified_for_tier"){
    setRaffleStatus(t("player.error_not_qualified","Ta qualification n'est plus active pour ce palier."))
    return
   }
   setRaffleStatus(t("player.error_generic","Erreur : {error}",{error:data.error || "unknown_error"}))
   return
  }
  setRaffleStatus(data.duplicated
   ? t("player.success_duplicate","Email deja inscrit pour ce palier.")
   : t("player.success_validated","Inscription au tirage validee.")
  )
  setPlayerMeta((prev)=>({
   ...prev,
   raffleEnteredTiers:[...new Set([...(Array.isArray(prev?.raffleEnteredTiers)?prev.raffleEnteredTiers:[]),currentTierProgress.tier])]
  }))
  setRaffleOpen(false)
 }finally{
  setRaffleLoading(false)
 }
}

if(!card) return (
<div className="player-shell" style={playerShellStyle}>
 <div className="player-stage">
  <div className="player-head">
   <OldeupeLogo className="brand-logo player-brand-logo" src={logoSrc} />
   <h1>{t("player.title","Bingo Live")}</h1>
   <p>{socketError || t("player.loading_card","Chargement de la carte...")}</p>
  </div>
 </div>
</div>
)

return(
<div className="player-shell" style={playerShellStyle}>
<div className="player-stage">

<div className="player-head">
 <div className="player-hero">
  <div className="player-hero-copy">
   <OldeupeLogo className="brand-logo player-brand-logo" src={logoSrc} />
   <h1>{t("player.title","Bingo Live")}</h1>
   <div className="player-meta">
    <span className="player-counter">{activeCount}/{card.length} cases actives</span>
    {isQualifiedForCurrentTier && currentTierProgress ? (
     <span className="player-qualified-pill">{currentTierProgress.label}</span>
    ) : null}
   </div>
  </div>

  <div className="player-hero-side">
        <div className={`phase-spotlight${phaseBump ? " bump" : ""}`}>
          <span className="phase-spotlight-label">Manche en cours</span>
          <strong>{formatTierLabel(currentTargetTier,boardRows)}</strong>
    {currentTierProgress ? (
     <small>
       {currentTierProgress.missing===0
       ? "Ta carte est eligible au tirage"
       : `Encore ${currentTierProgress.missing} case${currentTierProgress.missing>1?"s":""} pour ce palier`}
     </small>
    ) : null}
   </div>
  </div>
 </div>

 <div className="player-toolbar">
  {campaignRemainingMs !== null && (
   <div className="player-countdown-card">
    <div className="campaign-countdown-head">
     <p className="campaign-countdown">
      {campaignRemainingMs > 0 ? t("player.countdown_label","Fin de campagne dans") : t("player.countdown_ended","Campagne terminee")}
     </p>
     {campaignRemainingMs > 0 && <span className="campaign-countdown-live-dot">En direct</span>}
    </div>
    {campaignRemainingMs > 0 && (
     <div className="countdown-grid">
      <div className="countdown-cell"><strong>{String(countdownParts?.days ?? 0).padStart(2,"0")}</strong><span>{t("player.countdown_days","Jours")}</span></div>
      <div className="countdown-cell"><strong>{String(countdownParts?.hours ?? 0).padStart(2,"0")}</strong><span>{t("player.countdown_hours","Heures")}</span></div>
      <div className="countdown-cell"><strong>{String(countdownParts?.minutes ?? 0).padStart(2,"0")}</strong><span>{t("player.countdown_minutes","Minutes")}</span></div>
      <div className="countdown-cell"><strong>{String(countdownParts?.seconds ?? 0).padStart(2,"0")}</strong><span>{t("player.countdown_seconds","Secondes")}</span></div>
     </div>
    )}
    {liveMessage ? <p className="countdown-live-message">{liveMessage}</p> : null}
   </div>
  )}
 </div>

 <div className="player-actions">
  {liveStreamUrl && (
   <button className="btn ghost raffle-cta player-live-link" onClick={openLiveLink}>
   {t("player.join_live_button","Rejoindre le live YouTube")}
   </button>
  )}
  {ululePageUrl && (
   <button className="btn ghost raffle-cta player-live-link" onClick={openUluleLink}>
    {t("player.join_ulule_button","Voir la page Ulule")}
   </button>
  )}
   {isQualifiedForCurrentTier && currentTierProgress && !hasEnteredCurrentTierRaffle && (
    <button className="btn raffle-cta" onClick={()=>setRaffleOpen(true)}>
     {t("player.raffle_button","Participer au tirage au sort")}
    </button>
   )}
 </div>
</div>

{gameFallbackActive ? (
 <section className="game-ended-panel">
  <OldeupeLogo className="brand-logo player-brand-logo" src={logoSrc} />
  <h2>{t("player.fallback_title","Jeu indisponible")}</h2>
  <p>{t("player.fallback_body","En raison de problemes techniques, nous ne sommes malheureusement pas en mesure de pouvoir vous proposer ce jeu. Nous vous remercions toutefois pour votre participation. A tres vite.")}</p>
 </section>
) : gameEnded ? (
 <section className="game-ended-panel">
  <OldeupeLogo className="brand-logo player-brand-logo" src={logoSrc} />
  <h2>{t("player.game_ended_title","Jeu termine")}</h2>
  <p>{t("player.game_ended_body","Merci a tous pour votre participation.")}</p>
 </section>
) : (
<>
{currentReward ? (
 <div className="current-reward-banner">
  <span>{t("player.current_reward_label","A gagner")}</span>
  <strong>{currentReward}</strong>
 </div>
) : null}
<div className="player-progress">
  {tierProgress.map(({tier,label,missing})=>(
  <div key={tier} className={"progress-item "+(missing===0?"done":"")+(tier===currentTargetTier?" current":"")}>
   <span>{label}</span>
   <strong>
    {missing!==0
     ? t("player.progress_missing","Il manque {missing} case{plural}",{missing,plural:missing>1?"s":""})
     : tier<currentTargetTier
      ? t("player.progress_closed","Tirage termine")
      : tier===currentTargetTier
       ? t("player.progress_ready","Eligible au tirage")
       : t("player.progress_waiting_round","En attente de cette manche")}
   </strong>
  </div>
 ))}
</div>

{isQualifiedForCurrentTier && currentTierProgress && (
 <div className="winner-banner">
  {hasEnteredCurrentTierRaffle
   ? t("player.raffle_registered_banner","Ta participation au tirage au sort est bien prise en compte.")
   : t("player.qualified_banner","Tu as complete {label}. Tu peux participer au tirage au sort.",{label:formatTierSentenceLabel(currentTierProgress.tier,boardRows)})}
 </div>
)}

{raffleStatus && <p className="status">{raffleStatus}</p>}

{isQualifiedForCurrentTier && currentTierProgress && !hasEnteredCurrentTierRaffle && raffleOpen && (
 <div className="raffle-modal-backdrop">
 <div className="raffle-modal">
   <h2>{t("player.modal_title","Participer au tirage")}</h2>
   <p>{t("player.modal_body","Tu es qualifie pour {label}. Renseigne le prenom et l'adresse email utilisee pour ta contribution Ulule. Pour participer, cette contribution ou ce don doit etre d'au moins 10 EUR.",{label:formatTierSentenceLabel(currentTierProgress.tier,boardRows)})}</p>
   {raffleStatus && <p className="status">{raffleStatus}</p>}
   <input
    className="input"
    placeholder={t("player.modal_first_name","Prenom")}
    value={raffleFirstName}
    onChange={(e)=>setRaffleFirstName(e.target.value)}
   />
   <input
    className="input"
    type="email"
    placeholder={t("player.modal_email","Email utilise sur Ulule")}
    value={raffleEmail}
    onChange={(e)=>setRaffleEmail(e.target.value)}
   />
   <div className="row">
    <button className="btn ghost" onClick={()=>setRaffleOpen(false)} disabled={raffleLoading}>{t("player.modal_close","Fermer")}</button>
    <button className="btn" onClick={submitRaffleEntry} disabled={raffleLoading}>
     {raffleLoading ? t("player.modal_submit_loading","Verification...") : t("player.modal_submit","Valider ma participation")}
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
  {active && <span className="cell-badge">{t("player.cell_validated_badge","Validé")}</span>}
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
    {active && <span className="line-item-badge">{t("player.cell_validated_badge","Validé")}</span>}
   </div>
   )
  })}
  </div>
 </section>
 )})}
</div>
</>
)}
</div>
</div>
)
}
