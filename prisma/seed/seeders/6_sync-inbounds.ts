import { Prisma, PrismaClient } from '@prisma/client';
import consola from 'consola';

import { createCoreConfig } from '@common/helpers/core-config';
import { diffInbounds } from '@common/utils/inbounds';
import type { TConfigProfileCoreType } from '@libs/contracts/constants';

export async function syncInbounds(prisma: PrismaClient) {
    consola.start('Syncing inbounds...');

    const configProfiles = await prisma.configProfiles.findMany();

    for (const configProfile of configProfiles) {
        consola.start(`Syncing ${configProfile.name}...`);

        const validatedConfig = createCoreConfig(
            configProfile.coreType as TConfigProfileCoreType,
            configProfile.config as object,
        );

        const existingInbounds = await prisma.configProfileInbounds.findMany({
            where: {
                profileUuid: configProfile.uuid,
            },
        });

        const { toAdd, toRemove, toUpdate } = diffInbounds(
            existingInbounds,
            validatedConfig.getAllInbounds(),
        );

        if (toRemove.length) {
            consola.info(`Removing inbounds: ${toRemove.map((i) => i.tag).join(', ')}`);

            await prisma.configProfileInbounds.deleteMany({
                where: { uuid: { in: toRemove.map((inbound) => inbound.uuid) } },
            });
        }

        if (toAdd.length) {
            consola.info(`Adding inbounds: ${toAdd.map((i) => i.tag).join(', ')}`);

            await prisma.configProfileInbounds.createMany({
                data: toAdd.map((inbound) => ({
                    ...inbound,
                    rawInbound: inbound.rawInbound as Prisma.InputJsonValue,
                    profileUuid: configProfile.uuid,
                })),
            });
        }

        if (toUpdate.length) {
            consola.info(`Updating inbounds: ${toUpdate.map((i) => i.tag).join(', ')}`);

            for (const inbound of toUpdate) {
                await prisma.configProfileInbounds.update({
                    where: { uuid: inbound.uuid },
                    data: {
                        ...inbound,
                        rawInbound: inbound.rawInbound as Prisma.InputJsonValue,
                    },
                });
            }
        }
    }

    consola.success('Inbounds synced successfully');
}
