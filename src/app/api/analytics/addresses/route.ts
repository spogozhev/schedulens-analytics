import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * Canonical address list ("<Улица>, д. <дом>") with the number of
 * auditoriums at each address — options for the address filter on the
 * rooms tab.
 */
export async function GET() {
  const rows = await db.address.findMany({
    select: {
      id: true,
      displayName: true,
      _count: { select: { locations: true } },
    },
    orderBy: { displayName: 'asc' },
  })

  return NextResponse.json({
    addresses: rows.map((r) => ({
      id: r.id,
      displayName: r.displayName,
      roomCount: r._count.locations,
    })),
  })
}
