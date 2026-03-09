import { BrowserRouter, Route, Routes } from "react-router-dom"
import Player from "./pages/Player.jsx"
import Admin from "./pages/Admin.jsx"
import AdminLogin from "./pages/AdminLogin.jsx"
import AdminManage from "./pages/AdminManage.jsx"
import AdminRaffle from "./pages/AdminRaffle.jsx"
import Overlay from "./pages/Overlay.jsx"

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Player />} />
        <Route path="/overlay" element={<Overlay />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/admin/manage" element={<AdminManage />} />
        <Route path="/admin/raffle" element={<AdminRaffle />} />
      </Routes>
    </BrowserRouter>
  )
}
