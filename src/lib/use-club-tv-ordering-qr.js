import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export function useClubTvOrderingQr(url) {
  const [code, setCode] = useState(null)

  useEffect(() => {
    if (!url) return undefined
    let active = true
    QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 4, width: 512 })
      .then(data => { if (active) setCode({ url, data }) })
      .catch(() => { if (active) setCode({ url, error: true }) })
    return () => { active = false }
  }, [url])

  return url && code?.url === url ? code : null
}
