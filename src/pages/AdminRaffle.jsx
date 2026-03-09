import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"

export default function AdminRaffle() {
  const navigate = useNavigate()
  const [debug, setDebug] = useState(null)
  const [tier, setTier] = useState(1)
  const [entries, setEntries] = useState([])
  const [winner, setWinner] = useState(null)
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const [cursorIndex, setCursorIndex] = useState(0)
  const [status, setStatus] = useState("")

  const visibleCandidates = useMemo(() => {
    if (entries.length === 0) return []
    const current = cursorIndex % entries.length
    const windowSize = 9
    return Array.from({ length: windowSize }, (_, idx) => {
      const offset = idx - Math.floor(windowSize / 2)
      const index = (current + offset + entries.length) % entries.length
      return { entry: entries[index], index, isCenter: offset === 0 }
    })
  }, [entries, cursorIndex])

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options)
    const data = await response.json().catch(() => ({}))
    return { response, data }
  }

  async function loadDebug() {
    const { response, data } = await fetchJson("/api/admin/debug")
    if (!response.ok) {
      if (response.status === 403) {
        navigate("/admin/login", { replace: true })
      }
      return null
    }
    setDebug(data)
    return data
  }

  async function loadRaffle(nextTier) {
    const { response, data } = await fetchJson(`/api/admin/raffle?tier=${nextTier}`)
    if (!response.ok || !data.ok) return
    setEntries(data.entries || [])
    setWinner(data.winner || null)
    setCursorIndex(0)
  }

  async function bootstrap() {
    setLoading(true)
    setStatus("")
    try {
      const nextDebug = await loadDebug()
      const nextTier = Number(nextDebug?.targetTier || 1)
      setTier(nextTier)
      await loadRaffle(nextTier)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    bootstrap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function changeTier(nextTier) {
    setLoading(true)
    setStatus("")
    try {
      const { response, data } = await fetchJson("/api/admin/target-tier", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier: nextTier })
      })
      if (!response.ok || !data.ok) {
        setStatus(`Erreur palier: ${data.error || "unknown_error"}`)
        return
      }
      setDebug(data.debug || null)
      setTier(nextTier)
      await loadRaffle(nextTier)
      setStatus(`Palier actif: ${data.debug?.targetLabel || `${nextTier} ligne(s)`}`)
    } finally {
      setLoading(false)
    }
  }

  async function addMockEntries() {
    setLoading(true)
    setStatus("")
    try {
      const { response, data } = await fetchJson("/api/admin/raffle/mock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier, count: 80 })
      })
      if (!response.ok || !data.ok) {
        setStatus(`Erreur démo: ${data.error || "unknown_error"}`)
        return
      }
      setEntries(data.raffle?.entries || [])
      setWinner(data.raffle?.winner || null)
      setStatus(`${data.added || 0} candidats démo ajoutés`)
    } finally {
      setLoading(false)
    }
  }

  async function addEmailEntry() {
    if (!email.trim()) return
    setLoading(true)
    setStatus("")
    try {
      const { response, data } = await fetchJson("/api/admin/raffle/enter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier, email: email.trim() })
      })
      if (!response.ok || !data.ok) {
        if (data.error === "not_ulule_eligible") {
          setStatus("Email non éligible Ulule (contrepartie ou don >= 10€)")
          return
        }
        setStatus(`Erreur préinscription: ${data.error || "unknown_error"}`)
        return
      }
      setEmail("")
      setEntries(data.raffle?.entries || [])
      setWinner(data.raffle?.winner || null)
      setStatus(data.duplicated ? "Email déjà inscrit sur ce palier" : "Email ajouté")
    } finally {
      setLoading(false)
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function animateAndStop(entriesList, winnerId) {
    if (entriesList.length === 0) return
    setSpinning(true)
    let nextIndex = 0
    for (let i = 0; i < 64; i++) {
      nextIndex = (nextIndex + 1) % entriesList.length
      setCursorIndex(nextIndex)
      await sleep(25 + i * 5)
    }
    const winnerIndex = Math.max(
      0,
      entriesList.findIndex((entry) => entry.id === winnerId)
    )
    setCursorIndex(winnerIndex)
    setSpinning(false)
  }

  async function drawWinner() {
    if (entries.length === 0) {
      setStatus("Aucun candidat pour ce palier")
      return
    }
    setLoading(true)
    setStatus("")
    try {
      const { response, data } = await fetchJson("/api/admin/raffle/draw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier })
      })
      if (!response.ok || !data.ok) {
        setStatus(`Erreur tirage: ${data.error || "unknown_error"}`)
        return
      }
      const nextEntries = data.raffle?.entries || entries
      setEntries(nextEntries)
      if (data.winner?.id) {
        await animateAndStop(nextEntries, data.winner.id)
      }
      setWinner(data.raffle?.winner || data.winner || null)
      setStatus("Tirage terminé")
    } finally {
      setLoading(false)
    }
  }

  const tierButtons = Array.from({ length: Number(debug?.rows || 0) }, (_, i) => {
    const n = i + 1
    return {
      tier: n,
      label: n === Number(debug?.rows || 0) ? "Carton plein" : `${n} ligne${n > 1 ? "s" : ""}`
    }
  })

  return (
    <div className="raffle-shell">
      <header className="raffle-topbar">
        <div>
          <h1>Tirage Bingo Live</h1>
          <p>
            Palier actif: <strong>{debug?.targetLabel || `${tier} ligne`}</strong>
          </p>
        </div>
        <div className="row">
          <Link className="btn ghost" to="/admin">
            Retour dashboard
          </Link>
          <button className="btn ghost" onClick={bootstrap} disabled={loading}>
            {loading ? "Chargement..." : "Rafraîchir"}
          </button>
        </div>
      </header>

      <section className="raffle-stage">
        <div className="raffle-stage-head">
          <div className={`raffle-pulse ${spinning ? "on" : ""}`}>TIRAGE {spinning ? "• TOC TOC TOC •" : "PRÊT"}</div>
          <div className="raffle-counts">
            <span>Candidats: <strong>{entries.length}</strong></span>
            <span>Événements tirés: <strong>{debug?.triggered || 0}</strong></span>
            <span>Joueurs: <strong>{debug?.players || 0}</strong></span>
          </div>
        </div>

        <div className="raffle-slot">
          {visibleCandidates.length === 0 ? (
            <div className="raffle-slot-empty">Aucun candidat pour ce palier</div>
          ) : (
            visibleCandidates.map((item) => (
              <div
                key={`${item.entry.id}-${item.index}`}
                className={`raffle-slot-item ${item.isCenter ? "center" : ""} ${winner?.id === item.entry.id ? "winner" : ""}`}
              >
                {item.entry.email}
              </div>
            ))
          )}
        </div>

        <div className="raffle-controls">
          <div className="row">
            {tierButtons.map((item) => (
              <button
                key={item.tier}
                className={`btn ghost ${item.tier === tier ? "active" : ""}`}
                onClick={() => changeTier(item.tier)}
                disabled={loading || spinning}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="row">
            <input
              className="input"
              type="email"
              placeholder="email de contribution ulule"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addEmailEntry()
              }}
            />
            <button className="btn ghost" onClick={addEmailEntry} disabled={loading || spinning}>
              Ajouter email
            </button>
            <button className="btn ghost" onClick={addMockEntries} disabled={loading || spinning}>
              Charger démo
            </button>
            <button className="btn" onClick={drawWinner} disabled={loading || spinning || entries.length === 0}>
              Lancer le tirage
            </button>
          </div>
        </div>

        {winner ? (
          <div className="raffle-winner-banner">
            Gagnant du palier: <strong>{winner.email}</strong>
          </div>
        ) : null}
      </section>

      {status ? <p className="status">{status}</p> : null}
    </div>
  )
}
