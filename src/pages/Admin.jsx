
import {useEffect,useState} from "react"

export default function Admin(){
const [adminKey,setAdminKey]=useState(localStorage.getItem("bingoAdminKey")||"")
const [debug,setDebug]=useState(null)
const [eventName,setEventName]=useState("")
const [status,setStatus]=useState("")

async function load(){
 setStatus("")
 const r = await fetch("/api/debug",{headers:{"x-admin-key":adminKey}})
 const data = await r.json()

 if(!r.ok){
  setDebug(null)
  setStatus("Acces refuse: verifie ADMIN_KEY")
  return
 }

 setDebug(data)
}

async function triggerEvent(){
 setStatus("")
 const r = await fetch("/api/trigger",{
  method:"POST",
  headers:{
   "content-type":"application/json",
   "x-admin-key":adminKey
  },
  body:JSON.stringify({event:eventName})
 })

 const data = await r.json()
 if(!r.ok || !data.ok){
  setStatus(`Erreur trigger: ${data.error || "unknown_error"}`)
  return
 }

 setStatus("Evenement envoye")
 await load()
}

useEffect(()=>{
 localStorage.setItem("bingoAdminKey",adminKey)
},[adminKey])

return(
<div style={{padding:40,fontFamily:"Inter",maxWidth:800}}>
 <h1>Admin Live</h1>

 <div style={{display:"grid",gap:10,marginBottom:16}}>
  <input
   placeholder="ADMIN_KEY"
   value={adminKey}
   onChange={(e)=>setAdminKey(e.target.value)}
  />
  <button onClick={load}>Charger debug</button>
 </div>

 <div style={{display:"grid",gap:10,marginBottom:16}}>
  <input
   placeholder="Nom exact de l'evenement"
   value={eventName}
   onChange={(e)=>setEventName(e.target.value)}
  />
  <button onClick={triggerEvent}>Declencher evenement</button>
 </div>

 {status && <p>{status}</p>}
 <pre>{JSON.stringify(debug,null,2)}</pre>
</div>
)
}
