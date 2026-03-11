import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import OldeupeLogo from "../components/OldeupeLogo.jsx"
import useBrandLogo from "../hooks/useBrandLogo.js"

export default function AdminMilestones() {
  const navigate = useNavigate()
  const [logoSrc] = useBrandLogo()
  const [data, setData] = useState({ winnersPerWindow: 1, showWindowOnCards: true, windows: [] })
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState("")

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options
    })
    const payload = await response.json().catch(() => ({}))
    if (response.status === 403) {
      navigate("/admin/login", { replace: true })
    }
    return { response, payload }
  }

  async function loadMilestones() {
    setLoading(true)
    setStatus("")
    try {
      const { response, payload } = await fetchJson("/api/backend-bruno/milestone-raffles")
      if (!response.ok || !payload.ok) {
        setStatus(`Erreur chargement: ${payload.error || "unknown_error"}`)
        return
      }
      setData(payload.milestoneRaffles || { winnersPerWindow: 1, showWindowOnCards: true, windows: [] })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMilestones()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function formatMoney(cents) {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0
    }).format((Number(cents || 0)) / 100)
  }

  async function saveSettings() {
    setLoading(true)
    setStatus("")
    try {
      const { response, payload } = await fetchJson("/api/backend-bruno/milestone-raffles/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          winnersPerWindow: Number(data.winnersPerWindow || 1),
          showWindowOnCards: Boolean(data.showWindowOnCards)
        })
      })
      if (!response.ok || !payload.ok) {
        setStatus(`Erreur réglage: ${payload.error || "unknown_error"}`)
        return
      }
      setData(payload.milestoneRaffles || data)
      setStatus("Réglage enregistré")
    } finally {
      setLoading(false)
    }
  }

  async function drawWindow(windowKey) {
    setLoading(true)
    setStatus("")
    try {
      const { response, payload } = await fetchJson("/api/backend-bruno/milestone-raffles/draw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ windowKey })
      })
      if (!response.ok || !payload.ok) {
        setStatus(`Erreur tirage cagnotte: ${payload.error || "unknown_error"}`)
        return
      }
      setData(payload.milestoneRaffles || data)
      setStatus(`Tirage effectué pour ${windowKey}`)
    } finally {
      setLoading(false)
    }
  }

  async function selectWindow(windowKey) {
    setLoading(true)
    setStatus("")
    try {
      const { response, payload } = await fetchJson("/api/backend-bruno/milestone-raffles/select", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ windowKey })
      })
      if (!response.ok || !payload.ok) {
        setStatus(`Erreur sélection tranche: ${payload.error || "unknown_error"}`)
        return
      }
      setData(payload.milestoneRaffles || data)
      setStatus(`Tranche active : ${windowKey}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-shell">
      <div className="admin-header">
        <div>
          <OldeupeLogo className="brand-logo admin-brand-logo" src={logoSrc} />
          <h1>Tirages cagnotte</h1>
          <p>Tirages automatiques par tranche de 10 000 EUR sur les contributeurs Ulule éligibles à partir de 10 EUR.</p>
        </div>
        <div className="row">
          <Link className="btn ghost" to="/admin">
            Retour dashboard
          </Link>
          <Link className="btn ghost" to="/overlay/milestones" target="_blank" rel="noreferrer">
            Ouvrir projection publique
          </Link>
          <button className="btn ghost" onClick={loadMilestones} disabled={loading}>
            {loading ? "Chargement..." : "Rafraîchir"}
          </button>
        </div>
      </div>

      <section className="panel">
        <h2>Réglage global</h2>
        <div className="row">
          <input
            className="input"
            type="number"
            min="1"
            max="50"
            value={data.winnersPerWindow}
            onChange={(e) => setData((prev) => ({ ...prev, winnersPerWindow: e.target.value }))}
          />
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={Boolean(data.showWindowOnCards)}
              onChange={(e) => setData((prev) => ({ ...prev, showWindowOnCards: e.target.checked }))}
            />
            <span>Afficher la tranche sur les cartes</span>
          </label>
          <button className="btn" onClick={saveSettings} disabled={loading}>
            Enregistrer
          </button>
        </div>
        <p className="hint">Nombre de gagnants par tranche et affichage optionnel de la tranche sur les cartes de projection.</p>
      </section>

      <section className="panel">
        <h2>Tranches disponibles</h2>
        <p className="hint">60 tranches fixes de 10 000 EUR, de 0 à 600 000 EUR. Tu peux sélectionner la tranche affichée en projection puis lancer son tirage.</p>
        <div className="admin-milestone-list">
          {(data.windows || []).length === 0 ? (
            <p className="hint">Aucune tranche disponible pour le moment.</p>
          ) : (
            data.windows.map((window) => (
              <article key={window.key} className="admin-milestone-item">
                <div className="admin-milestone-head">
                  <div>
                    <strong>{formatMoney(window.startCents)} → {formatMoney(window.endCents)}</strong>
                    <span>
                      {window.candidatesCount} candidat(s) éligible(s)
                      {data.selectedWindowKey === window.key ? " • tranche projetée" : ""}
                    </span>
                  </div>
                  <div className="row">
                    <button
                      className={`btn ghost ${data.selectedWindowKey === window.key ? "active" : ""}`}
                      onClick={() => selectWindow(window.key)}
                      disabled={loading}
                    >
                      {data.selectedWindowKey === window.key ? "Tranche affichée" : "Afficher cette tranche"}
                    </button>
                    <button
                      className="btn"
                      onClick={() => drawWindow(window.key)}
                      disabled={loading || window.winnersCount > 0 || window.candidatesCount === 0}
                    >
                      {window.winnersCount > 0 ? "Tirage déjà effectué" : "Lancer le tirage"}
                    </button>
                  </div>
                </div>

                <div className="admin-milestone-meta">
                  <span>Contributions dans la tranche : {window.totalOrders}</span>
                  <span>Montant cumulé de la tranche : {formatMoney(window.totalAmountCents)}</span>
                  <span>Gagnants tirés : {window.winnersCount}</span>
                </div>

                {window.winnersCount > 0 ? (
                  <div className="admin-milestone-winners">
                    {window.winners.map((winner) => (
                      <div key={winner.id} className="admin-milestone-winner-chip">
                        {winner.firstName || "Joueur"} • {winner.email}
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            ))
          )}
        </div>
      </section>

      {status ? <p className="status">{status}</p> : null}
    </div>
  )
}
