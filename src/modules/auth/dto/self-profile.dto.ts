import { IsString, IsNotEmpty, MaxLength, MinLength, Matches, IsOptional, IsInt, Min, Max, IsDateString } from 'class-validator';
import { Transform, Type } from 'class-transformer';
export class UpdateSelfProfileDto {
  @IsString() @IsNotEmpty() @MaxLength(100) @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  firstName: string;
  @IsString() @IsNotEmpty() @MaxLength(100) @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  lastName: string;
  @IsOptional() @IsString() @Matches(/^(?:\+?[0-9 ()-]{7,20})?$/)
  phone?: string;
}
export class ChangeSelfPasswordDto {
  @IsString() @IsNotEmpty() @MaxLength(128) currentPassword: string;
  @IsString() @MinLength(12) @MaxLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, { message: 'Use uppercase, lowercase, a number and a symbol.' })
  newPassword: string;
}
export class SelfActivityDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 10;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
