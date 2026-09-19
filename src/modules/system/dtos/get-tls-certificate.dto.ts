import { GetTlsCertificateCommand } from '@contract/commands';
import { createZodDto } from 'nestjs-zod';

export class GetTlsCertificateResponseDto extends createZodDto(
    GetTlsCertificateCommand.ResponseSchema,
) {}
