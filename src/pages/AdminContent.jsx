import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import OldeupeLogo from "../components/OldeupeLogo.jsx"

const CONTENT_SECTIONS = [
  { key: "brand", label: "Logo" },
  { key: "player", label: "Joueur" },
  { key: "overlay", label: "Overlay" }
]

export default function AdminContent() {
  const navigate = useNavigate()
  const [content, setContent] = useState({})
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState("")
  const [persisted, setPersisted] = useState(true)
  const [isDraggingLogo, setIsDraggingLogo] = useState(false)

  const sections = useMemo(() => {
    const keys = Object.keys(content).sort((a, b) => a.localeCompare(b, "fr"))
    return CONTENT_SECTIONS.map((section) => ({
      ...section,
      items: keys.filter((key) => key.startsWith(`${section.key}.`) && key !== "player.phase_prefix")
    })).filter((section) => section.items.length > 0)
  }, [content])

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

  async function loadContent() {
    setLoading(true)
    setStatus("")
    try {
      const { response, data } = await fetchJson("/api/backend-bruno/content")
      if (!response.ok) {
        if (response.status === 403) {
          navigate("/admin/login", { replace: true })
          return
        }
        setStatus("Impossible de charger les contenus")
        return
      }
      setContent(data.content || {})
      setPersisted(Boolean(data.persisted))
      setStatus("Contenus charges")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadContent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function readLogoFile(file) {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      setStatus("Le logo doit etre une image")
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : ""
      if (!result) {
        setStatus("Impossible de lire cette image")
        return
      }
      setContent((prev) => ({ ...prev, "brand.logo_src": result }))
      setStatus("Logo charge localement, pense a sauvegarder")
    }
    reader.onerror = () => {
      setStatus("Impossible de lire cette image")
    }
    reader.readAsDataURL(file)
  }

  function handleLogoDrop(event) {
    event.preventDefault()
    setIsDraggingLogo(false)
    const file = event.dataTransfer?.files?.[0]
    readLogoFile(file)
  }

  async function saveContent() {
    setLoading(true)
    setStatus("")
    try {
      const entries = Object.entries(content).map(([key, value]) => ({ key, value }))
      const { response, data } = await fetchJson("/api/backend-bruno/content", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries })
      })
      if (!response.ok || !data.ok) {
        setStatus(`Erreur sauvegarde: ${data.error || "unknown_error"}`)
        return
      }
      setContent(data.content || {})
      setPersisted(Boolean(data.persisted))
      setStatus(data.persisted ? "Contenus sauvegardes" : "Contenus appliques, mais non persistants tant que la table Supabase n'existe pas")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-shell">
      <div className="admin-header">
        <div>
          <OldeupeLogo className="brand-logo admin-brand-logo" src={content["brand.logo_src"] || ""} />
          <h1>Contenus editables</h1>
          <p>Modifie ici les textes visibles sans retoucher le code, y compris la source du logo original.</p>
        </div>
        <div className="row">
          <Link className="btn ghost" to="/admin">
            Retour live
          </Link>
          <button className="btn ghost" onClick={loadContent} disabled={loading}>
            {loading ? "Chargement..." : "Rafraichir"}
          </button>
          <button className="btn" onClick={saveContent} disabled={loading}>
            Sauvegarder
          </button>
        </div>
      </div>

      {!persisted ? (
        <section className="panel">
          <p className="status">Attention: la table Supabase des contenus n'est pas encore disponible. Les changements restent actifs, mais ne survivront pas a un redemarrage serveur.</p>
        </section>
      ) : null}

      {sections.map((section) => (
        <section key={section.key} className="panel">
          <h2>{section.label}</h2>
          {section.key === "brand" ? (
            <div className="brand-editor-preview">
              <OldeupeLogo className="brand-logo admin-brand-logo" src={content["brand.logo_src"] || ""} />
              <p className="hint">
                Glisse-depose ici l'image originale, ou clique pour la choisir. Aucun retraitement n'est applique.
              </p>
              <label
                className={`brand-dropzone ${isDraggingLogo ? "dragging" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault()
                  setIsDraggingLogo(true)
                }}
                onDragLeave={() => setIsDraggingLogo(false)}
                onDrop={handleLogoDrop}
              >
                <input
                  className="brand-file-input"
                  type="file"
                  accept="image/*"
                  onChange={(event) => readLogoFile(event.target.files?.[0])}
                />
                <strong>Glisser l'image ici</strong>
                <span>ou cliquer pour choisir le fichier original</span>
              </label>
              <div className="row">
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => {
                    setContent((prev) => ({ ...prev, "brand.logo_src": "" }))
                    setStatus("Logo retire localement, pense a sauvegarder")
                  }}
                >
                  Retirer le logo
                </button>
              </div>
            </div>
          ) : null}
          <div className="content-editor-list">
            {section.items.map((key) => (
              <label key={key} className="content-editor-item">
                <span className="content-editor-key">{key}</span>
                {key === "brand.logo_src" ? (
                  <textarea
                    className="input content-editor-textarea"
                    rows="3"
                    value={content[key] || ""}
                    onChange={(e) => setContent((prev) => ({ ...prev, [key]: e.target.value }))}
                    placeholder="L'image glissee ici apparaitra en data URL."
                  />
                ) : (
                  <textarea
                    className="input content-editor-textarea"
                    rows="3"
                    value={content[key] || ""}
                    onChange={(e) => setContent((prev) => ({ ...prev, [key]: e.target.value }))}
                  />
                )}
              </label>
            ))}
          </div>
        </section>
      ))}

      {status ? <p className="status">{status}</p> : null}
    </div>
  )
}
