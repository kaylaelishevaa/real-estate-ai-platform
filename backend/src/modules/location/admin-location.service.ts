import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate, paginateQuery } from '../../common/utils/pagination.helper';

@Injectable()
export class AdminLocationService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: any, path: string) {
    const { page, perPage } = paginateQuery({
      page: query.page,
      per_page: query.load ?? query.per_page,
    });

    const where: Prisma.LocationWhereInput = {};
    if (query.search) where.name = { contains: query.search };
    if (query.parent_id) where.parentId = parseInt(query.parent_id, 10);
    if (query.is_popular !== undefined) where.isPopular = query.is_popular === 'true';
    if (query.is_subarea !== undefined) where.isSubarea = query.is_subarea === 'true';

    const [items, total] = await Promise.all([
      this.prisma.location.findMany({
        where,
        include: { parent: { select: { id: true, name: true } }, _count: { select: { children: true } } },
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: query.sort === 'oldest' ? { createdAt: 'asc' } : query.sort === 'newest' ? { createdAt: 'desc' } : { name: 'asc' },
      }),
      this.prisma.location.count({ where }),
    ]);

    return paginate(items, total, page, perPage, path);
  }

  async findById(id: number) {
    const location = await this.prisma.location.findUnique({
      where: { id },
      include: { parent: true, children: true },
    });
    if (!location) throw new NotFoundException(`Location #${id} not found`);
    return location;
  }

  async create(data: any) {
    return this.prisma.location.create({
      data: {
        name: data.name,
        slug: data.slug,
        parentId: data.parent_id,
        picture: data.picture,
        isSubarea: data.is_subarea ?? false,
        isPopular: data.is_popular ?? false,
        longitude: data.longitude,
        latitude: data.latitude,
        nearbyLocation: data.nearby_location,
      },
    });
  }

  async update(id: number, data: any) {
    const existing = await this.prisma.location.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Location #${id} not found`);

    return this.prisma.location.update({
      where: { id },
      data: keepDefined({
        name: data.name,
        slug: data.slug,
        parentId: data.parent_id,
        picture: data.picture,
        isSubarea: data.is_subarea,
        isPopular: data.is_popular,
        longitude: data.longitude,
        latitude: data.latitude,
        nearbyLocation: data.nearby_location,
      }),
    });
  }

  async remove(id: number) {
    const existing = await this.prisma.location.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Location #${id} not found`);

    // Guard: refuse to delete locations that have children, listings, or dependent entities
    const [childCount, listingCount, apartmentCount, projectCount, buildingCount] = await Promise.all([
      this.prisma.location.count({ where: { parentId: id } }),
      this.prisma.listing.count({ where: { locationId: id } }),
      this.prisma.apartment.count({ where: { locationId: id } }),
      this.prisma.newProject.count({ where: { locationId: id } }),
      this.prisma.officeBuilding.count({ where: { locationId: id } }),
    ]);

    const deps: string[] = [];
    if (childCount > 0) deps.push(`${childCount} child location(s)`);
    if (listingCount > 0) deps.push(`${listingCount} listing(s)`);
    if (apartmentCount > 0) deps.push(`${apartmentCount} apartment(s)`);
    if (projectCount > 0) deps.push(`${projectCount} new project(s)`);
    if (buildingCount > 0) deps.push(`${buildingCount} office building(s)`);

    if (deps.length > 0) {
      throw new BadRequestException(
        `Cannot delete location "${existing.name}" — it has ${deps.join(', ')}. Reassign or delete them first.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.translation.deleteMany({
        where: { translatableType: 'App\\Models\\Location', translatableId: id },
      });
      await tx.media.deleteMany({
        where: { mediableType: 'App\\Models\\Location', mediableId: id },
      });
      await tx.location.delete({ where: { id } });
    });

    return { id, deleted: true };
  }
}

function keepDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
