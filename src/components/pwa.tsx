'use client'
import { useEffect, useState } from 'react'
import { savePushAction } from '@/app/(app)/push-actions.ts'
// Registers the service worker; offers push if VAPID is configured (NEXT_PUBLIC_VAPID_PUBLIC_KEY).
export function Pwa() {
  const [state, setState] = useState<'idle' | 'ask' | 'on' | 'off'>('idle')
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').then(async (reg) => {
      if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !('PushManager' in window)) return
      const sub = await reg.pushManager.getSubscription()
      setState(sub ? 'on' : Notification.permission === 'denied' ? 'off' : 'ask')
    }).catch(() => {})
  }, [])
  const enable = async () => {
    const reg = await navigator.serviceWorker.ready
    const key = Uint8Array.from(atob(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
    try { const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); await savePushAction(JSON.stringify(sub)); setState('on') } catch { setState('off') }
  }
  if (state !== 'ask') return null
  return <button onClick={enable} className="btn btn-quiet h-8 text-xs">Enable push alerts</button>
}
