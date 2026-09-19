export const PANEL_CERTIFICATE_ID = 'panel';

export const PANEL_CERTIFICATE_URI =
    `remnawave://certificate/${PANEL_CERTIFICATE_ID}/fullchain.pem` as const;
export const PANEL_PRIVATE_KEY_URI =
    `remnawave://certificate/${PANEL_CERTIFICATE_ID}/privkey.pem` as const;

export const isPanelCertificatePair = (certificatePath: unknown, keyPath: unknown): boolean =>
    certificatePath === PANEL_CERTIFICATE_URI && keyPath === PANEL_PRIVATE_KEY_URI;

export const hasPartialPanelCertificatePair = (
    certificatePath: unknown,
    keyPath: unknown,
): boolean => certificatePath === PANEL_CERTIFICATE_URI || keyPath === PANEL_PRIVATE_KEY_URI;
