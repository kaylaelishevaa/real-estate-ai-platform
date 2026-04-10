import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AdminOnlyGuard } from '../../common/guards/admin-only.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { AdminLocationService } from './admin-location.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

@Controller('admin/locations')
@UseGuards(AdminGuard, PermissionGuard)
export class AdminLocationController {
  constructor(private readonly service: AdminLocationService) {}

  @Get()
  @RequirePermission('view_location')
  findAll(@Query() query: any, @Req() req: any) {
    const path: string = (req.url as string).split('?')[0];
    return this.service.findAll(query, path);
  }

  @Get(':id')
  @RequirePermission('view_location')
  findOne(@Param('id') id: string) {
    return this.service.findById(parseInt(id, 10));
  }

  @Post()
  @UseGuards(AdminOnlyGuard)
  @RequirePermission('add_location')
  create(@Body() dto: CreateLocationDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @UseGuards(AdminOnlyGuard)
  @RequirePermission('edit_location')
  update(@Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.service.update(parseInt(id, 10), dto);
  }

  @Delete(':id')
  @UseGuards(AdminOnlyGuard)
  @RequirePermission('delete_location')
  remove(@Param('id') id: string) {
    return this.service.remove(parseInt(id, 10));
  }
}
