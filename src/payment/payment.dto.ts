import { IsNotEmpty, IsNumber, IsUUID, IsDateString, IsOptional } from 'class-validator';


export enum Processor {
  DEFAULT = 'default',
  FALLBACK = 'fallback',
}

export class PaymentDto {
  @IsNotEmpty()
  @IsUUID()
  correlationId: string;

  @IsNotEmpty()
  @IsNumber()
  amount: number;
}

export class PaymentSummaryQueryDto {
  @IsOptional()
  @IsDateString()
  from: string;

  @IsOptional()
  @IsDateString()
  to: string;
}

export class ProcessorStatsDto {
  totalRequests: number;
  totalAmount: number;
}

export class PaymentSummaryResponseDto {
  default: ProcessorStatsDto;
  fallback: ProcessorStatsDto;
}
