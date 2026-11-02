import type { Queue } from 'pg-boss';

/**
 * pg-boss queues. Every queue has retryLimit 0: failed jobs are never retried
 * or redelivered automatically. Run execution itself is claimed through the
 * app `runs` table (FIFO + per-user lane), so a pg-boss expiry can never cause
 * a duplicate CLI execution.
 */
export const QUEUE_NAMES = ['run-dispatch', 'scheduler-tick', 'notify-deliver', 'snapshot-cleanup'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

export function queueOptions(name: QueueName): Omit<Queue, 'name'> {
	const base = { retryLimit: 0, retryDelay: 0, retryBackoff: false, deleteAfterSeconds: 7 * 86400 };
	switch (name) {
		case 'run-dispatch':
			return { ...base, policy: 'singleton', expireInSeconds: 120 };
		case 'scheduler-tick':
			return { ...base, policy: 'singleton', expireInSeconds: 120 };
		case 'notify-deliver':
			return { ...base, policy: 'standard', expireInSeconds: 300 };
		case 'snapshot-cleanup':
			return { ...base, policy: 'standard', expireInSeconds: 600 };
	}
}
