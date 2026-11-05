import { SignJWT } from 'jose'
import { currentUser } from '@/lib/auth'

/** Short-lived token the browser hands to the sync server in its first frame. */
export async function GET() {
  const user = await currentUser()
  if (!user) return Response.json({ error: 'signed out' }, { status: 401 })
  const secret = process.env.SYNC_TOKEN_SECRET
  if (!secret) return Response.json({ error: 'sync is not configured' }, { status: 500 })
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setAudience('murmuration-sync')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(secret))
  return Response.json({ token }, { headers: { 'cache-control': 'no-store' } })
}
