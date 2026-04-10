import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService], // this module CREATES this service
  exports: [PrismaService], // other modules can USE this service
})
export class PrismaModule {}
