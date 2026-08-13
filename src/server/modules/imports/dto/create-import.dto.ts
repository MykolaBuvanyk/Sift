import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

export class CreateImportDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  idempotency_key!: string;

  @IsIn(["ndjson", "csv"])
  format!: "ndjson" | "csv";

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  filename!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5_000_000_000)
  declared_size_bytes!: number;
}
