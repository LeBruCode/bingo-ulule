
import {BrowserRouter,Routes,Route} from "react-router-dom"
import Player from "./pages/Player.jsx"
import Admin from "./pages/Admin.jsx"

export default function App(){
 return(
 <BrowserRouter>
 <Routes>
 <Route path="/" element={<Player/>}/>
 <Route path="/admin" element={<Admin/>}/>
 </Routes>
 </BrowserRouter>
 )
}
