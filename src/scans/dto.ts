import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ScanMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string;
}
