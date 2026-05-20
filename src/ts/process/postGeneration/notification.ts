export async function fireDesktopNotification(body: string): Promise<void> {
  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return
    const noti = new Notification('Risuai', { body })
    noti.onclick = () => {
      window.focus()
    }
  } catch {}
}
