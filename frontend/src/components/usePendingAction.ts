import { useRef, useState } from 'react'

export function usePendingAction() {
  const pending = useRef(false)
  const [isPending, setIsPending] = useState(false)

  function tryBegin() {
    if (pending.current) return false
    pending.current = true
    setIsPending(true)
    return true
  }

  function finish() {
    pending.current = false
    setIsPending(false)
  }

  return { isPending, tryBegin, finish }
}
