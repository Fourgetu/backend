import assert from 'node:assert/strict';
import test from 'node:test';

import {
    certificateNameMatches,
    configRequiresPanelCertificate,
} from '../../src/common/certificates/certificate-profile.service';
import {
    PANEL_CERTIFICATE_URI,
    PANEL_PRIVATE_KEY_URI,
} from '../../src/common/certificates/managed-certificate.constants';

test('certificate name matching supports exact and single-label wildcard SANs', () => {
    assert.equal(certificateNameMatches('panel.example.com', ['panel.example.com']), true);
    assert.equal(certificateNameMatches('node.example.com', ['*.example.com']), true);
    assert.equal(certificateNameMatches('deep.node.example.com', ['*.example.com']), false);
    assert.equal(certificateNameMatches('other.example.net', ['*.example.com']), false);
});

test('only the complete managed certificate marker pair requests a panel bundle', () => {
    const managedConfig = {
        inbounds: [
            {
                tls: {
                    certificate_path: PANEL_CERTIFICATE_URI,
                    key_path: PANEL_PRIVATE_KEY_URI,
                },
            },
        ],
    };
    assert.equal(configRequiresPanelCertificate(managedConfig), true);
    assert.throws(
        () =>
            configRequiresPanelCertificate({
                inbounds: [{ tls: { certificate_path: PANEL_CERTIFICATE_URI } }],
            }),
        /markers must be used together/,
    );
    assert.equal(
        configRequiresPanelCertificate({
            inbounds: [
                {
                    tls: {
                        certificate_path: '/etc/cert.pem',
                        key_path: '/etc/key.pem',
                    },
                },
            ],
        }),
        false,
    );
});
