import { Global, Module } from '@nestjs/common';

import { CertificateProfileService } from './certificate-profile.service';

@Global()
@Module({
    providers: [CertificateProfileService],
    exports: [CertificateProfileService],
})
export class CertificateProfileModule {}
