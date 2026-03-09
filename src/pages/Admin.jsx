import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"

const DEFAULT_CATEGORIES = ["coulisses", "creative", "chat", "public", "dons", "general"]

export default function Admin() {
  const navigate = useNavigate()
  const [debug, setDebug] = useState(null)
  const [events, setEvents] = useState([])
  const [newEventName, setNewEventName] = useState("")
  const [newEventCategory, setNewEventCategory] = useState("general")
  const [newCategoryName, setNewCategoryName] = useState("")
  const [editingId, setEditingId] = useState(null)
  const [editingName, setEditingName] = useState("")
  const [editingCategory, setEditingCategory] = useState("general")
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

  async function addEvent() {
    if (!newEventName.trim()) return
    setLoading(true)
    setStatus("")
    try {
      const { response, data } = await fetchJson("/api/admin/events", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ name: newEventName, category: newEventCategory })
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur ajout: ${data.error || "unknown_error"}`)
        return
      }

      setNewEventName("")
      setStatus("Evenement ajoute")
      await loadDashboard()
    } finally {
      setLoading(false)
    }
  }

  async function saveEvent(id) {
    if (!editingName.trim()) return
    setLoading(true)
    setStatus("")
    try {
      const { response, data } = await fetchJson(`/api/admin/events/${id}`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ name: editingName, category: editingCategory })
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur edition: ${data.error || "unknown_error"}`)
        return
      }

      setEditingId(null)
      setEditingName("")
      setEditingCategory("general")
      setStatus("Evenement mis a jour")
      await loadDashboard()
    } finally {
      setLoading(false)
    }
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

      setStatus(event.triggered ? "Evenement desactive" : "Evenement active")
      await loadDashboard()
    } finally {
      setLoading(false)
    }
  }

  async function moveEventToCategory(eventId, category) {
    const event = events.find((e) => e.id === eventId)
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

      setStatus(`Evenement deplace vers ${category}`)
      await loadDashboard()
    } finally {
      setLoading(false)
    }
  }

  function createCategory() {
    const normalized = newCategoryName
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-_]/g, "")
      .slice(0, 40)

    if (!normalized) return

    const current = JSON.parse(localStorage.getItem("bingoCategories") || "[]")
    const next = [...new Set([...current, normalized])]
    localStorage.setItem("bingoCategories", JSON.stringify(next))

    setNewCategoryName("")
    setNewEventCategory(normalized)
    setStatus(`Categorie creee: ${normalized}`)
    setEvents((prev) => [...prev])
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
          <p>Glisse-depose des evenements entre categories + activation en un clic.</p>
        </div>
        <div className="row">
          <button className="btn ghost" onClick={loadDashboard} disabled={loading}>
            {loading ? "Chargement..." : "Rafraichir"}
          </button>
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
              placeholder="ex: coulisses-plateau"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
            />
            <button className="btn" onClick={createCategory}>Creer</button>
          </div>
          <p className="hint">Astuce: cree la categorie puis glisse un evenement dedans.</p>
        </section>
      </div>

      <section className="panel">
        <h2>Ajouter un evenement</h2>
        <div className="row">
          <input
            className="input"
            placeholder="Nouvel intitule"
            value={newEventName}
            onChange={(e) => setNewEventName(e.target.value)}
          />
          <select
            className="input"
            value={newEventCategory}
            onChange={(e) => setNewEventCategory(e.target.value)}
          >
            {categories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
          <button className="btn" onClick={addEvent} disabled={loading}>Ajouter</button>
        </div>
      </section>

      <section className="panel">
        <h2>Board categories (drag and drop)</h2>
        <div className="board">
          {categories.map((category) => (
            <div
              key={category}
              className="column"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const eventId = Number(e.dataTransfer.getData("text/event-id") || draggedEventId)
                if (eventId) moveEventToCategory(eventId, category)
                setDraggedEventId(null)
              }}
            >
              <div className="column-head">
                <h3>{category}</h3>
                <span>{eventsByCategory[category]?.length || 0}</span>
              </div>

              <div className="column-list">
                {(eventsByCategory[category] || []).map((event) => (
                  <div
                    key={event.id}
                    className={`event-card ${event.triggered ? "on" : ""}`}
                    draggable
                    onDragStart={(e) => {
                      setDraggedEventId(event.id)
                      e.dataTransfer.setData("text/event-id", String(event.id))
                    }}
                  >
                    {editingId === event.id ? (
                      <div className="event-edit">
                        <input
                          className="input"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                        />
                        <select
                          className="input"
                          value={editingCategory}
                          onChange={(e) => setEditingCategory(e.target.value)}
                        >
                          {categories.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                        <div className="row">
                          <button className="btn" onClick={() => saveEvent(event.id)} disabled={loading}>Sauver</button>
                          <button className="btn ghost" onClick={() => setEditingId(null)}>Annuler</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="event-title">{event.name}</div>
                        <div className="row">
                          <button className="btn ghost" onClick={() => toggleEvent(event)} disabled={loading}>
                            {event.triggered ? "Desactiver" : "Activer"}
                          </button>
                          <button
                            className="btn ghost"
                            onClick={() => {
                              setEditingId(event.id)
                              setEditingName(event.name)
                              setEditingCategory(event.category)
                            }}
                            disabled={loading}
                          >
                            Editer
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {status && <p className="status">{status}</p>}
    </div>
  )
}
