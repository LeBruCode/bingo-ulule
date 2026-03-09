import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"

const DEFAULT_CATEGORIES = ["coulisses", "creative", "chat", "public", "dons", "general"]

export default function Admin() {
  const navigate = useNavigate()
  const [debug, setDebug] = useState(null)
  const [events, setEvents] = useState([])
  const [newCategoryName, setNewCategoryName] = useState("")
  const [draggedEventId, setDraggedEventId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState("")

  const adminKey = localStorage.getItem("bingoAdminKey") || ""

  const authHeaders = useMemo(
    () => ({
      "x-admin-key": adminKey,
      "content-type": "application/json"
    }),
    [adminKey]
  )

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
      grouped[category].sort((a, b) => Number(a.triggered) - Number(b.triggered))
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
      const [debugCall, eventsCall] = await Promise.all([
        fetchJson("/api/admin/debug", { headers: authHeaders }),
        fetchJson("/api/admin/events", { headers: authHeaders })
      ])

      if (!debugCall.response.ok || !eventsCall.response.ok) {
        setDebug(null)
        setEvents([])
        setStatus("Session invalide: reconnecte-toi")
        return
      }

      setDebug(debugCall.data)
      setEvents(eventsCall.data.events || [])
      setStatus("Dashboard charge")
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

  function normalizeCategory(value) {
    return value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-_]/g, "")
      .slice(0, 40)
  }

  function createCategory() {
    const normalized = normalizeCategory(newCategoryName)
    if (!normalized) return

    const current = JSON.parse(localStorage.getItem("bingoCategories") || "[]")
    const next = [...new Set([...current, normalized])]
    localStorage.setItem("bingoCategories", JSON.stringify(next))

    setNewCategoryName("")
    setStatus(`Categorie creee: ${normalized}`)
    setEvents((prev) => [...prev])
  }

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
                triggered: !item.triggered
              }
            : item
        )
      )
      setStatus(event.triggered ? "Evenement desactive" : "Evenement active")
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
      setStatus(`Evenement deplace vers ${category}`)
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
        headers: authHeaders
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur reload: ${data.error || "unknown_error"}`)
        return
      }

      setStatus("Evenements recharges")
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
        headers: authHeaders
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur reset: ${data.error || "unknown_error"}`)
        return
      }

      setStatus("Round reset")
      await loadDashboard()
    } finally {
      setLoading(false)
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
          <h1>Live Dashboard</h1>
          <p>Clique un evenement pour l activer/desactiver. Glisse-depose entre categories.</p>
        </div>
        <div className="row">
          <button className="btn ghost" onClick={loadDashboard} disabled={loading}>
            {loading ? "Chargement..." : "Rafraichir"}
          </button>
          <Link className="btn ghost" to="/admin/manage">
            Vue edition
          </Link>
          <button className="btn ghost" onClick={logout}>
            Deconnexion
          </button>
        </div>
      </div>

      <div className="admin-grid">
        <section className="panel">
          <h2>Round</h2>
          <div className="row">
            <button className="btn" onClick={reloadFromSupabase} disabled={loading}>
              Recharger
            </button>
            <button className="btn danger" onClick={resetRound} disabled={loading}>
              Reset round
            </button>
          </div>
          {debug && (
            <div className="kpis">
              <div><strong>{debug.events}</strong><span>events</span></div>
              <div><strong>{debug.players}</strong><span>players</span></div>
              <div><strong>{debug.triggered}</strong><span>triggered</span></div>
              <div><strong>{debug.gameVersion}</strong><span>game ver</span></div>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Nouvelle categorie</h2>
          <div className="row">
            <input
              className="input"
              placeholder="ex: backstage-impro"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
            />
            <button className="btn" onClick={createCategory}>Creer</button>
          </div>
          <p className="hint">Les categories sont affichees les unes sous les autres.</p>
        </section>
      </div>

      <section className="panel">
        <h2>Categories</h2>
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
                    {event.name}
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
