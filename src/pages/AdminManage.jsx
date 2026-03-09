import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"

const DEFAULT_CATEGORIES = ["coulisses", "creative", "chat", "public", "dons", "general"]

export default function AdminManage() {
  const navigate = useNavigate()
  const [events, setEvents] = useState([])
  const [newEventName, setNewEventName] = useState("")
  const [newEventCategory, setNewEventCategory] = useState("general")
  const [editingId, setEditingId] = useState(null)
  const [editingName, setEditingName] = useState("")
  const [editingCategory, setEditingCategory] = useState("general")
  const [newCategoryName, setNewCategoryName] = useState("")
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

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options)
    const data = await response.json().catch(() => ({}))
    return { response, data }
  }

  async function loadEvents() {
    setLoading(true)
    setStatus("")

    try {
      const { response, data } = await fetchJson("/api/admin/events", {
        headers: authHeaders
      })

      if (!response.ok) {
        setEvents([])
        setStatus("Session invalide")
        return
      }

      const list = data.events || []
      list.sort((a, b) => a.name.localeCompare(b.name, "fr"))
      setEvents(list)
      setStatus("Liste chargee")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!adminKey) {
      navigate("/admin/login", { replace: true })
      return
    }
    loadEvents()
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
    setNewEventCategory(normalized)
    setStatus(`Categorie creee: ${normalized}`)
    setEvents((prev) => [...prev])
  }

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
      await loadEvents()
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
      setStatus("Evenement modifie")
      await loadEvents()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-shell">
      <div className="admin-header">
        <div>
          <h1>Edition des evenements</h1>
          <p>Ajoute, renomme et recategorise les evenements.</p>
        </div>
        <div className="row">
          <Link className="btn ghost" to="/admin">
            Retour live
          </Link>
          <button className="btn ghost" onClick={loadEvents} disabled={loading}>
            {loading ? "Chargement..." : "Rafraichir"}
          </button>
        </div>
      </div>

      <div className="admin-grid">
        <section className="panel">
          <h2>Nouvelle categorie</h2>
          <div className="row">
            <input
              className="input"
              placeholder="ex: humour-noir"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
            />
            <button className="btn" onClick={createCategory}>Creer</button>
          </div>
        </section>

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
      </div>

      <section className="panel">
        <h2>Liste complete</h2>
        <div className="table">
          {events.map((event) => (
            <div key={event.id} className="table-row">
              <span className={event.triggered ? "pill on" : "pill"}>{event.triggered ? "On" : "Off"}</span>

              {editingId === event.id ? (
                <div className="row">
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
                    {categories.map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <span className="event-name">{event.name} <small className="event-category">[{event.category}]</small></span>
              )}

              {editingId === event.id ? (
                <div className="row">
                  <button className="btn" onClick={() => saveEvent(event.id)} disabled={loading}>Sauver</button>
                  <button className="btn ghost" onClick={() => setEditingId(null)}>Annuler</button>
                </div>
              ) : (
                <button
                  className="btn ghost"
                  onClick={() => {
                    setEditingId(event.id)
                    setEditingName(event.name)
                    setEditingCategory(event.category)
                  }}
                >
                  Editer
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {status && <p className="status">{status}</p>}
    </div>
  )
}
