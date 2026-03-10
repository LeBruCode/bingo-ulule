import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import OldeupeLogo from "../components/OldeupeLogo.jsx"
import useBrandLogo from "../hooks/useBrandLogo.js"

const DEFAULT_CATEGORIES = ["coulisses", "creative", "chat", "public", "dons", "general"]

export default function AdminManage() {
  const navigate = useNavigate()
  const [logoSrc] = useBrandLogo()
  const [events, setEvents] = useState([])
  const [newEventName, setNewEventName] = useState("")
  const [bulkEventNames, setBulkEventNames] = useState("")
  const [newEventCategory, setNewEventCategory] = useState("general")
  const [newEventMandatory, setNewEventMandatory] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editingName, setEditingName] = useState("")
  const [editingCategory, setEditingCategory] = useState("general")
  const [editingMandatory, setEditingMandatory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState("")
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
      grouped[category].sort((a, b) => a.name.localeCompare(b.name, "fr"))
    }
    return grouped
  }, [events, categories])

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options)
    const data = await response.json().catch(() => ({}))
    return { response, data }
  }

  async function loadEvents() {
    setLoading(true)
    setStatus("")

    try {
      const { response, data } = await fetchJson("/api/backend-bruno/events")

      if (!response.ok) {
        if (response.status === 403) {
          navigate("/admin/login", { replace: true })
          return
        }
        setEvents([])
        setStatus("Session invalide")
        return
      }

      const list = data.events || []
      list.sort((a, b) => a.name.localeCompare(b.name, "fr"))
      setEvents(list)
      setStatus("Liste chargée")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
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
    setStatus(`Catégorie créée: ${normalized}`)
    setEvents((prev) => [...prev])
  }

  async function addEvent() {
    if (!newEventName.trim()) return

    setLoading(true)
    setStatus("")

    try {
      const { response, data } = await fetchJson("/api/backend-bruno/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: newEventName,
          category: newEventCategory,
          is_mandatory: newEventMandatory
        })
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur ajout: ${data.error || "unknown_error"}`)
        return
      }

      setNewEventName("")
      setNewEventMandatory(false)
      setStatus("Événement ajouté")
      await loadEvents()
    } finally {
      setLoading(false)
    }
  }

  async function addBulkEvents() {
    const names = bulkEventNames
      .split("\n")
      .map((name) => name.trim())
      .filter(Boolean)

    if (names.length === 0) return

    setLoading(true)
    setStatus("")

    try {
      const { response, data } = await fetchJson("/api/backend-bruno/events/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          names,
          category: newEventCategory,
          is_mandatory: newEventMandatory
        })
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur ajout lot: ${data.error || "unknown_error"}`)
        return
      }

      setBulkEventNames("")
      setStatus(`${data.inserted || 0} événement(s) ajouté(s) • ${data.skipped || 0} ignoré(s)`)
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
      const { response, data } = await fetchJson(`/api/backend-bruno/events/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: editingName,
          category: editingCategory,
          is_mandatory: editingMandatory
        })
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur edition: ${data.error || "unknown_error"}`)
        return
      }

      setEditingId(null)
      setEditingName("")
      setEditingCategory("general")
      setEditingMandatory(false)
      setStatus("Événement modifié")
      await loadEvents()
    } finally {
      setLoading(false)
    }
  }

  async function deleteEvent(id) {
    setLoading(true)
    setStatus("")

    try {
      const { response, data } = await fetchJson(`/api/backend-bruno/events/${id}`, {
        method: "DELETE"
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur suppression: ${data.error || "unknown_error"}`)
        return
      }

      if (editingId === id) {
        setEditingId(null)
        setEditingName("")
        setEditingCategory("general")
        setEditingMandatory(false)
      }

      setStatus("Événement supprimé")
      await loadEvents()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-shell">
      <div className="admin-header">
        <div>
          <OldeupeLogo className="brand-logo admin-brand-logo" src={logoSrc} />
          <h1>Édition des événements</h1>
          <p>Ajoute, renomme et recatégorise les événements.</p>
        </div>
        <div className="row">
          <Link className="btn ghost" to="/admin">
            Retour live
          </Link>
          <Link className="btn ghost" to="/admin/content">
            Textes
          </Link>
          <button className="btn ghost" onClick={loadEvents} disabled={loading}>
            {loading ? "Chargement..." : "Rafraîchir"}
          </button>
        </div>
      </div>

      <div className="admin-grid">
        <section className="panel">
          <h2>Nouvelle catégorie</h2>
          <div className="row">
            <input
              className="input"
              placeholder="ex: humour-noir"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
            />
            <button className="btn" onClick={createCategory}>Créer</button>
          </div>
        </section>

        <section className="panel">
          <h2>Ajouter un événement</h2>
          <div className="manage-create-block">
            <textarea
              className="input manage-event-textarea"
              rows="3"
              placeholder="Nouvel intitulé"
              value={newEventName}
              onChange={(e) => setNewEventName(e.target.value)}
            />
            <div className="row">
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
          </div>
          <textarea
            className="input manage-bulk-textarea"
            rows="8"
            placeholder={"Colle plusieurs événements ici.\nUne ligne = un événement."}
            value={bulkEventNames}
            onChange={(e) => setBulkEventNames(e.target.value)}
          />
          <div className="row">
            <button className="btn ghost" onClick={addBulkEvents} disabled={loading}>Ajouter le lot</button>
          </div>
          <label className="hint row">
            <input
              type="checkbox"
              checked={newEventMandatory}
              onChange={(e) => setNewEventMandatory(e.target.checked)}
            />
            Obligatoire sur toutes les cartes
          </label>
        </section>
      </div>

      <section className="panel">
        <h2>Événements par catégorie</h2>
        <div className="category-stack manage-category-stack">
          {categories.map((category) => (
            <section key={category} className="category-section manage-category-section">
              <header className="category-section-head">
                <h3>{category}</h3>
                <span>{eventsByCategory[category]?.length || 0}</span>
              </header>

              <div className="manage-event-list">
                {(eventsByCategory[category] || []).map((event) => (
                  <article key={event.id} className="manage-event-card">
                    <div className="manage-event-top">
                      <span className={event.triggered ? "pill on" : "pill"}>{event.triggered ? "Actif" : "Inactif"}</span>
                      {event.is_mandatory ? <span className="pill mandatory">Obligatoire</span> : null}
                    </div>

                    {editingId === event.id ? (
                      <div className="manage-event-edit">
                        <textarea
                          className="input manage-event-textarea"
                          rows="3"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                        />
                        <select
                          className="input"
                          value={editingCategory}
                          onChange={(e) => setEditingCategory(e.target.value)}
                        >
                          {categories.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                        <label className="hint row">
                          <input
                            type="checkbox"
                            checked={editingMandatory}
                            onChange={(e) => setEditingMandatory(e.target.checked)}
                          />
                          Obligatoire sur toutes les cartes
                        </label>
                        <div className="row">
                          <button className="btn" onClick={() => saveEvent(event.id)} disabled={loading}>Sauver</button>
                          <button className="btn ghost" onClick={() => setEditingId(null)}>Annuler</button>
                          <button className="btn danger" onClick={() => deleteEvent(event.id)} disabled={loading}>Supprimer</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="manage-event-name">{event.name}</div>
                        <div className="manage-event-meta">Catégorie: {event.category}</div>
                        <div className="row">
                          <button
                            className="btn ghost"
                            onClick={() => {
                              setEditingId(event.id)
                              setEditingName(event.name)
                              setEditingCategory(event.category)
                              setEditingMandatory(Boolean(event.is_mandatory))
                            }}
                          >
                            Editer
                          </button>
                          <button className="btn danger" onClick={() => deleteEvent(event.id)} disabled={loading}>
                            Supprimer
                          </button>
                        </div>
                      </>
                    )}
                  </article>
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
