/** يولّد كود حجز قصير قابل للقراءة والعرض على العميل، مثال: RMX-7F3K2A9Q */
export function generateBookingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // بدون أحرف/أرقام ملتبسة (0,O,1,I)
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `RMX-${code}`;
}
