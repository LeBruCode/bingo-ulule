import { useState } from "react"
import { useNavigate } from "react-router-dom"
import OldeupeLogo from "../components/OldeupeLogo.jsx"
import useBrandLogo from "../hooks/useBrandLogo.js"

export default function AdminLogin() {
  const navigate = useNavigate()
  const [logoSrc] = useBrandLogo()
  const [adminKey, setAdminKey] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function login() {
    if (!adminKey.trim()) return

    setLoading(true)
    setError("")

    try {
      const response = await fetch("/api/backend-bruno/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ adminKey: adminKey.trim() })
      })

      if (!response.ok) {
        setError("Clé invalide")
        return
      }

      navigate("/admin", { replace: true })
    } catch {
      setError("Erreur réseau")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <OldeupeLogo className="brand-logo login-brand-logo" src={logoSrc} />
        <h1>Connexion admin</h1>
        <p>Accès sécurisé au tableau de bord du bingo live.</p>
        <input
          className="input"
          type="password"
          placeholder="ADMIN_KEY"
          value={adminKey}
          onChange={(e) => setAdminKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") login()
          }}
        />
        <button className="btn" onClick={login} disabled={loading}>
          {loading ? "Connexion..." : "Se connecter"}
        </button>
        {error && <p className="status error">{error}</p>}
      </div>
    </div>
  )
}
