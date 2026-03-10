import { BrowserRouter, Route, Routes } from "react-router-dom"
import Player from "./pages/Player.jsx"
import Admin from "./pages/Admin.jsx"
import AdminLogin from "./pages/AdminLogin.jsx"
import AdminManage from "./pages/AdminManage.jsx"
import AdminRaffle from "./pages/AdminRaffle.jsx"
import AdminContent from "./pages/AdminContent.jsx"
import AdminControlMobile from "./pages/AdminControlMobile.jsx"
import AdminWinners from "./pages/AdminWinners.jsx"
import AdminMilestones from "./pages/AdminMilestones.jsx"
import Overlay from "./pages/Overlay.jsx"
import AdminChallenges from "./pages/AdminChallenges.jsx"
import ChallengeOverlay from "./pages/ChallengeOverlay.jsx"

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Player />} />
        <Route path="/overlay" element={<Overlay />} />
        <Route path="/overlay/challenges" element={<ChallengeOverlay />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/admin/manage" element={<AdminManage />} />
        <Route path="/admin/control" element={<AdminControlMobile />} />
        <Route path="/admin/winners" element={<AdminWinners />} />
        <Route path="/admin/milestones" element={<AdminMilestones />} />
        <Route path="/admin/challenges" element={<AdminChallenges />} />
        <Route path="/admin/content" element={<AdminContent />} />
        <Route path="/admin/raffle" element={<AdminRaffle />} />
        <Route path="/admin/raffle/stage" element={<AdminRaffle projectionOnly />} />
      </Routes>
    </BrowserRouter>
  )
}
