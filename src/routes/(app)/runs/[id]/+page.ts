import type { PageLoad } from './$types';
import { api, load as loadApi } from '#lib/client/api.ts';
import type { RunDetail, RunEvidence, RunResult } from '#lib/client/types.ts';

export const load: PageLoad = async ({ fetch, params }) => {
	const detail = await loadApi<RunDetail>(fetch, `/api/runs/${params.id}`);
	const [result, evidence] = await Promise.all([
		detail.run.state === 'completed' ? api<RunResult>(`/api/runs/${params.id}/result`, { fetch }).catch(() => null) : Promise.resolve(null),
		api<RunEvidence>(`/api/runs/${params.id}/evidence`, { fetch }).catch(() => null)
	]);
	return { detail, result, evidence };
};
