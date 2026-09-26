/**
 * Client-side file download for the Excel exports: fetch the URL as a blob
 * and trigger a browser save via a temporary <a download>. The filename is
 * taken from Content-Disposition (UTF-8 name preferred, ASCII fallback),
 * falling back to `fallbackName`.
 */
export async function downloadFile(url: string, fallbackName: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  const ascii = disposition.match(/filename="([^"]+)"/)
  const filename = utf8
    ? decodeURIComponent(utf8[1])
    : ascii?.[1] ?? fallbackName
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(a.href)
}
