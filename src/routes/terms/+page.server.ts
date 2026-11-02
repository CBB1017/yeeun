import type { PageServerLoad } from './$types';
import { config } from '#lib/server/config.ts';

export const load: PageServerLoad = () => ({ operator: config().operator, origin: config().publicOrigin });
