
import {useEffect,useState} from "react"
import {io} from "socket.io-client"

let token = localStorage.getItem("bingoToken")
const socket = io(window.location.origin,{auth:{token}})

export default function Player(){

const [card,setCard]=useState(null)
const [state,setState]=useState(null)

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
}

},[])

if(!card) return <div className="container">Chargement de la carte…</div>

return(
<div className="container">

<h1>Bingo Live</h1>

<div className="card-grid">

{card.map((c,i)=>{

 const active = state?.triggered.includes(c)

 return(
 <div key={i} className={"cell "+(active?"active":"")}>
 {c}
 </div>
 )

})}

</div>

</div>
)
}
