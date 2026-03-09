
import {useEffect,useRef,useState} from "react"
import {io} from "socket.io-client"

let token = localStorage.getItem("bingoToken")
const socket = io(window.location.origin,{auth:{token}})

export default function Player(){

const [card,setCard]=useState(null)
const [state,setState]=useState(null)
const [freshCells,setFreshCells]=useState(new Set())
const previousTriggeredRef = useRef(new Set())
const vibrationTimeoutRef = useRef(null)

useEffect(()=>{

const onToken=(t)=>{
 localStorage.setItem("bingoToken",t)
 token=t
}

const onCard=(nextCard)=>setCard(nextCard)
const onState=(nextState)=>setState(nextState)

socket.on("token",onToken)
socket.on("card",onCard)
socket.on("state",onState)

return ()=>{
 socket.off("token",onToken)
 socket.off("card",onCard)
 socket.off("state",onState)
 if(vibrationTimeoutRef.current){
  clearTimeout(vibrationTimeoutRef.current)
 }
}

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

  if(typeof navigator!=="undefined" && typeof navigator.vibrate==="function"){
   const vibrationPattern = [120,60,120]
   navigator.vibrate(vibrationPattern)
  }

  if(vibrationTimeoutRef.current){
   clearTimeout(vibrationTimeoutRef.current)
  }
  vibrationTimeoutRef.current = setTimeout(()=>setFreshCells(new Set()),1400)
 }

 previousTriggeredRef.current = currentTriggered
},[card,state])

if(!card) return (
<div className="player-shell">
 <div className="player-stage">
  <div className="player-head">
   <h1>Bingo Live</h1>
   <p>Chargement de la carte…</p>
  </div>
 </div>
</div>
)

const activeCount = card.filter((eventName)=>state?.triggered.includes(eventName)).length
const boardCols = state?.board?.cols || 5

return(
<div className="player-shell">
<div className="player-stage">

<div className="player-head">
 <h1>Bingo Live</h1>
 <p>Campagne en direct</p>
 <span className="player-counter">{activeCount}/{card.length} cases actives</span>
</div>

<div className="card-grid player-grid" style={{gridTemplateColumns:`repeat(${boardCols}, minmax(0, 1fr))`}}>

{card.map((c,i)=>{

 const active = state?.triggered.includes(c)

 return(
 <div key={i} className={"cell "+(active?"active":"")+(freshCells.has(i)?" fresh":"")}>
 {c}
 </div>
 )

})}

</div>

</div>
</div>
)
}
