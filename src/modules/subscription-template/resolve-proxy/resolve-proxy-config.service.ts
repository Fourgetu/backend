import { filter, shuffle } from 'lodash';
import { customAlphabet } from 'nanoid';
import {
    GRPCConfig,
    HTTPUpgradeConfig,
    HysteriaConfig,
    InboundConfig,
    KCPConfig,
    SplitHTTPConfig,
    StreamSettingsConfig,
    TCPConfig,
    WebSocketConfig,
} from 'xray-typed';

import { Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '@common/config/app-config';
import { PrismaService } from '@common/database/prisma.service';
import {
    resolveEncryptionFromDecryption,
    resolveInboundAndMlDsa65PublicKey,
    resolveInboundAndPublicKey,
} from '@common/helpers/xray-config';
import { getSsPassword, isSS2022MethodFromMethod } from '@common/helpers/xray-config/ss-cipher';
import { getVlessFlow } from '@common/utils/flow';
import { TemplateEngine } from '@common/utils/templates/replace-templates-values';
import { setVlessRouteForUuid } from '@common/utils/vless-route';
import { SECURITY_LAYERS, USERS_STATUS } from '@libs/contracts/constants';

import { ExternalSquadEntity } from '@modules/external-squads/entities';
import { HostWithRawInbound } from '@modules/hosts/entities/host-with-inbound-tag.entity';
import { ISRRContext } from '@modules/subscription-response-rules/interfaces';
import { SubscriptionSettingsEntity } from '@modules/subscription-settings/entities/subscription-settings.entity';
import { UserEntity } from '@modules/users/entities';

import {
    GrpcTransport,
    HttpUpgradeTransport,
    HysteriaTransport,
    KcpTransport,
    ProtocolVariant,
    ResolvedProxyConfig,
    SecurityVariant,
    TcpTransport,
    TransportVariant,
    WsTransport,
    XHttpTransport,
} from './interfaces';
import { override, toNonEmptyRecord } from './utils';

export interface IResolveProxyConfigOptions {
    subscriptionSettings: SubscriptionSettingsEntity | null;
    hosts: HostWithRawInbound[];
    user: UserEntity;
    hostsOverrides?: ExternalSquadEntity['hostOverrides'];
    fallbackOptions?: {
        showHwidMaxDeviceRemarks?: boolean;
        showHwidNotSupportedRemarks?: boolean;
        respondWithRemarks?: string[];
    };
    excludeHostsByTags?: ISRRContext['excludeHostsByTags'];
}

interface SingBoxInboundConfig {
    type?: string;
    tls?: {
        enabled?: boolean;
        server_name?: string;
        alpn?: string | string[];
    };
    obfs?: {
        type?: string;
        password?: string;
    };
    up_mbps?: number;
    down_mbps?: number;
}

interface ResolvedUserRoute {
    configProfileInboundUuid: string;
    externalPort: number;
    hopEndPort: number | null;
    hopStartPort: number | null;
    hostUuid: string;
    network: string;
    nodeUuid: string;
    portHoppingConfig: null | {
        enabled: boolean;
        hopIntervalSeconds: number;
    };
}

@Injectable()
export class ResolveProxyConfigService {
    private readonly logger = new Logger(ResolveProxyConfigService.name);
    private readonly nanoid: ReturnType<typeof customAlphabet>;
    private readonly subPublicDomain: string;
    private readonly domainRegex =
        /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

    constructor(
        private readonly configService: TypedConfigService,
        private readonly prisma: PrismaService,
    ) {
        this.nanoid = customAlphabet('0123456789abcdefghjkmnopqrstuvwxyz', 10);
        this.subPublicDomain = this.configService.getOrThrow('SUB_PUBLIC_DOMAIN');
    }

    public async resolveProxyConfig(
        options: IResolveProxyConfigOptions,
    ): Promise<ResolvedProxyConfig[]> {
        const { user, hostsOverrides, subscriptionSettings, fallbackOptions, excludeHostsByTags } =
            options;

        if (subscriptionSettings === null) {
            return [];
        }

        if (excludeHostsByTags) {
            options.hosts = options.hosts.filter(
                (h) => !h.tags.some((tag) => excludeHostsByTags.has(tag)),
            );
        }

        const earlyRemarks = this.resolveEarlyExitRemarks(
            user,
            subscriptionSettings,
            fallbackOptions,
            options.hosts.length,
        );
        if (earlyRemarks !== null) {
            return this.createFallbackHosts(
                this.templateRemarks(earlyRemarks, user, subscriptionSettings),
            );
        }

        const hosts = this.applyShuffle(options.hosts);

        const rawInbounds = hosts.map((h) => h.rawInbound);
        const [publicKeyMap, mldsa65PublicKeyMap, encryptionMap] = await Promise.all([
            resolveInboundAndPublicKey(rawInbounds),
            resolveInboundAndMlDsa65PublicKey(rawInbounds),
            resolveEncryptionFromDecryption(rawInbounds),
        ]);

        const knownRemarks = new Map<string, number>();
        const resolvedProxyConfigs: ResolvedProxyConfig[] = [];

        // A UserRoute changes only the public connection port. Keep this lookup outside the
        // host loop so a subscription request never performs one database query per host.
        const userRoutes = await this.prisma.userRoutes.findMany({
            where: {
                userId: user.id,
                enabled: true,
            },
            select: {
                hostUuid: true,
                configProfileInboundUuid: true,
                externalPort: true,
                network: true,
                nodeUuid: true,
                hopStartPort: true,
                hopEndPort: true,
                portHoppingConfig: {
                    select: { enabled: true, hopIntervalSeconds: true },
                },
            },
        });

        const userValueMap = TemplateEngine.createUserValueMap(
            user,
            subscriptionSettings,
            this.subPublicDomain,
        );

        for (const inputHost of hosts) {
            this.applyHostOverrides(inputHost, hostsOverrides);

            const finalRemark = this.deduplicateRemark(
                TemplateEngine.replace(inputHost.remark, userValueMap),
                knownRemarks,
            );

            const userRoute = this.resolveUserRoute(inputHost, userRoutes);
            const resolvedProxyConfig = this.buildResolvedProxyConfig({
                inputHost,
                inbound: inputHost.rawInbound as InboundConfig,
                finalRemark,
                user,
                userRoute,
                publicKeyMap,
                mldsa65PublicKeyMap,
                encryptionMap,
            });

            if (resolvedProxyConfig) {
                resolvedProxyConfigs.push(resolvedProxyConfig);
            }
        }

        return resolvedProxyConfigs;
    }

    private resolveEarlyExitRemarks(
        user: UserEntity,
        settings: SubscriptionSettingsEntity,
        fallbackOptions: IResolveProxyConfigOptions['fallbackOptions'],
        hostCount: number,
    ): string[] | null {
        if (settings.isShowCustomRemarks) {
            if (fallbackOptions) {
                if (fallbackOptions.showHwidMaxDeviceRemarks) {
                    return settings.customRemarks.HWIDMaxDevicesExceeded;
                }
                if (fallbackOptions.showHwidNotSupportedRemarks) {
                    return settings.customRemarks.HWIDNotSupported;
                }
                if (
                    fallbackOptions.respondWithRemarks &&
                    fallbackOptions.respondWithRemarks.length > 0
                ) {
                    return fallbackOptions.respondWithRemarks;
                }
            }

            if (user.status !== USERS_STATUS.ACTIVE) {
                const statusRemarksMap: Partial<Record<string, string[]>> = {
                    [USERS_STATUS.EXPIRED]: settings.customRemarks.expiredUsers,
                    [USERS_STATUS.DISABLED]: settings.customRemarks.disabledUsers,
                    [USERS_STATUS.LIMITED]: settings.customRemarks.limitedUsers,
                };
                return statusRemarksMap[user.status] ?? [];
            }
        }

        if (hostCount === 0) {
            return settings.customRemarks.emptyHosts;
        }

        return null;
    }

    private resolveTransport(
        streamSettings: StreamSettingsConfig | undefined,
        inputHost: HostWithRawInbound,
        protocol: ProtocolVariant,
        authOptions: {
            vlessUuid: string;
        },
    ): TransportVariant {
        const rawNetwork = streamSettings?.network;

        if (rawNetwork === undefined || !streamSettings) {
            return {
                transport: 'tcp',
                transportOptions: {
                    header: null,
                },
            };
        }

        switch (rawNetwork) {
            case 'xhttp':
                return this.resolveXhttp(streamSettings.xhttpSettings, inputHost);
            case 'ws':
                return this.resolveWs(streamSettings.wsSettings, inputHost);
            case 'httpupgrade':
                return this.resolveHttpUpgrade(streamSettings.httpupgradeSettings, inputHost);
            case 'grpc':
                return this.resolveGrpc(streamSettings.grpcSettings, inputHost);
            case 'raw':
                return this.resolveTcp(streamSettings.rawSettings, inputHost);
            case 'tcp':
                return this.resolveTcp(streamSettings.tcpSettings, inputHost);
            case 'kcp':
                return this.resolveKcp(streamSettings.kcpSettings);
            case 'hysteria':
                return this.resolveHysteria(
                    streamSettings.hysteriaSettings,
                    authOptions.vlessUuid,
                    protocol,
                    inputHost.vlessRouteId,
                );
            default:
                return {
                    transport: 'tcp',
                    transportOptions: {
                        header: null,
                    },
                };
        }
    }

    private resolveXhttp(
        settings: SplitHTTPConfig | undefined,
        inputHost: HostWithRawInbound,
    ): XHttpTransport {
        return {
            transport: 'xhttp',
            transportOptions: {
                path: override(inputHost.path, settings?.path),
                host: this.resolveRandomizedValue(override(inputHost.host, settings?.host) ?? ''),
                mode: settings?.mode ?? 'auto',
                extra: override(toNonEmptyRecord(inputHost.xhttpExtraParams), settings?.extra),
            },
        };
    }

    private resolveWs(
        settings: WebSocketConfig | undefined,
        inputHost: HostWithRawInbound,
    ): WsTransport {
        return {
            transport: 'ws',
            transportOptions: {
                host: this.resolveRandomizedValue(override(inputHost.host, settings?.host) ?? ''),
                path: override(inputHost.path, settings?.path),
                headers: settings?.headers ?? null,
                heartbeatPeriod: settings?.heartbeatPeriod ?? null,
            },
        };
    }

    private resolveHttpUpgrade(
        settings: HTTPUpgradeConfig | undefined,
        inputHost: HostWithRawInbound,
    ): HttpUpgradeTransport {
        return {
            transport: 'httpupgrade',
            transportOptions: {
                path: override(inputHost.path, settings?.path),
                host: this.resolveRandomizedValue(override(inputHost.host, settings?.host) ?? ''),
                headers: settings?.headers ?? null,
            },
        };
    }

    private resolveGrpc(
        settings: GRPCConfig | undefined,
        inputHost: HostWithRawInbound,
    ): GrpcTransport {
        return {
            transport: 'grpc',
            transportOptions: {
                authority: this.resolveRandomizedValue(
                    override(inputHost.host, settings?.authority) ?? '',
                ),
                serviceName: override(inputHost.path, settings?.serviceName),
                multiMode: !!settings?.multiMode,
            },
        };
    }

    private resolveTcp(
        settings: TCPConfig | undefined,
        inputHost: HostWithRawInbound,
    ): TcpTransport {
        if (settings && settings.header && settings.header.type === 'http') {
            let baseRequest = structuredClone(settings.header.request);
            if (!baseRequest) {
                baseRequest = {
                    version: '1.1',
                    method: 'GET',
                    headers: {
                        'Accept-Encoding': ['gzip', 'deflate'],
                        Connection: ['keep-alive'],
                        Pragma: ['no-cache'],
                    },
                };
            } else {
                baseRequest.headers = baseRequest.headers || {};

                if (inputHost.host) {
                    baseRequest.headers.Host = [this.resolveRandomizedValue(inputHost.host)];
                }

                if (inputHost.path) {
                    baseRequest.path = [inputHost.path];
                }
            }

            return {
                transport: 'tcp',
                transportOptions: {
                    header: {
                        type: 'http',
                        request: baseRequest,
                    },
                },
            };
        }

        return {
            transport: 'tcp',
            transportOptions: {
                header: settings?.header ?? null,
            },
        };
    }

    private resolveKcp(settings: KCPConfig | undefined): KcpTransport {
        return {
            transport: 'kcp',
            transportOptions: {
                clientMtu: settings?.clientMtu || settings?.mtu || 1350,
                clientTti: settings?.clientTti || settings?.tti || 50,
                congestion: settings?.congestion || false,
            },
        };
    }

    private resolveHysteria(
        settings: HysteriaConfig | undefined,
        vlessUuid: string,
        protocol: ProtocolVariant,
        vlessRouteId: number | null,
    ): HysteriaTransport {
        let auth: string = '';
        if (protocol.protocol === 'hysteria') {
            auth = setVlessRouteForUuid(vlessUuid, vlessRouteId);
        } else if (settings?.auth) {
            auth = settings.auth;
        }

        return {
            transport: 'hysteria',
            transportOptions: {
                version: 2,
                auth,
            },
        };
    }

    private resolveSecurity(
        streamSettings: StreamSettingsConfig | undefined,
        inputHost: HostWithRawInbound,
        inboundTag: string,
        publicKeyMap: Map<string, string>,
        mldsa65Map: Map<string, string>,
        resolvedAddress: string,
    ): SecurityVariant {
        if (!streamSettings) {
            return {
                security: 'none',
            };
        }

        let effectiveSecurity = streamSettings.security;
        if (inputHost.securityLayer !== SECURITY_LAYERS.DEFAULT) {
            switch (inputHost.securityLayer) {
                case SECURITY_LAYERS.TLS:
                    effectiveSecurity = 'tls';
                    break;
                case SECURITY_LAYERS.NONE:
                    effectiveSecurity = 'none';
                    break;
            }
        }

        switch (effectiveSecurity) {
            case 'tls': {
                const tls = streamSettings.tlsSettings;
                const alpn =
                    override(
                        inputHost.alpn,
                        Array.isArray(tls?.alpn) ? tls.alpn.join(',') : tls?.alpn,
                    ) ?? '';

                return {
                    security: 'tls',
                    securityOptions: {
                        alpn,
                        enableSessionResumption: !!tls?.enableSessionResumption,
                        fingerprint: override(inputHost.fingerprint, tls?.fingerprint) ?? 'chrome',
                        serverName: this.resolveFinalServerName(
                            inputHost,
                            streamSettings.tlsSettings?.serverName,
                            resolvedAddress,
                        ),
                        echConfigList: tls?.echConfigList || null,
                        echForceQuery: tls?.echForceQuery || null,
                        echSockopt: toNonEmptyRecord(tls?.echSockopt),
                        pinnedPeerCertSha256: inputHost.pinnedPeerCertSha256,
                        verifyPeerCertByName: inputHost.verifyPeerCertByName,
                        cipherSuites: tls?.cipherSuites || null,
                    },
                };
            }
            case 'reality': {
                const reality = streamSettings.realitySettings;
                const shortIds = reality?.shortIds || [];
                const shortId = shortIds.length > 0 ? shortIds[0] : '';

                return {
                    security: 'reality',
                    securityOptions: {
                        fingerprint:
                            override(inputHost.fingerprint, reality?.fingerprint) ?? 'chrome',
                        publicKey: publicKeyMap.get(inboundTag) || '',
                        shortId,
                        serverName: this.resolveFinalServerName(
                            inputHost,
                            reality?.serverNames?.[0],
                            resolvedAddress,
                        ),
                        spiderX: reality?.spiderX || '',
                        mldsa65Verify: mldsa65Map.get(inboundTag) ?? null,
                    },
                };
            }
            case 'none':
                return { security: 'none' };
            default:
                return { security: 'none' };
        }
    }

    private resolveFinalServerName(
        inputHost: HostWithRawInbound,
        serverName: string | undefined,
        resolvedAddress: string,
    ): string {
        if (inputHost.keepSniBlank) {
            return '';
        }

        if (inputHost.overrideSniFromAddress) {
            return resolvedAddress;
        }

        let baseSni = serverName ?? '';

        if (inputHost.sni) {
            baseSni = inputHost.sni;
        }

        if (!baseSni && this.isDomain(inputHost.address)) {
            baseSni = inputHost.address;
        }

        return this.resolveRandomizedValue(baseSni);
    }

    private resolveProtocolOptions(
        inputHost: HostWithRawInbound,
        inbound: InboundConfig,
        user: UserEntity,
        encryption?: string,
    ): ProtocolVariant | null {
        const singBoxType = (inbound as unknown as { type?: string }).type;
        if (singBoxType === 'hysteria2') {
            return {
                protocol: 'hysteria',
                protocolOptions: {
                    version: 2,
                },
            };
        }

        if (singBoxType === 'anytls') {
            return {
                protocol: 'anytls',
                protocolOptions: {
                    password: user.vlessUuid,
                },
            };
        }

        if (singBoxType === 'socks') {
            return {
                protocol: 'socks',
                protocolOptions: {
                    username: user.socksUsername,
                    password: user.socksPassword,
                    version: 5,
                },
            };
        }

        if (!inbound.settings) {
            return null;
        }

        switch (inbound.protocol) {
            case 'vless':
                return {
                    protocol: 'vless',
                    protocolOptions: {
                        id: setVlessRouteForUuid(user.vlessUuid, inputHost.vlessRouteId),
                        encryption: encryption ?? 'none',
                        flow: getVlessFlow(inbound),
                    },
                };
            case 'trojan':
                return {
                    protocol: 'trojan',
                    protocolOptions: {
                        password: user.trojanPassword,
                    },
                };
            case 'shadowsocks':
                const settings = inbound.settings;

                let clientPassword = user.ssPassword;

                if (isSS2022MethodFromMethod(settings.method) && 'password' in settings) {
                    clientPassword = `${settings.password}:${getSsPassword(user.ssPassword, true)}`;
                }

                return {
                    protocol: 'shadowsocks',
                    protocolOptions: {
                        method: settings.method || 'chacha20-ietf-poly1305',
                        password: clientPassword,
                        uot: settings.uot || false,
                        uotVersion: settings.uotVersion || 1,
                    },
                };
            case 'hysteria':
                return {
                    protocol: 'hysteria',
                    protocolOptions: {
                        version: 2,
                    },
                };
            case 'socks':
                return {
                    protocol: 'socks',
                    protocolOptions: {
                        username: user.socksUsername,
                        password: user.socksPassword,
                        version: 5,
                    },
                };
            default:
                return null;
        }
    }

    private buildResolvedProxyConfig(ctx: {
        inputHost: HostWithRawInbound;
        inbound: InboundConfig;
        finalRemark: string;
        user: UserEntity;
        userRoute: ResolvedUserRoute | null;
        publicKeyMap: Map<string, string>;
        mldsa65PublicKeyMap: Map<string, string>;
        encryptionMap: Map<string, string>;
    }): ResolvedProxyConfig | null {
        const { inputHost, inbound, finalRemark, user } = ctx;

        const address = this.resolveRandomizedValue(inputHost.address);

        const protocol = this.resolveProtocolOptions(
            inputHost,
            inbound,
            user,
            ctx.encryptionMap.get(inputHost.inboundTag),
        );

        if (!protocol) {
            return null;
        }

        const singBoxInbound = inbound as unknown as SingBoxInboundConfig;
        const isSingBoxHysteria2 = singBoxInbound.type === 'hysteria2';
        const isSingBoxAnyTls = singBoxInbound.type === 'anytls';

        const transport = isSingBoxHysteria2
            ? ({
                  transport: 'hysteria',
                  transportOptions: {
                      version: 2,
                      auth: user.vlessUuid,
                  },
              } satisfies HysteriaTransport)
            : isSingBoxAnyTls
              ? ({
                    transport: 'tcp',
                    transportOptions: { header: null },
                } satisfies TcpTransport)
              : this.resolveTransport(inbound.streamSettings, inputHost, protocol, {
                    vlessUuid: user.vlessUuid,
                });

        const security =
            isSingBoxHysteria2 || isSingBoxAnyTls
                ? this.resolveSingBoxTlsSecurity(singBoxInbound, inputHost, address)
                : this.resolveSecurity(
                      inbound.streamSettings,
                      inputHost,
                      inbound.tag!,
                      ctx.publicKeyMap,
                      ctx.mldsa65PublicKeyMap,
                      address,
                  );

        const runtimeFinalMask = isSingBoxHysteria2
            ? this.resolveSingBoxHysteriaFinalMask(singBoxInbound)
            : toNonEmptyRecord(inbound.streamSettings?.finalmask);
        const resolvedFinalMask = this.applyUserRoutePortHopping(
            override(toNonEmptyRecord(inputHost.finalMask), runtimeFinalMask),
            isSingBoxHysteria2 ? ctx.userRoute : null,
        );

        return {
            finalRemark: finalRemark,
            address: address,
            port: ctx.userRoute?.externalPort ?? inputHost.port,
            streamOverrides: {
                finalMask: resolvedFinalMask,
                sockopt: toNonEmptyRecord(inputHost.sockoptParams),
            },
            mux: toNonEmptyRecord(inputHost.muxParams),
            clientOverrides: {
                shuffleHost: inputHost.shuffleHost,
                mihomoX25519: inputHost.mihomoX25519,
                mihomoIpVersion: inputHost.mihomoIpVersion,
                serverDescription: inputHost.serverDescription
                    ? Buffer.from(inputHost.serverDescription).toString('base64')
                    : null,
                xrayJsonTemplate: inputHost.xrayJsonTemplate,
                mapper: inputHost.mapper,
            },
            metadata: {
                uuid: inputHost.uuid,
                tags: inputHost.tags,
                excludeFromSubscriptionTypes: inputHost.excludeFromSubscriptionTypes,
                inboundTag: inputHost.inboundTag,
                configProfileUuid: inputHost.configProfileUuid,
                configProfileInboundUuid: inputHost.configProfileInboundUuid,
                isDisabled: inputHost.isDisabled,
                isHidden: inputHost.isHidden,
                viewPosition: inputHost.viewPosition,
                remark: inputHost.remark,
                vlessRouteId: inputHost.vlessRouteId,
                rawInbound: inputHost.rawInbound,
            },
            ...protocol,
            ...security,
            ...transport,
        } satisfies ResolvedProxyConfig;
    }

    private resolveSingBoxTlsSecurity(
        inbound: SingBoxInboundConfig,
        inputHost: HostWithRawInbound,
        resolvedAddress: string,
    ): SecurityVariant {
        if (!inbound.tls?.enabled) return { security: 'none' };

        const defaultAlpn = inbound.type === 'hysteria2' ? 'h3' : '';
        const runtimeAlpn = Array.isArray(inbound.tls.alpn)
            ? inbound.tls.alpn.join(',')
            : (inbound.tls.alpn ?? defaultAlpn);

        return {
            security: 'tls',
            securityOptions: {
                alpn: override(inputHost.alpn, runtimeAlpn) ?? defaultAlpn,
                enableSessionResumption: false,
                fingerprint: inputHost.fingerprint ?? 'chrome',
                serverName: this.resolveFinalServerName(
                    inputHost,
                    inbound.tls.server_name,
                    resolvedAddress,
                ),
                echConfigList: null,
                echForceQuery: null,
                echSockopt: null,
                pinnedPeerCertSha256: inputHost.pinnedPeerCertSha256,
                verifyPeerCertByName: inputHost.verifyPeerCertByName,
                cipherSuites: null,
            },
        };
    }

    private resolveSingBoxHysteriaFinalMask(
        inbound: SingBoxInboundConfig,
    ): Record<string, unknown> | null {
        const finalMask: Record<string, unknown> = {};

        if (inbound.obfs?.type === 'salamander' && inbound.obfs.password) {
            finalMask.udp = [
                {
                    type: 'salamander',
                    settings: { password: inbound.obfs.password },
                },
            ];
        }

        if (inbound.up_mbps || inbound.down_mbps) {
            finalMask.quicParams = {
                ...(inbound.up_mbps && { brutalUp: inbound.up_mbps }),
                ...(inbound.down_mbps && { brutalDown: inbound.down_mbps }),
            };
        }

        return Object.keys(finalMask).length > 0 ? finalMask : null;
    }

    private applyUserRoutePortHopping(
        finalMask: Record<string, unknown> | null,
        route: ResolvedUserRoute | null,
    ): Record<string, unknown> | null {
        if (
            !route?.portHoppingConfig?.enabled ||
            route.hopStartPort === null ||
            route.hopEndPort === null
        ) {
            return finalMask;
        }

        const existingQuicParams =
            finalMask?.quicParams &&
            typeof finalMask.quicParams === 'object' &&
            !Array.isArray(finalMask.quicParams)
                ? (finalMask.quicParams as Record<string, unknown>)
                : {};

        return {
            ...finalMask,
            quicParams: {
                ...existingQuicParams,
                udpHop: {
                    ports: `${route.hopStartPort}-${route.hopEndPort}`,
                    interval: `${route.portHoppingConfig.hopIntervalSeconds}s`,
                },
            },
        };
    }

    private resolveUserRoute(
        inputHost: HostWithRawInbound,
        routes: ResolvedUserRoute[],
    ): ResolvedUserRoute | null {
        if (!inputHost.configProfileInboundUuid) return null;

        const inbound = inputHost.rawInbound as Partial<InboundConfig> | null;
        const network = this.resolveUserRouteNetwork(inbound);
        const candidates = routes.filter(
            (route) =>
                route.hostUuid === inputHost.uuid &&
                route.configProfileInboundUuid === inputHost.configProfileInboundUuid &&
                route.network === network,
        );

        if (candidates.length === 0) return null;

        // Hosts can be attached to more than one Node, while the current subscription contract
        // does not carry a node discriminator. Never guess between different external ports.
        const routeSignatures = new Set(
            candidates.map(
                (route) =>
                    `${route.externalPort}:${route.hopStartPort ?? ''}:${route.hopEndPort ?? ''}:` +
                    `${route.portHoppingConfig?.enabled ? route.portHoppingConfig.hopIntervalSeconds : ''}`,
            ),
        );
        if (routeSignatures.size > 1) {
            this.logger.warn(
                `Skipping UserRoute port override for host ${inputHost.uuid}: ` +
                    `${candidates.length} node routes resolve to different port allocations.`,
            );
            return null;
        }

        return candidates[0];
    }

    private resolveUserRouteNetwork(inbound: Partial<InboundConfig> | null): 'tcp' | 'udp' {
        if (!inbound) return 'tcp';

        if (
            inbound.protocol === 'hysteria' ||
            (inbound as unknown as { type?: string }).type === 'hysteria2'
        )
            return 'udp';

        const network = (inbound.streamSettings as { network?: string } | undefined)?.network;
        return network === 'hysteria' || network === 'quic' ? 'udp' : 'tcp';
    }

    private resolveRandomizedValue(value: string): string {
        if (!value) return value;

        if (value.includes(',')) {
            const parts = value.split(',');
            return parts[Math.floor(Math.random() * parts.length)].trim();
        }

        if (value.includes('*')) {
            return value.replace('*', this.nanoid()).trim();
        }

        return value;
    }

    private isDomain(str: string): boolean {
        return this.domainRegex.test(str);
    }

    private deduplicateRemark(remark: string, knownRemarks: Map<string, number>): string {
        const currentCount = knownRemarks.get(remark) || 0;
        knownRemarks.set(remark, currentCount + 1);

        if (currentCount === 0) {
            return remark;
        }

        const hasExistingSuffix = remark.includes('^~') && remark.endsWith('~^');
        const suffix = hasExistingSuffix ? currentCount : currentCount + 1;
        return `${remark} ^~${suffix}~^`;
    }

    private applyHostOverrides(
        host: HostWithRawInbound,
        overrides?: ExternalSquadEntity['hostOverrides'],
    ): void {
        if (!overrides) return;

        if (overrides.vlessRouteId !== undefined) {
            host.vlessRouteId = overrides.vlessRouteId;
        }
        if (overrides.serverDescription !== undefined) {
            host.serverDescription = overrides.serverDescription;
        }
    }

    private applyShuffle(hosts: HostWithRawInbound[]): HostWithRawInbound[] {
        if (!hosts.some((h) => h.shuffleHost)) {
            return hosts;
        }
        return [...shuffle(filter(hosts, 'shuffleHost')), ...filter(hosts, (h) => !h.shuffleHost)];
    }

    private templateRemarks(
        remarks: string[],
        user: UserEntity,
        settings: SubscriptionSettingsEntity,
    ): string[] {
        const userValueMap = TemplateEngine.createUserValueMap(
            user,
            settings,
            this.subPublicDomain,
        );
        return remarks.map((remark) => TemplateEngine.replace(remark, userValueMap));
    }

    private parseResolvedProxyConfigFromRemark(remark: string): ResolvedProxyConfig | null {
        if (!remark.startsWith('{"f')) {
            return null;
        }

        try {
            const parsed: unknown = JSON.parse(remark);

            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return null;
            }

            return parsed as ResolvedProxyConfig;
        } catch {
            return null;
        }
    }

    private createFallbackHosts(remarks: string[]): ResolvedProxyConfig[] {
        return remarks.map(
            (remark) =>
                this.parseResolvedProxyConfigFromRemark(remark.trim()) ??
                ({
                    finalRemark: remark,
                    address: '0.0.0.0',
                    port: 1,
                    streamOverrides: {
                        finalMask: null,
                        sockopt: null,
                    },
                    mux: null,
                    protocol: 'vless',
                    protocolOptions: {
                        id: '00000000-0000-0000-0000-000000000000',
                        encryption: 'none',
                        flow: '',
                    },
                    transport: 'tcp',
                    transportOptions: {
                        header: null,
                    },
                    security: 'none',
                    clientOverrides: {
                        shuffleHost: false,
                        mihomoX25519: false,
                        serverDescription: null,
                        xrayJsonTemplate: null,
                        mihomoIpVersion: null,
                        mapper: {},
                    },
                    metadata: {
                        uuid: '00000000-0000-0000-0000-000000000000',
                        tags: [],
                        excludeFromSubscriptionTypes: [],
                        inboundTag: '',
                        configProfileUuid: null,
                        configProfileInboundUuid: null,
                        isDisabled: false,
                        isHidden: false,
                        viewPosition: 0,
                        remark: remark,
                        vlessRouteId: null,
                        rawInbound: null,
                    },
                } satisfies ResolvedProxyConfig),
        );
    }
}
