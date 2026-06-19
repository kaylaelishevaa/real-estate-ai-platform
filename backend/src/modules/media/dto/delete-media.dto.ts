import { IsUrl } from 'class-validator';

export class DeleteMediaDto {
  @IsUrl({}, { message: 'url must be a valid URL' })
  url: string;
}
