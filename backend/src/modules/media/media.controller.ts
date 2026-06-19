import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { DeleteMediaDto } from './dto/delete-media.dto';
import { MediaService } from './media.service';

/**
 * All endpoints require admin authentication.
 *
 * Upload endpoints expect Content-Type: multipart/form-data with a single
 * file field (any field name). The file is accessed via @fastify/multipart's
 * req.file() helper — NOT via @Body(), which stays JSON-only.
 */
@Controller('media')
@UseGuards(AdminGuard, PermissionGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  // ── POST /media/upload ───────────────────────────────────────────────────

  /**
   * Accepts a multipart image file.
   * Processes it into thumbnail (150x150), medium (600x400), large (1200x800).
   * Returns { url, thumbnail, medium, large } where `url` = large variant.
   */
  @Post('upload')
  @RequirePermission('add_listing')
  async uploadImage(
    @Req() req: any,
    @Query('enhance') enhance?: string,
  ) {
    const file = await req.file();
    if (!file) throw new BadRequestException('No file provided');

    // Default to true; only "false" / "0" disables enhancement
    const shouldEnhance = enhance !== 'false' && enhance !== '0';

    const buffer: Buffer = await file.toBuffer();
    return this.mediaService.uploadImage(
      buffer,
      file.mimetype as string,
      shouldEnhance,
    );
  }

  // ── POST /media/brochure/upload ──────────────────────────────────────────

  /**
   * Accepts a PDF file. Uploaded to S3 as-is (no processing).
   * Returns { url }.
   */
  @Post('brochure/upload')
  @RequirePermission('add_listing')
  async uploadBrochure(@Req() req: any) {
    const file = await req.file();
    if (!file) throw new BadRequestException('No file provided');

    const buffer: Buffer = await file.toBuffer();
    return this.mediaService.uploadBrochure(
      buffer,
      file.filename as string,
      file.mimetype as string,
    );
  }

  // ── DELETE /media/delete ─────────────────────────────────────────────────

  /**
   * Body: { url: "https://cdn.example.com/uploads/..." }
   * Extracts the S3 key from the URL and deletes the object.
   */
  @Delete('delete')
  @RequirePermission('delete_listing')
  async deleteFile(@Body() dto: DeleteMediaDto) {
    await this.mediaService.deleteFile(dto.url);
    return { message: 'File deleted successfully' };
  }

  // ── GET /media/enhancement-status/:listingId ─────────────────────────────

  @Get('enhancement-status/:listingId')
  @RequirePermission('add_listing')
  async getEnhancementStatus(@Param('listingId') listingId: string) {
    return this.mediaService.getEnhancementStatus(Number(listingId));
  }

  // ── POST /media/enhancement-status/batch ──────────────────────────────────

  @Post('enhancement-status/batch')
  @RequirePermission('add_listing')
  async getEnhancementStatusBatch(@Body() body: { listingIds: number[] }) {
    return this.mediaService.getEnhancementStatusBatch(body.listingIds ?? []);
  }

  // ── POST /media/enhancement-retry/:listingId ─────────────────────────────

  @Post('enhancement-retry/:listingId')
  @RequirePermission('add_listing')
  async retryFailedEnhancements(@Param('listingId') listingId: string) {
    return this.mediaService.retryFailedEnhancements(Number(listingId));
  }
}
