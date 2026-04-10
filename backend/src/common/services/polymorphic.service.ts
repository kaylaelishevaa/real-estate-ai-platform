import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Maps Laravel Eloquent model class strings to the corresponding
 * Prisma delegate name on PrismaService (which extends PrismaClient).
 */
export const MODEL_MAP: Record<string, string> = {
  'App\\Models\\House': 'house',
  'App\\Models\\ApartmentUnit': 'apartmentUnit',
  'App\\Models\\Office': 'office',
  'App\\Models\\Land': 'land',
  'App\\Models\\Shop': 'shop',
  'App\\Models\\Warehouse': 'warehouse',
  'App\\Models\\Hotel': 'hotel',
  'App\\Models\\Business': 'business',
  'App\\Models\\NewProjectUnit': 'newProjectUnit',
  'App\\Models\\Listing': 'listing',
  'App\\Models\\Apartment': 'apartment',
  'App\\Models\\OfficeBuilding': 'officeBuilding',
  'App\\Models\\NewProject': 'newProject',
  'App\\Models\\Blog': 'blog',
};

@Injectable()
export class PolymorphicService {
  private readonly logger = new Logger(PolymorphicService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fetch the underlying property record for a polymorphic listing.
   * Returns null (with a logged warning) when the type is unrecognised.
   */
  async resolveListingable(
    type: string,
    id: number | bigint,
  ): Promise<Record<string, unknown> | null> {
    const delegateName = MODEL_MAP[type];

    if (!delegateName) {
      this.logger.warn(
        `resolveListingable: unknown type "${type}" – no delegate mapped`,
      );
      return null;
    }

    // PrismaService extends PrismaClient, so its delegates are properties.
    const delegate = (this.prisma as unknown as Record<string, any>)[
      delegateName
    ];

    if (!delegate || typeof delegate.findUnique !== 'function') {
      this.logger.warn(
        `resolveListingable: Prisma delegate "${delegateName}" not found on PrismaService`,
      );
      return null;
    }

    return delegate.findUnique({ where: { id } }) as Promise<Record<
      string,
      unknown
    > | null>;
  }

  /**
   * Fetch all translations for any polymorphic entity.
   * Optionally filter to a specific language.
   */
  async resolveTranslations(type: string, id: number | bigint, lang?: string) {
    return this.prisma.translation.findMany({
      where: {
        translatableType: type,
        translatableId: id,
        ...(lang ? { lang } : {}),
      },
    });
  }

  /**
   * Fetch all media for any polymorphic entity, ordered by ordinal.
   * Optionally filter to a specific group (e.g. 'gallery', 'floor_plan').
   */
  async resolveMedia(type: string, id: number | bigint, group?: string) {
    return this.prisma.media.findMany({
      where: {
        mediableType: type,
        mediableId: id,
        ...(group ? { mediableGroup: group } : {}),
      },
      orderBy: { ordinal: 'asc' },
    });
  }

  /**
   * Fetch published reviews for any polymorphic entity.
   */
  async resolveReviews(type: string, id: number | bigint) {
    return this.prisma.review.findMany({
      where: {
        reviewableType: type,
        reviewableId: id,
        isPublished: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
