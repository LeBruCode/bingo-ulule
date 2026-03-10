import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import OldeupeLogo from "../components/OldeupeLogo.jsx"
import useBrandLogo from "../hooks/useBrandLogo.js"

const DEFAULT_CATEGORIES = ["coulisses", "creative", "chat", "public", "dons", "general"]

export default function AdminControlMobile() {
  const navigate = useNavigate()
  const [logoSrc] = useBrandLogo()
  const [debug, setDebug] = useState(null)
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState("")

  const categories = useMemo(() => {
    const fromEvents = events.map((event) => event.category)
    const fromStorage = JSON.parse(localStorage.getItem("bingoCategories") || "[]")
    const merged = [...DEFAULT_CATEGORIES, ...fromStorage, ...fromEvents]
    return [...new Set(merged.filter(Boolean))]
  }, [events])

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

  async function loadControl() {
    setLoading(true)
    setStatus("")
    try {
      const bootstrapCall = await fetchJson("/api/backend-bruno/bootstrap")
      if (!bootstrapCall.response.ok) {
        setStatus("Session invalide")
        return
      }
      setDebug(bootstrapCall.data.debug || null)
      setEvents(bootstrapCall.data.events?.events || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadControl()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function toggleEvent(event) {
    setLoading(true)
    setStatus("")
    try {
      const { response, data } = await fetchJson(`/api/backend-bruno/events/${event.id}/toggle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
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
                trigger_order: data.debug?.activationCount || item.trigger_order || null
              }
            : item
        )
      )
      setDebug(data.debug || null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mobile-control-shell">
      <header className="mobile-control-header">
        <OldeupeLogo className="brand-logo mobile-control-logo" src={logoSrc} />
        <div className="mobile-control-copy">
          <h1>Pilotage mobile</h1>
          <p>
            Manche en cours : <strong>{debug?.targetLabel || "1 ligne"}</strong>
          </p>
        </div>
        <div className="mobile-control-actions">
          <Link className="btn ghost" to="/admin">
            Dashboard
          </Link>
          <button className="btn ghost" onClick={loadControl} disabled={loading}>
            {loading ? "Chargement..." : "Rafraîchir"}
          </button>
        </div>
      </header>

      <div className="mobile-control-kpis">
        <div>
          <strong>{debug?.triggered || 0}</strong>
          <span>Événements tirés</span>
        </div>
        <div>
          <strong>{debug?.connectedPlayers || 0}</strong>
          <span>Joueurs connectés</span>
        </div>
      </div>

      <div className="mobile-control-categories">
        {categories.map((category) => (
          <section key={category} className="mobile-control-category">
            <header className="mobile-control-category-head">
              <h2>{category}</h2>
              <span>{eventsByCategory[category]?.length || 0}</span>
            </header>

            <div className="mobile-control-event-list">
              {(eventsByCategory[category] || []).map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className={`mobile-control-event ${event.triggered ? "on" : ""}`}
                  onClick={() => toggleEvent(event)}
                  disabled={loading}
                >
                  <span className="mobile-control-event-name">{event.name}</span>
                  <span className="mobile-control-event-meta">
                    {event.triggered
                      ? `Validé${event.trigger_order ? ` • #${event.trigger_order}` : ""}`
                      : "À activer"}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {status ? <p className="status">{status}</p> : null}
    </div>
  )
}
