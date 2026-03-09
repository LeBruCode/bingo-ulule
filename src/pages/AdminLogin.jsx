import { useState } from "react"
import { useNavigate } from "react-router-dom"

export default function AdminLogin() {
  const navigate = useNavigate()
  const [adminKey, setAdminKey] = useState(localStorage.getItem("bingoAdminKey") || "")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function login() {
    if (!adminKey.trim()) return

    setLoading(true)
    setError("")

    try {
      const response = await fetch("/api/admin/debug", {
        headers: { "x-admin-key": adminKey.trim() }
      })

      if (!response.ok) {
        setError("Clé invalide")
        return
      }

      localStorage.setItem("bingoAdminKey", adminKey.trim())
      navigate("/admin", { replace: true })
    } catch {
      setError("Erreur reseau")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
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
