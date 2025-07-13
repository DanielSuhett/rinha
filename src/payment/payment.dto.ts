import { IsNotEmpty, IsNumber, IsUUID } from 'class-validator';

export class PaymentDto {
  @IsNotEmpty()
  @IsUUID()
  correlationId: string;

  @IsNotEmpty()
  @IsNumber()
  amount: number;
}
