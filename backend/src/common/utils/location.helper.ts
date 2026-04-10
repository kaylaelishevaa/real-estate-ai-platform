import { PrismaService } from '../../prisma/prisma.service';

/**
 * Returns the ID of a location (by slug) plus every descendant ID,
 * using a PostgreSQL recursive CTE.
 *
 * Shared by LocationService, ListingService, ClusterQueryService, HouseService.
 */
export async function getDescendantLocationIds(
  prisma: PrismaService,
  slug: string,
): Promise<number[]> {
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    WITH RECURSIVE descendants AS (
      SELECT id
      FROM   locations
      WHERE  slug = ${slug}

      UNION ALL

      SELECT l.id
      FROM   locations l
      INNER JOIN descendants d ON l.parent_id = d.id
    )
    SELECT id FROM descendants
  `;
  return rows.map((r) => Number(r.id));
}
