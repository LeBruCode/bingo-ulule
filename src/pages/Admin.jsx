import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"

const DEFAULT_CATEGORIES = ["coulisses", "creative", "chat", "public", "dons", "general"]

export default function Admin() {
  const navigate = useNavigate()
  const [debug, setDebug] = useState(null)
  const [boardRows, setBoardRows] = useState(4)
  const [boardCols, setBoardCols] = useState(5)
  const [events, setEvents] = useState([])
  const [draggedEventId, setDraggedEventId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [tierLoading, setTierLoading] = useState(false)
  const [status, setStatus] = useState("")

  const adminKey = localStorage.getItem("bingoAdminKey") || ""

  const authHeaders = useMemo(
    () => ({
      "x-admin-key": adminKey,
      "content-type": "application/json"
    }),
    [adminKey]
  )

  const authOnlyHeaders = useMemo(
    () => ({
      "x-admin-key": adminKey
    }),
    [adminKey]
  )

  const categories = useMemo(() => {
    const fromEvents = events.map((event) => event.category)
    const fromStorage = JSON.parse(localStorage.getItem("bingoCategories") || "[]")
    const merged = [...DEFAULT_CATEGORIES, ...fromStorage, ...fromEvents]
    return [...new Set(merged.filter(Boolean))]
  }, [events])

  const winnerTiers = useMemo(() => {
    const byLine = debug?.winners?.byLine || {}
    return Object.entries(byLine)
      .sort(([a], [b]) => Number(a.replace("line_", "")) - Number(b.replace("line_", "")))
      .map(([key, count]) => {
        const lineNumber = Number(key.replace("line_", ""))
        const label = lineNumber === Number(debug?.rows) ? `Carton plein (${lineNumber} lignes)` : `${lineNumber} ligne${lineNumber > 1 ? "s" : ""}`
        return { key, label, count }
      })
  }, [debug])

  const tierControls = useMemo(() => {
    const rows = Number(debug?.rows || 0)
    if (!rows) return []
    return Array.from({ length: rows }, (_, index) => {
      const tier = index + 1
      const label = tier === rows ? "Carton plein" : `${tier} ligne${tier > 1 ? "s" : ""}`
      return { tier, label }
    })
  }, [debug])

  const eventsByCategory = useMemo(() => {
    const grouped = {}
    for (const category of categories) grouped[category] = []

    for (const event of events) {
      if (!grouped[event.category]) grouped[event.category] = []
      grouped[event.category].push(event)
    }

    for (const category of Object.keys(grouped)) {
      grouped[category].sort((a, b) => {
        if (a.triggered !== b.triggered) return Number(a.triggered) - Number(b.triggered)
        const aOrder = a.trigger_order || Number.MAX_SAFE_INTEGER
        const bOrder = b.trigger_order || Number.MAX_SAFE_INTEGER
        return aOrder - bOrder
      })
    }

    return grouped
  }, [events, categories])

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options)
    const data = await response.json().catch(() => ({}))
    return { response, data }
  }

  async function loadDashboard() {
    setLoading(true)
    setStatus("")

    try {
      const bootstrapCall = await fetchJson("/api/admin/bootstrap", { headers: authHeaders })

      if (!bootstrapCall.response.ok) {
        setDebug(null)
        setEvents([])
        setStatus("Session invalide: reconnecte-toi")
        return
      }

      setDebug(bootstrapCall.data.debug)
      setBoardRows(bootstrapCall.data.debug?.rows || 4)
      setBoardCols(bootstrapCall.data.debug?.cols || 5)
      setEvents(bootstrapCall.data.events?.events || [])
      if (bootstrapCall.data.bootstrapping) {
        setStatus("Initialisation des cartes en cours...")
        setTimeout(() => {
          loadDashboard()
        }, 1200)
      } else {
        setStatus("Tableau de bord chargé")
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!adminKey) {
      navigate("/admin/login", { replace: true })
      return
    }
    loadDashboard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function toggleEvent(event) {
    setLoading(true)
    setStatus("")

    try {
      const { response, data } = await fetchJson(`/api/admin/events/${event.id}/toggle`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ active: !event.triggered })
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur activation: ${data.error || "unknown_error"}`)
        return
      }

      setEvents((prev) =>
        prev.map((item) =>
          item.id === event.id
            ? {
                ...item,
                triggered: !item.triggered,
                trigger_order: item.triggered
                  ? null
                  : prev.filter((candidate) => candidate.triggered).length + 1,
                activation_count: item.triggered
                  ? item.activation_count || 0
                  : (item.activation_count || 0) + 1
              }
            : item
        )
      )
      setDebug((prev) =>
        prev
          ? {
              ...prev,
              triggered: Math.max(0, prev.triggered + (event.triggered ? -1 : 1)),
              activationCount: Math.max(0, (prev.activationCount || 0) + (event.triggered ? 0 : 1))
            }
          : prev
      )
      setStatus(event.triggered ? "Événement désactivé" : "Événement activé")
    } finally {
      setLoading(false)
    }
  }

  async function moveEventToCategory(eventId, category) {
    const event = events.find((item) => item.id === eventId)
    if (!event || event.category === category) return

    setLoading(true)
    setStatus("")

    try {
      const { response, data } = await fetchJson(`/api/admin/events/${eventId}`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ category })
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur deplacement: ${data.error || "unknown_error"}`)
        return
      }

      setEvents((prev) =>
        prev.map((item) =>
          item.id === eventId
            ? {
                ...item,
                category
              }
            : item
        )
      )
      setStatus(`Événement déplacé vers ${category}`)
    } finally {
      setLoading(false)
    }
  }

  async function reloadFromSupabase() {
    setLoading(true)
    setStatus("")

    try {
      const { response, data } = await fetchJson("/api/admin/reload", {
        method: "POST",
        headers: authOnlyHeaders
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur reload: ${data.error || "unknown_error"}`)
        return
      }

      setStatus("Événements rechargés")
      await loadDashboard()
    } finally {
      setLoading(false)
    }
  }

  async function resetRound() {
    setLoading(true)
    setStatus("")

    try {
      const { response, data } = await fetchJson("/api/admin/reset-round", {
        method: "POST",
        headers: authOnlyHeaders
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur reset: ${data.error || "unknown_error"}`)
        return
      }

      setStatus("Manche réinitialisée")
      await loadDashboard()
    } finally {
      setLoading(false)
    }
  }

  async function updateBoardSize() {
    setLoading(true)
    setStatus("")

    try {
      const { response, data } = await fetchJson("/api/admin/board", {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ rows: Number(boardRows), cols: Number(boardCols) })
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur format: ${data.details || data.error || "unknown_error"}`)
        return
      }

      setStatus(`Format applique: ${data.board.rows}x${data.board.cols}`)
      await loadDashboard()
    } finally {
      setLoading(false)
    }
  }

  async function chooseTargetTier(tier) {
    setTierLoading(true)
    setStatus("")

    try {
      const { response, data } = await fetchJson("/api/admin/target-tier", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ tier })
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur palier: ${data.error || "unknown_error"}`)
        return
      }

      setDebug(data.debug || null)
      setStatus(`Palier en cours: ${data.debug?.targetLabel || `${tier} ligne(s)`}`)
    } finally {
      setTierLoading(false)
    }
  }

  function logout() {
    localStorage.removeItem("bingoAdminKey")
    navigate("/admin/login", { replace: true })
  }

  return (
    <div className="admin-shell">
      <div className="admin-header">
        <div>
          <h1>Tableau de bord live</h1>
          <p>Clique un événement pour l activer/desactiver. Glisse-depose entre catégories.</p>
        </div>
        <div className="row">
          <button className="btn ghost" onClick={loadDashboard} disabled={loading}>
            {loading ? "Chargement..." : "Rafraîchir"}
          </button>
          <Link className="btn ghost" to="/admin/manage">
            Vue édition
          </Link>
          <button className="btn ghost" onClick={logout}>
            Deconnexion
          </button>
        </div>
      </div>

      <div className="admin-grid">
        <section className="panel">
          <h2>Manche</h2>
          <div className="row">
            <button className="btn" onClick={reloadFromSupabase} disabled={loading}>
              Recharger
            </button>
            <button className="btn danger" onClick={resetRound} disabled={loading}>
              Réinitialiser la manche
            </button>
          </div>
          <div className="row">
            {tierControls.map((tierItem) => (
              <button
                key={tierItem.tier}
                className={`btn ghost ${debug?.targetTier === tierItem.tier ? "active" : ""}`}
                onClick={() => chooseTargetTier(tierItem.tier)}
                disabled={tierLoading}
              >
                {tierItem.label}
              </button>
            ))}
          </div>
          {debug?.targetLabel ? (
            <p className="hint">
              Palier en cours: <strong>{debug.targetLabel}</strong>
              {debug?.tierLocked ? " (gagnant trouvé, passe au palier suivant)" : ""}
            </p>
          ) : null}
          <div className="row">
            <input
              className="input"
              type="number"
              min="2"
              max="8"
              value={boardRows}
              onChange={(e) => setBoardRows(e.target.value)}
            />
            <input
              className="input"
              type="number"
              min="2"
              max="8"
              value={boardCols}
              onChange={(e) => setBoardCols(e.target.value)}
            />
            <button className="btn ghost" onClick={updateBoardSize} disabled={loading}>
              Appliquer format
            </button>
          </div>
          {debug && (
            <>
              <div className="kpis">
                <div><strong>{debug.events}</strong><span>événements</span></div>
                <div><strong>{debug.players}</strong><span>joueurs</span></div>
                <div><strong>{debug.triggered}</strong><span>activés</span></div>
                <div><strong>{debug.activationCount || 0}</strong><span>activations</span></div>
                <div><strong>{debug.rows}x{debug.cols}</strong><span>grille</span></div>
                <div><strong>{debug.gameVersion}</strong><span>version de partie</span></div>
              </div>
              <div className="winner-grid">
                {winnerTiers.map((tier) => (
                  <div key={tier.key} className="winner-card">
                    <span>{tier.label}</span>
                    <strong>{tier.count}</strong>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

      </div>

      <section className="panel">
        <h2>Catégories</h2>
        <div className="category-stack">
          {categories.map((category) => (
            <section
              key={category}
              className="category-section"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const eventId = Number(e.dataTransfer.getData("text/event-id") || draggedEventId)
                if (eventId) moveEventToCategory(eventId, category)
                setDraggedEventId(null)
              }}
            >
              <header className="category-section-head">
                <h3>{category}</h3>
                <span>{eventsByCategory[category]?.length || 0}</span>
              </header>

              <div className="category-events">
                {(eventsByCategory[category] || []).map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    className={`event-chip ${event.triggered ? "on" : ""}`}
                    draggable
                    onDragStart={(e) => {
                      setDraggedEventId(event.id)
                      e.dataTransfer.setData("text/event-id", String(event.id))
                    }}
                    onClick={() => toggleEvent(event)}
                  >
                    <span>{event.name}</span>
                    {event.trigger_order ? <span className="event-order">#{event.trigger_order}</span> : null}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>

      {status && <p className="status">{status}</p>}
    </div>
  )
}
