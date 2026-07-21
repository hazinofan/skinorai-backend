import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ScanMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string;
}

export class RenameConversationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;
}
