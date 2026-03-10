import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import OldeupeLogo from "../components/OldeupeLogo.jsx"
import useBrandLogo from "../hooks/useBrandLogo.js"

export default function AdminWinners() {
  const navigate = useNavigate()
  const [logoSrc] = useBrandLogo()
  const [winners, setWinners] = useState([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState("")

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options
    })
    const data = await response.json().catch(() => ({}))
    if (response.status === 403) {
      navigate("/admin/login", { replace: true })
    }
    return { response, data }
  }

  async function loadWinners() {
    setLoading(true)
    setStatus("")
    try {
      const { response, data } = await fetchJson("/api/backend-bruno/winners")
      if (!response.ok || !data.ok) {
        setStatus(`Erreur chargement gagnants: ${data.error || "unknown_error"}`)
        return
      }
      setWinners(data.winners || [])
      setStatus("Liste des gagnants chargée")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadWinners()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const winnerCountByTier = useMemo(() => {
    const counts = new Map()
    for (const winner of winners) {
      counts.set(winner.tierLabel, (counts.get(winner.tierLabel) || 0) + 1)
    }
    return [...counts.entries()]
  }, [winners])

  function formatDateTime(value) {
    if (!value) return "Inconnue"
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return "Inconnue"
    return date.toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })
  }

  function exportCsv() {
    const header = [
      "palier",
      "lot",
      "prenom",
      "initiale_nom",
      "email",
      "date_tirage",
      "ville",
      "departement",
      "pays",
      "montant_eur"
    ]

    const rows = winners.map((winner) => [
      winner.tierLabel || "",
      winner.reward || "",
      winner.firstName || "",
      winner.lastInitial || "",
      winner.email || "",
      winner.selectedAt || "",
      winner.ulule?.city || "",
      winner.ulule?.departmentCode || "",
      winner.ulule?.country || "",
      typeof winner.ulule?.orderTotalCents === "number" ? (winner.ulule.orderTotalCents / 100).toFixed(2) : ""
    ])

    const csv = [header, ...rows]
      .map((row) =>
        row
          .map((cell) => `"${String(cell ?? "").replace(/"/g, "\"\"")}"`)
          .join(",")
      )
      .join("\n")

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "bingo-gagnants.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="admin-shell">
      <div className="admin-header">
        <div>
          <OldeupeLogo className="brand-logo admin-brand-logo" src={logoSrc} />
          <h1>Gagnants</h1>
          <p>Retrouve tous les gagnants et les données utiles pour l’envoi des lots.</p>
        </div>
        <div className="row">
          <Link className="btn ghost" to="/admin">
            Retour dashboard
          </Link>
          <button className="btn ghost" onClick={loadWinners} disabled={loading}>
            {loading ? "Chargement..." : "Rafraîchir"}
          </button>
          <button className="btn" onClick={exportCsv} disabled={winners.length === 0}>
            Export CSV
          </button>
        </div>
      </div>

      <section className="panel">
        <h2>Résumé</h2>
        <div className="winner-grid">
          <div className="winner-card">
            <span>Total gagnants</span>
            <strong>{winners.length}</strong>
          </div>
          {winnerCountByTier.map(([label, count]) => (
            <div key={label} className="winner-card">
              <span>{label}</span>
              <strong>{count}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Liste des gagnants</h2>
        <div className="admin-winners-list">
          {winners.length === 0 ? (
            <p className="hint">Aucun gagnant enregistré pour le moment.</p>
          ) : (
            winners.map((winner) => (
              <article key={`${winner.tier}-${winner.id}`} className="admin-winner-item">
                <div className="admin-winner-head">
                  <div>
                    <strong>{winner.firstName || "Joueur"}</strong>
                    <span>{winner.email || "Aucun e-mail"}</span>
                  </div>
                  <span className="pill on">{winner.tierLabel}</span>
                </div>
                <div className="admin-winner-meta">
                  <span>Lot : {winner.reward || "Non renseigné"}</span>
                  <span>Tiré le : {formatDateTime(winner.selectedAt)}</span>
                  <span>Ville : {winner.ulule?.city || "Non renseignée"}</span>
                  <span>Pays : {winner.ulule?.country || "Non renseigné"}</span>
                  <span>Département : {winner.ulule?.departmentCode || "Non renseigné"}</span>
                  <span>
                    Montant : {typeof winner.ulule?.orderTotalCents === "number" ? `${(winner.ulule.orderTotalCents / 100).toFixed(2)} EUR` : "Inconnu"}
                  </span>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      {status ? <p className="status">{status}</p> : null}
    </div>
  )
}
