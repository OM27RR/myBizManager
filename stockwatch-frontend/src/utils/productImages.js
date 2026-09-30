export function getProductImage(itemName = '') {
  const name = String(itemName).toLowerCase()
  if (name.includes('power') || name.includes('bank') || name.includes('battery')) return '/powerbank.png'
  if (name.includes('pen') || name.includes('drive') || name.includes('usb 3') || name.includes('flash')) return '/pendrive.png'
  if (name.includes('otg') || name.includes('adapter')) return '/otg.png'
  if (name.includes('hdmi') || name.includes('display')) return '/hdmi.png'
  if (name.includes('reader') || name.includes('card') || name.includes('sd')) return '/cardreader.png'
  if (name.includes('cable') || name.includes('cord') || name.includes('type-c') || name.includes('braided')) return '/usbcable.png'
  return null
}
