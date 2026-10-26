import { useEffect } from 'react'

const FALLBACK_MS = 1200

/**
 * Adds `.in` to `.reveal` / `.reveal-x` elements once they scroll into view.
 *
 * Those elements start at opacity 0, so the whole page is blank until something reveals
 * them. That makes the observer a single point of failure: some embedded webviews hand
 * back an IntersectionObserver that constructs cleanly and then never delivers a single
 * entry, and the visitor simply sees nothing. This therefore fails open -- if no entry
 * has arrived shortly after mount, everything is revealed unconditionally.
 */
export function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll('.reveal, .reveal-x'))
    if (!els.length) return

    const revealAll = () => els.forEach((el) => el.classList.add('in'))

    if (typeof IntersectionObserver !== 'function') {
      revealAll()
      return
    }

    let delivered = false
    const io = new IntersectionObserver(
      (entries) => {
        delivered = true
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in')
            io.unobserve(e.target)
          }
        })
      },
      { threshold: 0.12, rootMargin: '-60px 0px' },
    )
    els.forEach((el) => io.observe(el))

    const fallback = window.setTimeout(() => {
      if (!delivered) revealAll()
    }, FALLBACK_MS)

    return () => {
      window.clearTimeout(fallback)
      io.disconnect()
    }
  }, [])
}
