import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import Player from "./pages/Player.jsx"
import Admin from "./pages/Admin.jsx"
import AdminLogin from "./pages/AdminLogin.jsx"
import AdminManage from "./pages/AdminManage.jsx"
import Overlay from "./pages/Overlay.jsx"

function AdminGuard({ children }) {
  const adminKey = localStorage.getItem("bingoAdminKey")
  if (!adminKey) return <Navigate to="/admin/login" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Player />} />
        <Route path="/overlay" element={<Overlay />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route
          path="/admin"
          element={
            <AdminGuard>
              <Admin />
            </AdminGuard>
          }
        />
        <Route
          path="/admin/manage"
          element={
            <AdminGuard>
              <AdminManage />
            </AdminGuard>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
