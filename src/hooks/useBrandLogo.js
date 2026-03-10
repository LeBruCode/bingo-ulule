import { useEffect, useState } from "react"

export default function useBrandLogo(initialValue = "") {
  const [logoSrc, setLogoSrc] = useState(initialValue)

  useEffect(() => {
    let cancelled = false

    async function loadBranding() {
      try {
        const response = await fetch("/api/branding")
        const data = await response.json().catch(() => ({}))
        if (!response.ok || cancelled) return
        setLogoSrc(typeof data?.branding?.logoSrc === "string" ? data.branding.logoSrc : "")
      } catch {
        if (!cancelled) setLogoSrc((current) => current || "")
      }
    }

    loadBranding()

    return () => {
      cancelled = true
    }
  }, [])

  return [logoSrc, setLogoSrc]
}
